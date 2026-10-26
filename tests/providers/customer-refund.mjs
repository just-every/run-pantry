// Run only via the authorized credential injector, with Stripe test access.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { harness,books } from '../api/harness.mjs'
import { stripeRefundScenario } from '../api/customer-refunds-journey.mjs'

const key=process.env.STRIPE_TEST_SECRET_KEY
assert.ok(key && key.includes('_test_'),'Stripe test access is required')
const stripe=async(path,params)=>{
  const r=await fetch(`https://api.stripe.com/v1${path}`,{method:params?'POST':'GET',headers:{authorization:`Bearer ${key}`,'content-type':'application/x-www-form-urlencoded'},...(params?{body:new URLSearchParams(params)}:{})})
  assert.equal(r.status,200,`Stripe HTTP ${r.status}`);return r.json()
}
async function retainReceipt(receipt, result = {}) {
  const intent=await stripe(`/payment_intents/${receipt.payment_intent}`)
  assert.equal(receipt.status,'succeeded');assert.equal(receipt.amount,20000);assert.equal(intent.livemode,false)
  const proof={ranAt:new Date().toISOString(),testMode:!intent.livemode,amount:receipt.amount,currency:receipt.currency,status:receipt.status,refundId:receipt.id,paymentIntent:receipt.payment_intent,charge:receipt.charge,providerCreated:receipt.created,pantryRefund:receipt.metadata.pantry_refund,journalId:result.refund?.journal_id??null}
  if(process.env.PANTRY_REFUND_RECEIPT)await writeFile(process.env.PANTRY_REFUND_RECEIPT,JSON.stringify(proof,null,2)+'\n')
  console.log(JSON.stringify(proof))
}
if(process.argv.includes('--confirm-recent')) {
  const list=await stripe('/refunds?limit=10')
  const receipt=list.data.find(r=>r.amount===20000&&r.status==='succeeded'&&r.metadata.pantry_refund&&r.created>=Date.parse('2026-10-26T06:55:00Z')/1000)
  assert.ok(receipt,'No refund from this authorized run was found')
  await retainReceipt(receipt)
  process.exit(0)
}
const date=new Date().toISOString().slice(0,10)
const h=await harness({clock:`${date}T12:00:00Z`,outbound:async request=>{const response=await fetch(request.url,{method:request.method,headers:Object.fromEntries(['authorization','content-type','stripe-version','idempotency-key'].filter(n=>request.headers.has(n)).map(n=>[n,request.headers.get(n)])),...(!['GET','HEAD'].includes(request.method)?{body:await request.text()}:{})});return new Response(await response.arrayBuffer(),{status:response.status,headers:Object.fromEntries(response.headers)})}})
try {
  const {acct}=await books(h)
  const result=await stripeRefundScenario({h,acct,key,date,createIntent:({amount,invoiceId})=>stripe('/payment_intents',{amount:String(amount),currency:'usd',payment_method:'pm_card_visa',confirm:'true','automatic_payment_methods[enabled]':'true','automatic_payment_methods[allow_redirects]':'never','metadata[pantry_invoice]':invoiceId})})
  const receipt=await stripe(`/refunds/${result.refund.provider_id}`)
  await retainReceipt(receipt,result)
} finally {await h.close()}
