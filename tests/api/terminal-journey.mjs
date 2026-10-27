import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

export function terminalProvider() {
  const intents=new Map(),intentKeys=new Map(),calls=[],reader={id:'synthetic-pantry-reader',status:'online',device_type:'simulated_wisepos_e',action:null}
  let wrongAmount=false,uncertainCreate=false,uncertainReader=false
  return {intents,calls,reader,set uncertainCreate(value){uncertainCreate=value},set uncertainReader(value){uncertainReader=value},set wrongAmount(value){wrongAmount=value},async outbound(request){
    const u=new URL(request.url),p=u.pathname.replace('/v1',''),body=new URLSearchParams(request.method==='POST'?await request.text():'')
    calls.push([request.method,p,request.headers.get('idempotency-key')])
    if(p==='/account')return Response.json({id:'synthetic-pantry-account',country:'US',default_currency:'usd'})
    if(p==='/terminal/readers')return Response.json({data:[reader],has_more:false})
    if(p===`/terminal/readers/${reader.id}`)return Response.json(reader)
    if(p==='/payment_intents' && request.method==='POST'){
      const requestKey=request.headers.get('idempotency-key')
      if(intentKeys.has(requestKey))return Response.json(intents.get(intentKeys.get(requestKey)))
      const id=`synthetic-pantry-intent-${intents.size+1}`,amount=Number(body.get('amount'))
      const intent={id,amount,currency:'usd',status:'requires_payment_method',amount_received:0,metadata:{pantry_terminal:body.get('metadata[pantry_terminal]')}}
      intents.set(id,intent);intentKeys.set(requestKey,id)
      if(uncertainCreate){uncertainCreate=false;return Response.json({error:{}},{status:503})}
      return Response.json(intent)
    }
    if(p.startsWith('/payment_intents/')){
      const pi=structuredClone(intents.get(p.split('/').at(-1)))
      if(wrongAmount)pi.amount_received++
      return Response.json(pi)
    }
    if(p.endsWith('/process_payment_intent')){reader.action={status:'in_progress',process_payment_intent:{payment_intent:body.get('payment_intent')}};if(uncertainReader){uncertainReader=false;return Response.json({error:{}},{status:503})};return Response.json(reader)}
    if(p==='/balance_transactions')return Response.json({data:[...intents.values()].filter(pi=>pi.status==='succeeded').map(pi=>({...pi.latest_charge.balance_transaction,type:'charge',reporting_category:'charge',source:{...pi.latest_charge,metadata:pi.metadata}})),has_more:false})
    if(p==='/payouts')return Response.json({data:[],has_more:false})
    if(p==='/balance')return Response.json({available:[{currency:'usd',amount:[...intents.values()].filter(pi=>pi.status==='succeeded').reduce((sum,pi)=>sum+pi.latest_charge.balance_transaction.net,0)}],pending:[]})
    if(p==='/events')return Response.json({data:[],has_more:false})
    assert.fail(`Unexpected provider request: ${request.method} ${p}`)
  },complete(id,fee=400){
    const pi=intents.get(id);Object.assign(pi,{status:'succeeded',amount_received:pi.amount,latest_charge:{id:`synthetic-pantry-charge-${id}`,payment_intent:id,paid:true,amount:pi.amount,currency:'usd',payment_method_details:{type:'card_present',card_present:{brand:'visa',last4:'4242',unexpected_pan:'should-not-be-retained'}},balance_transaction:{id:`synthetic-pantry-balance-${id}`,amount:pi.amount,fee,net:pi.amount-fee,currency:'usd',created:1793102400}}});reader.action={status:'succeeded',process_payment_intent:{payment_intent:id}}
  }}
}

export async function terminalJourney() {
  const edge=terminalProvider(),h=await harness({outbound:r=>edge.outbound(r),clock:'2026-10-27T12:00:00Z'})
  try {
    const {acct}=await books(h)
    const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic Pantry customer'})
    const viewer=await h.member('terminal-viewer@example.test','viewer')
    const clerk=await h.member('terminal-clerk@example.test','bookkeeper',{post:true})
    await h.command('stripe.connect',{secretKey:'synthetic-pantry-64'})
    await h.command('terminal.settings',{tipAccountId:acct['4000']},viewer,403)
    await h.command('terminal.settings',{tipAccountId:acct['4000']},clerk,403)
    const tips=await h.command('account.save',{code:'2250',name:'Tips payable',type:'liability',subtype:'other'})
    await h.command('terminal.settings',{tipAccountId:tips.id})
    assert.deepEqual((await h.command('terminal.readers',{})).readers,[{id:edge.reader.id,status:'online',deviceType:'simulated_wisepos_e'}])
    const sale={requestId:'synthetic-pantry-sale',readerId:edge.reader.id,date:'2026-10-27',customerId:customer.id,description:'Exempt service',amount:'120.00',tip:'18.00',incomeAccountId:acct['4000'],taxTreatment:'exempt',taxReason:'Synthetic exempt service'}
    await h.command('terminal.prepare',sale,viewer,403)
    await h.command('terminal.prepare',{...sale,cardNumber:'synthetic-pantry-65'},h.owner,400)
    await h.command('terminal.prepare',{...sale,taxTreatment:'taxable'},h.owner,409)
    edge.reader.status='offline';await h.command('terminal.prepare',sale,h.owner,409);edge.reader.status='online'
    let payment=await h.command('terminal.prepare',sale)
    assert.deepEqual([payment.amount_cents,payment.tip_cents,payment.status,payment.journal_id],[13800,1800,'prepared',null])
    await h.command('terminal.prepare',{...sale,amount:'121'},h.owner,409)
    assert.equal((await h.command('terminal.prepare',sale)).id,payment.id)
    payment=await h.command('terminal.process',{id:payment.id})
    await h.command('terminal.process',{id:payment.id})
    assert.equal(edge.calls.filter(([m,p])=>m==='POST'&&p==='/payment_intents').length,1)
    assert.deepEqual([(await h.command('terminal.sync',{id:payment.id})).status,(await h.view('journal')).entries.filter(e=>e.source_id==='synthetic-pantry-sale').length],['processing',0])
    edge.complete(payment.payment_intent)
    await h.command('terminal.sync',{id:payment.id,cardNumber:'synthetic-pantry-66'},h.owner,400)
    edge.wrongAmount=true;await h.command('terminal.sync',{id:payment.id},h.owner,409);edge.wrongAmount=false
    payment=await h.command('terminal.sync',{id:payment.id})
    assert.deepEqual([payment.status,payment.brand,payment.last4,payment.fee_cents],['succeeded','visa','4242',400])
    const posted=(await h.view('journal')).entries.filter(e=>e.source_id==='synthetic-pantry-sale')
    assert.equal(posted.length,1)
    assert.deepEqual(posted[0].lines.map(l=>[l.account_name,l.debit_cents,l.credit_cents]).sort(),[['Service revenue',0,12000],['Tips payable',0,1800],['Stripe balance',13400,0],['Stripe fees',400,0]].sort())
    assert.equal((await h.view('sales')).invoices.length,0,'The on-the-spot sale never creates a receivable')
    const stored=JSON.stringify((await h.db.prepare("SELECT * FROM pt_terminal_payments").all()).results)+JSON.stringify((await h.db.prepare('SELECT detail FROM pt_audit').all()).results)
    assert.ok(!stored.includes('unexpected_pan')&&!stored.includes('should-not-be-retained'),'Only the card summary is retained')
    await h.command('terminal.sync',{id:payment.id});await h.command('terminal.process',{id:payment.id})
    assert.equal((await h.view('journal')).entries.filter(e=>e.source_id==='synthetic-pantry-sale').length,1)
    // The same reader pays an issued invoice, with the existing provider payment accounting.
    let inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-27',dueDate:'2026-11-27',lines:[{description:'Invoice service',quantity:'1',rate:'75.00',accountId:acct['4000'],taxCode:'exempt'}]})
    inv=await h.command('invoice.issue',{id:(await h.command('invoice.approve',{id:inv.id,revision:inv.revision})).id})
    const restricted=await h.command('contact.save',{id:customer.id,revision:customer.revision,kind:'customer',name:customer.name,payMethods:['offline']})
    await h.command('terminal.prepare',{requestId:'synthetic-pantry-disabled-card',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'},h.owner,409)
    await h.command('contact.save',{id:customer.id,revision:restricted.revision,kind:'customer',name:customer.name,payMethods:null})
    let ip=await h.command('terminal.prepare',{requestId:'synthetic-pantry-invoice',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'})
    edge.uncertainCreate=true
    await h.command('terminal.process',{id:ip.id},h.owner,502)
    edge.uncertainReader=true
    await h.command('terminal.process',{id:ip.id},h.owner,502)
    ip=await h.command('terminal.process',{id:ip.id})
    assert.equal(edge.intents.size,2,'Uncertain intent and reader responses recover the same two payments')
    assert.equal(edge.calls.filter(([m,p])=>m==='POST'&&p.endsWith('/process_payment_intent')).length,2,'Recovery never asks either customer to present a second card')
    edge.complete(ip.payment_intent,200)
    ip=await h.command('terminal.sync',{id:ip.id})
    assert.deepEqual([ip.status,ip.reader_id,ip.amount_cents],['succeeded',payment.reader_id,7500])
    const sales=await h.view('sales');assert.equal(sales.invoices.find(i=>i.id===inv.id).open_cents,0)
    assert.equal(sales.payments.filter(p=>p.reference===ip.payment_intent).length,1)
    await h.command('terminal.sync',{id:ip.id})
    assert.equal((await h.view('sales')).payments.filter(p=>p.reference===ip.payment_intent).length,1)
    await h.command('terminal.prepare',{requestId:'synthetic-pantry-paid',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'},h.owner,409)
    const bank=await h.command('bank-account.save',{name:'Operating checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0.00'})
    const before=(await h.view('journal')).entries.length
    await h.command('stripe.payouts',{bankAccountId:bank.id,salesAccountId:acct['4000'],from:'2026-10-01'})
    const clearing=await h.view('stripe/clearing')
    assert.deepEqual(clearing.items.map(i=>[i.id,i.status]).sort(),[...edge.intents.values()].map(pi=>[pi.latest_charge.balance_transaction.id,'adopted']).sort())
    assert.deepEqual([clearing.differenceCents,clearing.ok,(await h.view('journal')).entries.length],[0,true,before],'Clearing adopts both Terminal records without posting their charges or fees twice')
    return {sale:payment.id,invoice:inv.number,amount:13800,tip:1800,brand:payment.brand,last4:payment.last4}
  } finally {await h.close()}
}

export async function terminalVoidJourney() {
  const edge=terminalProvider(),h=await harness({outbound:r=>edge.outbound(r),clock:'2026-10-27T12:00:00Z'})
  try {
    const {acct}=await books(h)
    const customer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-70'})
    await h.command('stripe.connect',{secretKey:'synthetic-pantry-71'})
    const issue=async()=>{
      let inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-27',lines:[{description:'synthetic-pantry-72',quantity:'1',rate:'75',accountId:acct['4000'],taxCode:'exempt'}]})
      await h.command('invoice.approve',{id:inv.id,revision:inv.revision})
      return h.command('invoice.issue',{id:inv.id})
    }
    const inv=await issue(),control=await issue()
    const voidRequest=i=>({id:i.id,revision:i.revision,date:'2026-10-27',reason:'synthetic-pantry-73'})
    assert.equal((await h.command('invoice.void',voidRequest(control))).status,'void','An invoice without a pending payment can still be voided')
    let payment=await h.command('terminal.prepare',{requestId:'synthetic-pantry-74',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'})
    payment=await h.command('terminal.process',{id:payment.id})
    const before=await h.view('journal'),action=structuredClone(edge.reader.action),calls=edge.calls.length
    await h.command('invoice.void',voidRequest(inv),h.owner,409)
    assert.deepEqual(await h.view('journal'),before,'Refused void never reverses the receivable')
    assert.deepEqual(edge.reader.action,action,'Refused void leaves reader collection intact')
    assert.equal(edge.calls.length,calls,'Voiding does not send a cancellation or collection instruction')
    const stored=(await h.view('sales')).invoices.find(i=>i.id===inv.id)
    assert.deepEqual([stored.status,stored.void_date,stored.open_cents],['issued',null,7500])
    edge.complete(payment.payment_intent,200)
    await h.command('terminal.sync',{id:payment.id})
    await h.command('invoice.void',voidRequest(inv),h.owner,409)
    assert.equal((await h.view('sales')).invoices.find(i=>i.id===inv.id).open_cents,0)
    const prepared=await issue()
    await h.command('terminal.prepare',{requestId:'synthetic-pantry-75',readerId:edge.reader.id,invoiceId:prepared.id,date:'2026-10-27'})
    await h.command('invoice.void',voidRequest(prepared),h.owner,409)
    edge.uncertainReader=true
    await h.command('terminal.process',{id:'synthetic-pantry-75'},h.owner,502)
    await h.command('invoice.void',voidRequest(prepared),h.owner,409)
    const pending=await h.command('erasure.preview',{kind:'contact',id:customer.id})
    assert.ok(pending.blockers.some(b=>b.kind==='terminal-payment' && b.id==='synthetic-pantry-75'))
  } finally {await h.close()}
}

export async function terminalErasureJourney() {
  const edge=terminalProvider(),h=await harness({outbound:r=>edge.outbound(r),clock:'2026-10-27T12:00:00Z'})
  try {
    const {acct}=await books(h)
    const customer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-80',internalNotes:'synthetic-pantry-82',contacts:[{name:'synthetic-pantry-81',phone:'555-0181',roles:['primary']}]})
    const other=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-83'})
    await h.command('stripe.connect',{secretKey:'synthetic-pantry-84'})
    const collect=async(id,customerId,description,taxReason)=>{
      let p=await h.command('terminal.prepare',{requestId:id,readerId:edge.reader.id,date:'2026-10-27',customerId,description,taxReason,amount:'120',incomeAccountId:acct['4000'],taxTreatment:'exempt'})
      p=await h.command('terminal.process',{id:p.id});edge.complete(p.payment_intent)
      return h.command('terminal.sync',{id:p.id})
    }
    const own=await collect('synthetic-pantry-85',customer.id,'Receipt for synthetic-pantry-81','synthetic-pantry-82')
    const copy=await collect('synthetic-pantry-86',other.id,'Copied synthetic-pantry-81','Copied synthetic-pantry-82')
    const untouched=await collect('synthetic-pantry-87',other.id,'synthetic-pantry-88','synthetic-pantry-89')
    const before=await h.view('journal'),preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
    assert.deepEqual(preview.blockers,[])
    const receipt=await h.command('erasure.execute',{kind:'contact',id:customer.id,fingerprint:preview.fingerprint,requester:'synthetic-pantry-90',channel:'in-person',reason:'synthetic-pantry-91',confirm:'ERASE'})
    const payments=(await h.command('terminal.list',{})).payments
    for(const id of [own.id,copy.id]) {
      const p=payments.find(p=>p.id===id)
      assert.ok(p,'The financial Terminal record is retained')
      assert.ok(!JSON.stringify(p).includes('synthetic-pantry-81')&&!JSON.stringify(p).includes('synthetic-pantry-82'),'Erasure removes personal receipt text and copied contact identity')
      const original=id===own.id?own:copy
      for(const field of ['amount_cents','tip_cents','fee_cents','brand','last4','journal_id','status','payment_intent'])assert.equal(p[field],original[field])
    }
    assert.deepEqual(payments.find(p=>p.id===untouched.id),untouched,'Unrelated receipts stay unchanged')
    assert.equal(receipt.counts.pt_terminal_payments.rowsReplaced,2)
    assert.ok(preview.classes.some(c=>c.table==='pt_terminal_payments'&&c.counts.rowsReplaced===2))
    assert.deepEqual(await h.view('journal'),before,'Erasure keeps posted accounting unchanged')
    const journal=JSON.stringify(before)
    assert.ok(!journal.includes('synthetic-pantry-81')&&!journal.includes('synthetic-pantry-82'),'Terminal journal memos never copy private receipt text')
    const contact=(await h.view('state')).contacts.find(c=>c.id===customer.id)
    assert.deepEqual([contact.name,contact.internal_notes,JSON.parse(contact.contacts_json)],['synthetic-pantry-80','[erased]',[]])
    assert.ok(!JSON.stringify(await h.view('activity')).includes('synthetic-pantry-81'))
    assert.deepEqual(await h.command('terminal.sync',{id:own.id}),payments.find(p=>p.id===own.id),'Sync never restores erased text')
    await h.command('terminal.prepare',{requestId:'synthetic-pantry-92',readerId:edge.reader.id,date:'2026-10-27',customerId:customer.id,description:'synthetic-pantry-93',taxReason:'synthetic-pantry-94',amount:'5',incomeAccountId:acct['4000'],taxTreatment:'exempt'},h.owner,409)
  } finally {await h.close()}
}
