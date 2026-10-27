// Terminal accepts payment details at Stripe; only its brand and last four are retained here.
import type { Command, Context } from './context'
import type { Bindings } from '../auth.server'
import { authority, must, who } from './access'
import { cents, date, now, requireThat, text, uid, type Data } from './core'
import { all, assertOpen, audit, changed, guard, one, q, run, type Sql } from './db'
import { entryStatements } from './journal'
import { checkoutAmount, offeredMethods, recordSucceeded, stripeSettings } from './stripe'
import { managedInstall, stripeCall as providerCall, unseal } from './stripe-api'
import { invoice } from './invoices'
import { processorDimensions } from './dimensions/processor'

// The connected account's current API removed explicit method types; Terminal
// requires card-present intents, so use Stripe's supported prior contract here.
const stripeCall = (key: string, method: 'GET' | 'POST', path: string, params: Data = {}, idempotency?: string) => providerCall(key, method, path, params, idempotency, '2024-06-20')

async function connection(env: Bindings, db: D1Database) {
  requireThat(!managedInstall(env), 'This installation cannot reach Stripe Terminal', 409)
  const s = await stripeSettings(db)
  requireThat(s && s.card && s.country === 'US' && s.settlement_currency === 'usd', 'Connect a US-dollar Stripe card account first', 409)
  return { s, key: await unseal(env, s.key_sealed) }
}
const accountFence = (s: Data) => guard('EXISTS(SELECT 1 FROM pt_stripe WHERE id=1 AND account_id=? AND revision=?)', s.account_id, s.revision)
const inputFields = (b: Data, fields: string[]) => requireThat(Object.keys(b).every(k=>fields.includes(k)), 'Only the named Terminal fields are accepted; card details belong at Stripe')
const selected = async (db: D1Database, id: string) => {
  const row = await one(db, 'SELECT * FROM pt_terminal_payments WHERE id=?', id)
  requireThat(row, 'Terminal payment not found', 404)
  return row
}
export async function terminalView(db: D1Database) {
  return { settings: await one(db, 'SELECT * FROM pt_terminal_settings WHERE id=1'), payments: await all(db, 'SELECT * FROM pt_terminal_payments ORDER BY created_at DESC LIMIT 100') }
}
const settings: Command = { need: 'owner', async run(c,b) {
  inputFields(b,['tipAccountId'])
  const id = text(b.tipAccountId, 'Tip account')
  requireThat(await one(c.db, "SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND type IN ('income','liability') AND subtype NOT IN ('receivable','payable')", id), 'Choose an active income or tip liability account')
  await run(c.db, [authority(c.actor,'owner'), q('INSERT INTO pt_terminal_settings(id,tip_account_id,revision) VALUES(1,?,?) ON CONFLICT(id) DO UPDATE SET tip_account_id=excluded.tip_account_id,revision=excluded.revision',id,uid()), audit(who(c.actor),'terminal.settings','terminal-settings','1',{tipAccountId:id})])
  return terminalView(c.db)
} }
const prepare: Command = { need: 'owner', async run(c,b) {
  // Reject payment details rather than ever saving raw reader or card payloads.
  requireThat(Object.keys(b).every(k=>['requestId','readerId','invoiceId','customerId','date','description','amount','tip','incomeAccountId','taxTreatment','taxReason'].includes(k)), 'Only sale and reader references are accepted; card details belong at Stripe')
  const id = text(b.requestId,'Request reference',100), readerId = text(b.readerId,'Stripe reader',100)
  requireThat(/^[A-Za-z0-9_-]+$/.test(id) && /^[A-Za-z0-9_-]+$/.test(readerId), 'Invalid request or reader reference')
  const {s,key} = await connection(c.env,c.db), existing = await one(c.db,'SELECT * FROM pt_terminal_payments WHERE id=?',id)
  if(existing) {
    requireThat(existing.provider_account===s.account_id && existing.reader_id===readerId && (existing.invoice_id??'')===(b.invoiceId??'') && (b.invoiceId || (existing.amount_cents===cents(b.amount,'Sale amount')+cents(b.tip??'0','Tip',{zero:true}) && existing.description===text(b.description,'Sale description') && existing.sale_date===date(b.date) && existing.income_account_id===b.incomeAccountId && (existing.customer_id??'')===(b.customerId??'') && existing.tax_reason===b.taxReason)), 'Request reference already belongs to a different payment',409)
    return existing
  }
  const day=date(b.date), tip=cents(b.tip??'0','Tip',{zero:true})
  await assertOpen(c.db,day)
  let amount:number, income:string|null=null, customer:string|null=null, inv:Data|null=null, early:string|null=null
  if(b.invoiceId) {
    inv=await invoice(c.db,text(b.invoiceId,'Invoice'))
    requireThat(inv.kind==='invoice' && inv.status==='issued' && !inv.void_date && inv.open_cents>0,'Choose an issued open invoice',409)
    requireThat(tip===0,'Record invoice tips as a separate sale for now',409)
    requireThat((await offeredMethods(c.env,c.db,inv.customer_id)).includes('card'),'Card payment is not offered for this customer',409)
    const charge=await checkoutAmount(c.db,inv);amount=charge.amount;early=charge.windowEnd;customer=inv.customer_id
  } else {
    requireThat(b.taxTreatment==='exempt','This Terminal sale door supports an explicitly exempt service only; taxable item receipts are not available yet',409)
    text(b.taxReason,'Reason this sale is exempt',500)
    amount=cents(b.amount,'Sale amount')+tip;income=text(b.incomeAccountId,'Income account')
    requireThat(await one(c.db,"SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND type='income'",income),'Choose an active income account')
    if(b.customerId) {customer=text(b.customerId,'Customer');requireThat(await one(c.db,"SELECT 1 FROM pt_contacts WHERE id=? AND kind='customer'",customer),'Customer not found',404)}
  }
  const config=await one(c.db,'SELECT * FROM pt_terminal_settings WHERE id=1')
  requireThat(!tip || config,'The owner must choose a tip account first',409)
  const reader=await stripeCall(key,'GET',`/terminal/readers/${readerId}`)
  requireThat(reader.id===readerId && reader.status==='online' && !['in_progress'].includes(reader.action?.status),'Choose an online idle Stripe reader',409)
  const description=inv?`Invoice ${inv.number}`:text(b.description,'Sale description',500)
  await run(c.db,[authority(c.actor,'owner'),accountFence(s), ...(inv?[guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND revision=? AND status='issued' AND void_date IS NULL)",inv.id,inv.revision)]:[]),
    q('INSERT INTO pt_terminal_payments(id,provider_account,reader_id,invoice_id,customer_id,sale_date,description,amount_cents,tip_cents,income_account_id,tip_account_id,tax_reason,early_window_end,created_by,created_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,s.account_id,readerId,inv?.id??null,customer,day,description,amount,tip,income,config?.tip_account_id??null,inv?'':b.taxReason,early,c.actor.email,now()),
    audit(who(c.actor),'terminal.prepare','terminal-payment',id,{readerId,invoiceId:inv?.id??null,amount,tip})])
  return selected(c.db,id)
} }
const process: Command = { need:'owner', async run(c,b) {
  inputFields(b,['id'])
  let row=await selected(c.db,text(b.id,'Terminal payment'))
  const {s,key}=await connection(c.env,c.db)
  requireThat(row.provider_account===s.account_id,'Reconnect the original Stripe account for this payment',409)
  if(row.status==='succeeded')return row
  await assertOpen(c.db,row.sale_date)
  if(row.invoice_id) {
    const inv=await invoice(c.db,row.invoice_id),charge=await checkoutAmount(c.db,inv)
    requireThat((await offeredMethods(c.env,c.db,inv.customer_id)).includes('card'),'Card payment is not offered for this customer',409)
    requireThat(inv.status==='issued' && !inv.void_date && charge.amount===row.amount_cents && charge.windowEnd===row.early_window_end,'Invoice balance or payment offer changed; prepare a new payment',409)
  }
  await run(c.db,[authority(c.actor,'owner'),accountFence(s)])
  if(!row.payment_intent) {
    const pi=await stripeCall(key,'POST','/payment_intents',{amount:row.amount_cents,currency:'usd',payment_method_types:['card_present'],capture_method:'automatic',description:row.description,metadata:{pantry_terminal:row.id,...(row.invoice_id?{pantry_invoice:row.invoice_id}:{})}},`pantry-terminal-intent-${row.id}`)
    requireThat(typeof pi.id==='string','Stripe did not return a payment intent',502)
    await run(c.db,[authority(c.actor,'owner'),accountFence(s),q('UPDATE pt_terminal_payments SET payment_intent=? WHERE id=? AND payment_intent IS NULL',pi.id,row.id),changed()])
    row=await selected(c.db,row.id)
  }
  const pi=await stripeCall(key,'GET',`/payment_intents/${encodeURIComponent(row.payment_intent)}`)
  if(pi.status==='succeeded')return syncTerminal(c,row.id)
  const reader=await stripeCall(key,'GET',`/terminal/readers/${encodeURIComponent(row.reader_id)}`)
  const action=reader.action
  if(action?.status==='in_progress') {
    requireThat(action.process_payment_intent?.payment_intent===row.payment_intent,'The reader is collecting another payment',409)
  } else await stripeCall(key,'POST',`/terminal/readers/${encodeURIComponent(row.reader_id)}/process_payment_intent`,{payment_intent:row.payment_intent},`pantry-terminal-reader-${row.id}`)
  await run(c.db,[authority(c.actor,'owner'),accountFence(s),q("UPDATE pt_terminal_payments SET status='processing' WHERE id=? AND status<>'succeeded'",row.id),audit(who(c.actor),'terminal.process','terminal-payment',row.id,{paymentIntent:row.payment_intent})])
  return selected(c.db,row.id)
} }
export async function syncTerminal(c:Context,id:string) {
  must(c.actor,'owner')
  const row=await selected(c.db,id),{s,key}=await connection(c.env,c.db)
  requireThat(row.provider_account===s.account_id,'Reconnect the original Stripe account for this payment',409)
  if(row.status==='succeeded')return row
  requireThat(row.payment_intent,'Start the reader payment first',409)
  const pi=await stripeCall(key,'GET',`/payment_intents/${encodeURIComponent(row.payment_intent)}`,{expand:['latest_charge.balance_transaction']})
  if(pi.status!=='succeeded') return {...row,providerStatus:String(pi.status)}
  requireThat(pi.id===row.payment_intent && pi.currency==='usd' && pi.amount_received===row.amount_cents && pi.metadata?.pantry_terminal===row.id,'Stripe confirmation does not match this payment',409)
  const charge=pi.latest_charge,bt=charge?.balance_transaction,card=charge?.payment_method_details?.card_present
  requireThat(charge?.paid===true && charge.amount===row.amount_cents && charge.currency==='usd' && charge.payment_intent===pi.id && bt?.currency==='usd' && bt.amount===row.amount_cents && Number.isSafeInteger(bt.fee) && bt.fee>=0 && bt.fee<=bt.amount && bt.net===bt.amount-bt.fee && card && /^[a-z_]{1,30}$/.test(card.brand) && /^[0-9]{4}$/.test(card.last4),'Stripe has not supplied complete card-present charge and fee details',409)
  await assertOpen(c.db,row.sale_date)
  const dimensions=await processorDimensions(c.db),fences=[authority(c.actor,'owner'),accountFence(s),...dimensions.guards]
  let journalId:string,feeId:string|null=null
  if(row.invoice_id) {
    const paymentId=`terminal:${row.id}`
    if(!await one(c.db,'SELECT 1 FROM pt_stripe_payments WHERE id=?',paymentId))await run(c.db,[...fences,q("INSERT INTO pt_stripe_payments(id,invoice_id,method,amount_cents,status,created_at,updated_at,early_window_end,payment_intent) VALUES(?,?,'card',?,'open',?,?,?,?)",paymentId,row.invoice_id,row.amount_cents,now(),now(),row.early_window_end,pi.id)])
    const p=(await one(c.db,'SELECT * FROM pt_stripe_payments WHERE id=?',paymentId))!
    await recordSucceeded(c.env,c.db,p,pi,key,s,fences)
    const recorded=(await one(c.db,'SELECT s.fee_entry_id,p.journal_id FROM pt_stripe_payments s JOIN pt_payments p ON p.id=s.payment_id WHERE s.id=?',paymentId))!
    journalId=recorded.journal_id;feeId=recorded.fee_entry_id
  } else {
    journalId=row.journal_id??uid();const by=who(c.actor)
    const bank=(await one(c.db,'SELECT account_id FROM pt_bank_accounts WHERE id=?',s.bank_account_id))!
    const lines=[{...dimensions.coding('clearing'),accountId:bank.account_id,debit:row.amount_cents-bt.fee,credit:0}, { ...dimensions.coding('sales'),accountId:row.income_account_id,debit:0,credit:row.amount_cents-row.tip_cents,contactId:row.customer_id},...(row.tip_cents?[{...dimensions.coding('sales'),accountId:row.tip_account_id,debit:0,credit:row.tip_cents,contactId:row.customer_id}]:[]),...(bt.fee?[{...dimensions.coding('fees'),accountId:s.fee_account_id,debit:bt.fee,credit:0}]:[])].filter(l=>l.debit||l.credit)
    const statements:Sql[]=[...fences,guard('EXISTS(SELECT 1 FROM pt_terminal_payments WHERE id=? AND journal_id IS NULL)',row.id),guard("NOT EXISTS(SELECT 1 FROM pt_stripe_clearing_items WHERE payment_intent=? AND status IN ('posted','legacy-covered'))",pi.id),...entryStatements({id:journalId,date:row.sale_date,memo:`Terminal receipt SR-${row.id}: ${row.description}`,sourceKind:'bank',sourceId:row.id,preparedBy:row.created_by,preparedKind:'person',lines},by.email),q('UPDATE pt_terminal_payments SET journal_id=? WHERE id=? AND journal_id IS NULL',journalId,row.id),changed()]
    if(!row.journal_id)await run(c.db,statements)
  }
  await run(c.db,[...fences,q("UPDATE pt_terminal_payments SET status='succeeded',brand=?,last4=?,journal_id=?,fee_entry_id=?,fee_cents=? WHERE id=?",text(card.brand,'Card brand',30),card.last4,journalId,feeId,bt.fee,row.id),audit(who(c.actor),'terminal.received','terminal-payment',row.id,{paymentIntent:pi.id,amount:row.amount_cents,tip:row.tip_cents,fee:bt.fee,brand:card.brand,last4:card.last4})])
  return selected(c.db,row.id)
}
export const terminalCommands:Record<string,Command>={
  'terminal.settings':settings,'terminal.prepare':prepare,'terminal.process':process,
  'terminal.sync':{need:'owner',run:(c,b)=>{inputFields(b,['id']);return syncTerminal(c,text(b.id,'Terminal payment'))}},
  'terminal.list':{need:'owner',run:(c,b)=>{inputFields(b,[]);return terminalView(c.db)}},
  'terminal.readers':{need:'owner',async run(c,b){inputFields(b,[]);const {key}=await connection(c.env,c.db);const r=await stripeCall(key,'GET','/terminal/readers',{limit:100});return {readers:(r.data??[]).map((x:Data)=>({id:x.id,label:x.label,status:x.status,deviceType:x.device_type})),hasMore:!!r.has_more}}},
}
