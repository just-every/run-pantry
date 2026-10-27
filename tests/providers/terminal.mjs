// Held-key Stripe TEST proof through Pantry's authenticated command doors.
import assert from 'node:assert/strict'
import {execFileSync} from 'node:child_process'
import {mkdir,writeFile} from 'node:fs/promises'
import {join} from 'node:path'
import {harness,books} from '../api/harness.mjs'
const key=process.env.STRIPE_US_TEST_SECRET_KEY,proof=process.env.PANTRY_PROOF_DIR
assert.ok(key?.includes('_test_') && proof,'Inject Stripe TEST access and an external proof directory')
await mkdir(proof,{recursive:true,mode:0o700})
const receipt={head:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),testMode:true,startedAt:new Date().toISOString(),status:'running',providerCalls:[],isolatedEdges:['unrelated account event inventory']}
const retain=()=>writeFile(join(proof,'terminal-provider.json'),JSON.stringify(receipt,null,2)+'\n',{mode:0o600})
async function stripe(path,params,method=params?'POST':'GET') {
 const r=await fetch('https://api.stripe.com/v1'+path,{method,headers:{authorization:`Bearer ${key}`,'stripe-version':'2024-06-20','content-type':'application/x-www-form-urlencoded'},...(params?{body:new URLSearchParams(params)}:{}),signal:AbortSignal.timeout(30000)})
 const value=await r.json()
 receipt.providerCalls.push({path,method,http:r.status,...(!r.ok?{code:value.error?.code??null}:{})});await retain()
 assert.equal(r.status,200,`Stripe ${method} ${path} HTTP ${r.status}`)
 return value
}
let h,reader
try {
 const available=await stripe('/terminal/readers?limit=100'),location=available.data.find(r=>r.device_type==='simulated_wisepos_e')?.location
 assert.ok(location,'The held merchant needs a test Terminal location')
 reader=await stripe('/terminal/readers',{registration_code:'simulated-wpe',label:'Synthetic Pantry SALES-003',location})
 receipt.readerId=reader.id
 const clock=new Date().toISOString(),day=clock.slice(0,10)
 h=await harness({clock,outbound:async request=>{
   const u=new URL(request.url);assert.equal(u.hostname,'api.stripe.com')
   if(u.pathname==='/v1/events')return Response.json({data:[],has_more:false})
   const r=await fetch(request.url,{method:request.method,headers:Object.fromEntries(['authorization','content-type','stripe-version','idempotency-key'].filter(n=>request.headers.has(n)).map(n=>[n,request.headers.get(n)])),...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{}),signal:AbortSignal.timeout(30000)})
   const failure=!r.ok?await r.clone().json().catch(()=>({})):null
   receipt.providerCalls.push({path:u.pathname,method:request.method,http:r.status,...(failure?{type:failure.error?.type??null,code:failure.error?.code??null,param:failure.error?.param??null}:{} )});await retain()
   return new Response(await r.arrayBuffer(),{status:r.status,headers:{'content-type':'application/json'}})
 }})
 const {acct}=await books(h)
 await h.command('stripe.connect',{secretKey:key})
 const tip=await h.command('account.save',{code:'2250',name:'Tips payable',type:'liability',subtype:'other'})
 await h.command('terminal.settings',{tipAccountId:tip.id})
 const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic Pantry customer'})
 const requestId=`synthetic-pantry-${crypto.randomUUID()}`
 let sale=await h.command('terminal.prepare',{requestId,readerId:reader.id,date:day,customerId:customer.id,description:'Synthetic exempt service',amount:'120.00',tip:'18.00',incomeAccountId:acct['4000'],taxTreatment:'exempt',taxReason:'Synthetic TEST service'})
 sale=await h.command('terminal.process',{id:sale.id})
 await stripe(`/test_helpers/terminal/readers/${reader.id}/present_payment_method`,{type:'card_present'})
 for(let i=0;i<15;i++){sale=await h.command('terminal.sync',{id:sale.id});if(sale.status==='succeeded')break;await new Promise(r=>setTimeout(r,1000))}
 assert.deepEqual([sale.status,sale.amount_cents,sale.tip_cents,sale.brand,sale.last4],['succeeded',13800,1800,'visa','4242'])
 const entry=(await h.view('journal')).entries.find(e=>e.id===sale.journal_id)
 assert.ok(entry);assert.equal(entry.lines.find(l=>l.account_id===tip.id).credit_cents,1800)
 assert.equal(entry.lines.find(l=>l.account_id===acct['4000']).credit_cents,12000)
 await h.command('terminal.sync',{id:sale.id});assert.equal((await h.view('journal')).entries.filter(e=>e.source_id===sale.id).length,1)
 receipt.sale={id:sale.id,paymentIntent:sale.payment_intent,amount:13800,tip:1800,fee:sale.fee_cents,brand:sale.brand,last4:sale.last4,journalId:sale.journal_id}
 let inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:day,dueDate:day,lines:[{description:'Synthetic invoice service',quantity:'1',rate:'5.00',accountId:acct['4000'],taxCode:'exempt'}]})
 inv=await h.command('invoice.issue',{id:(await h.command('invoice.approve',{id:inv.id,revision:inv.revision})).id})
 let payment=await h.command('terminal.prepare',{requestId:`synthetic-pantry-${crypto.randomUUID()}`,readerId:reader.id,date:day,invoiceId:inv.id})
 payment=await h.command('terminal.process',{id:payment.id})
 await stripe(`/test_helpers/terminal/readers/${reader.id}/present_payment_method`,{type:'card_present'})
 for(let i=0;i<15;i++){payment=await h.command('terminal.sync',{id:payment.id});if(payment.status==='succeeded')break;await new Promise(r=>setTimeout(r,1000))}
 assert.equal(payment.status,'succeeded');assert.equal(payment.reader_id,sale.reader_id)
 assert.equal((await h.view('sales')).invoices.find(i=>i.id===inv.id).open_cents,0)
 receipt.invoice={number:inv.number,paymentIntent:payment.payment_intent,amount:500,open:0,readerId:payment.reader_id}
 const balance=await stripe('/balance?expand[]=instant_available.net_available')
 receipt.instantPayout={instantAvailable:balance.instant_available??null,proven:false,reason:'No eligible instant balance or provider fee quote is available; no payout was requested.'}
 receipt.status='completed';await retain()
 console.log(JSON.stringify({head:receipt.head,status:receipt.status,sale:receipt.sale,invoice:receipt.invoice,instantPayout:receipt.instantPayout}))
} catch(error) {receipt.status='failed';receipt.failure={name:error.name,message:String(error.message).replace(/(?:sk|rk)_test_\S+/g,'<REDACTED>')};await retain();throw error}
finally {await h?.close();if(reader)await stripe(`/terminal/readers/${reader.id}`,null,'DELETE')}
