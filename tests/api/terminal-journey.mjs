import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

export function terminalProvider() {
  const intents=new Map(),calls=[],reader={id:'synthetic-pantry-reader',status:'online',device_type:'simulated_wisepos_e',action:null}
  let wrongAmount=false
  return {intents,calls,reader,set wrongAmount(value){wrongAmount=value},async outbound(request){
    const u=new URL(request.url),p=u.pathname.replace('/v1',''),body=new URLSearchParams(request.method==='POST'?await request.text():'')
    calls.push([request.method,p,request.headers.get('idempotency-key')])
    if(p==='/account')return Response.json({id:'synthetic-pantry-account',country:'US',default_currency:'usd'})
    if(p==='/terminal/readers')return Response.json({data:[reader],has_more:false})
    if(p===`/terminal/readers/${reader.id}`)return Response.json(reader)
    if(p==='/payment_intents' && request.method==='POST'){
      const id=`synthetic-pantry-intent-${intents.size+1}`,amount=Number(body.get('amount'))
      const intent={id,amount,currency:'usd',status:'requires_payment_method',amount_received:0,metadata:{pantry_terminal:body.get('metadata[pantry_terminal]')}}
      intents.set(id,intent);return Response.json(intent)
    }
    if(p.startsWith('/payment_intents/')){
      const pi=structuredClone(intents.get(p.split('/').at(-1)))
      if(wrongAmount)pi.amount_received++
      return Response.json(pi)
    }
    if(p.endsWith('/process_payment_intent')){reader.action={status:'in_progress',process_payment_intent:{payment_intent:body.get('payment_intent')}};return Response.json(reader)}
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
    let ip=await h.command('terminal.prepare',{requestId:'synthetic-pantry-invoice',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'})
    ip=await h.command('terminal.process',{id:ip.id});edge.complete(ip.payment_intent,200)
    ip=await h.command('terminal.sync',{id:ip.id})
    assert.deepEqual([ip.status,ip.reader_id,ip.amount_cents],['succeeded',payment.reader_id,7500])
    const sales=await h.view('sales');assert.equal(sales.invoices.find(i=>i.id===inv.id).open_cents,0)
    assert.equal(sales.payments.filter(p=>p.reference===ip.payment_intent).length,1)
    await h.command('terminal.sync',{id:ip.id})
    assert.equal((await h.view('sales')).payments.filter(p=>p.reference===ip.payment_intent).length,1)
    await h.command('terminal.prepare',{requestId:'synthetic-pantry-paid',readerId:edge.reader.id,invoiceId:inv.id,date:'2026-10-27'},h.owner,409)
    return {sale:payment.id,invoice:inv.number,amount:13800,tip:1800,brand:payment.brand,last4:payment.last4}
  } finally {await h.close()}
}
