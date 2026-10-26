import { authority, must, who } from '../access'
import { bankAuthority } from '../access-policy/banks'
import { withinLimit } from '../issuing-limits'
import { cents, date, now, requireThat, text, uid } from '../core'
import { assertOpen, approval, audit, changed, guard, one, periodOpen, q, run } from '../db'
import type { Command } from '../context'
import { stripeCall, unseal } from '../stripe-api'
import { stripeSettings } from '../stripe'
import { refund, refundSource } from './store'
import { refundOutcome } from './posting'

const prepare: Command = { need: 'record', async run(c,b) {
  requireThat(c.actor.kind === 'person', 'A person prepares a refund', 403)
  const kind = text(b.sourceKind, 'Refund source'); requireThat(['payment','credit'].includes(kind), 'Choose a payment or credit')
  const sourceId = text(b.sourceId, 'Refund source'), source = await refundSource(c.db, kind, sourceId)
  const amount = cents(b.amount, 'Refund amount'), day = date(b.date, 'Refund date'), reason = text(b.reason, 'Refund reason', 500)
  requireThat(amount <= source.available, 'Refund exceeds the available customer balance', 409)
  requireThat(day >= (source.row.payment_date ?? source.row.issue_date), 'Refund on or after the source date')
  await assertOpen(c.db, day)
  const method = text(b.method, 'Refund method'); requireThat(['recorded','stripe'].includes(method), 'Record an outside refund or refund through Stripe')
  const paymentId = kind === 'payment' ? sourceId : b.paymentId ? text(b.paymentId, 'Original Stripe payment') : null
  let paymentIntent = null
  let bankId = text(b.bankAccountId, 'Refund bank account'), providerAccount = null
  if (method === 'stripe') {
    const payment = await one(c.db, "SELECT s.*,p.contact_id FROM pt_stripe_payments s JOIN pt_payments p ON p.id=s.payment_id WHERE s.payment_id=? AND s.status='succeeded' AND p.reversal_id IS NULL", paymentId)
    const stripe = await stripeSettings(c.db); requireThat(stripe, 'Connect Stripe first', 409)
    if (payment) {
      requireThat(payment.contact_id === source.row.customer_id, 'Choose this customer’s successful original Stripe payment', 409)
      paymentIntent = payment.payment_intent
    } else {
      const original = await one(c.db, "SELECT * FROM pt_payments WHERE id=? AND direction='received' AND reversal_id IS NULL", paymentId)
      requireThat(original && original.contact_id === source.row.customer_id, 'Choose this customer’s original payment', 409)
      const intent = await stripeCall(await unseal(c.env,stripe.key_sealed),'GET',`/payment_intents/${encodeURIComponent(original.reference)}`)
      requireThat(intent.status === 'succeeded' && intent.currency === 'usd' && intent.amount_received === original.amount_cents && intent.metadata?.pantry_invoice && await one(c.db, "SELECT 1 FROM pt_allocations WHERE source_kind='payment' AND source_id=? AND target_kind='invoice' AND target_id=?", original.id, intent.metadata.pantry_invoice), 'Stripe must confirm the exact recorded payment and its invoice', 409)
      paymentIntent = intent.id
    }
    if (kind === 'credit') requireThat(await one(c.db, "SELECT 1 FROM pt_allocations WHERE source_kind='payment' AND source_id=? AND target_id=?", paymentId, source.row.credit_for), 'Refund the payment for the credited invoice', 409)
    bankId = stripe.bank_account_id; providerAccount = stripe.account_id
  }
  const bank = await one(c.db, 'SELECT b.id FROM pt_bank_accounts b JOIN pt_accounts a ON a.id=b.account_id WHERE b.id=? AND a.active=1 AND a.type=\'asset\'', bankId)
  requireThat(bank, 'Choose an active bank account')
  const id = uid()
  await run(c.db, [authority(c.actor,'record'), ...bankAuthority(c.actor,[bankId]), periodOpen(day),
    q("INSERT INTO pt_customer_refunds(id,source_kind,source_id,customer_id,invoice_id,payment_id,amount_cents,refund_date,bank_account_id,method,reason,status,revision,prepared_by,provider_account,payment_intent,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?,?)", id,kind,sourceId,source.row.customer_id,kind==='credit'?source.row.credit_for:null,paymentId,amount,day,bankId,method,reason,uid(),c.actor.email,providerAccount,paymentIntent,now(),now()),
    audit(who(c.actor),'customer-refund.prepare','customer-refund',id,{sourceKind:kind,sourceId,amount,method})])
  return refund(c.db,id)
} }
const approve: Command = { need: 'post', async run(c,b) {
  const row = await refund(c.db,text(b.id,'Refund'))
  requireThat(row.status==='draft' && row.revision===b.revision,'Refund changed; reload',409)
  requireThat(c.actor.kind==='person','A person approves refunds',403)
  const source = await refundSource(c.db,row.source_kind,row.source_id)
  requireThat(row.amount_cents<=source.available,'Refund exceeds the available customer balance',409)
  const self = row.prepared_by===c.actor.email && c.actor.role!=='owner' ? await withinLimit(c.db,c.actor,{...row,kind:'credit',total_cents:row.amount_cents,credit_for:row.source_kind==='credit'?source.row.credit_for:(await one(c.db,"SELECT target_id FROM pt_allocations WHERE source_kind='payment' AND source_id=? AND target_kind='invoice' LIMIT 1",row.source_id))?.target_id},b.limitRevision) : null
  await run(c.db,[authority(c.actor,'post'),...bankAuthority(c.actor,[row.bank_account_id],'post'),...(self?.fences??[]),...(self && row.source_kind==='payment' ? [guard("NOT EXISTS(SELECT 1 FROM pt_allocations a JOIN pt_invoices i ON i.id=a.target_id WHERE a.source_kind='payment' AND a.source_id=? AND json_extract(i.self_approval,'$.person')=?)",row.source_id,c.actor.email)] : []),periodOpen(row.refund_date),
    q("UPDATE pt_customer_refunds SET status='approved',approved_by=?,self_approval=?,revision=?,updated_at=? WHERE id=? AND status='draft' AND revision=?",c.actor.email,self?JSON.stringify(self.detail):null,uid(),now(),row.id,row.revision),changed(),
    approval(who(c.actor),'customer-refund',row.id,row.revision,'approve','approved',self?.note??'Second-person refund approval'),
    audit(who(c.actor),'customer-refund.approve','customer-refund',row.id,{amount:row.amount_cents,selfApproval:self?.detail??null})])
  return refund(c.db,row.id)
} }
const post: Command = { need:'post',async run(c,b) {
  let row = await refund(c.db,text(b.id,'Refund'))
  if(row.status==='succeeded')return row
  requireThat(['approved','pending'].includes(row.status),'Approve this refund before posting',409)
  const fences=[authority(c.actor,'post'),...bankAuthority(c.actor,[row.bank_account_id],'post'),periodOpen(row.refund_date)]
  must(c.actor,'post'); await assertOpen(c.db,row.refund_date)
  if(row.method==='recorded')return refundOutcome(c.db,row.id,{amount:row.amount_cents,currency:'usd',status:'succeeded'},fences,who(c.actor))
  const stripe=await stripeSettings(c.db)
  requireThat(stripe && stripe.account_id===row.provider_account,'The connected Stripe account changed',409)
  requireThat(row.payment_intent,'Original Stripe payment unavailable',409)
  await run(c.db,[...fences,guard('EXISTS(SELECT 1 FROM pt_stripe WHERE account_id=? AND revision=?)',stripe.account_id,stripe.revision),q("UPDATE pt_customer_refunds SET status='pending',updated_at=? WHERE id=? AND status IN ('approved','pending')",now(),row.id),changed()])
  const key=await unseal(c.env,stripe.key_sealed)
  const outcome=row.provider_id ? await stripeCall(key,'GET',`/refunds/${encodeURIComponent(row.provider_id)}`) : await stripeCall(key,'POST','/refunds',{payment_intent:row.payment_intent,amount:row.amount_cents,metadata:{pantry_refund:row.id}},`pantry-refund-${row.id}`)
  return refundOutcome(c.db,row.id,outcome)
} }
const cancel: Command={need:'post',async run(c,b){
  const row=await refund(c.db,text(b.id,'Refund'));requireThat(['draft','approved'].includes(row.status),'A submitted refund must retain its provider outcome',409)
  await run(c.db,[authority(c.actor,'post'),...bankAuthority(c.actor,[row.bank_account_id],'post'),q("UPDATE pt_customer_refunds SET status='canceled',revision=?,updated_at=? WHERE id=? AND revision=? AND status IN ('draft','approved')",uid(),now(),row.id,b.revision),changed(),audit(who(c.actor),'customer-refund.cancel','customer-refund',row.id)])
  return refund(c.db,row.id)
}}
export const refundCommands={'customer-refund.prepare':prepare,'customer-refund.approve':approve,'customer-refund.post':post,'customer-refund.cancel':cancel}
