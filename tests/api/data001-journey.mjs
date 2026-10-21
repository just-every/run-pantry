import assert from 'node:assert/strict'
import { Log, LogLevel } from 'miniflare'
import { books, harness } from './harness.mjs'

export async function data001Journey(t) {
  const secrets=['synthetic-pantry-1001','synthetic-pantry-1002','synthetic-pantry-2001','synthetic-pantry-2002','synthetic-pantry-3001','synthetic-pantry-3002','synthetic-pantry-4001','synthetic-pantry-4002','synthetic-pantry-7001','synthetic-pantry-7002']
  const calls=[], logs=[]
  let stripeFailure=false, modelFailure=false, oauth=0
  class CapturedLog extends Log { log(message){logs.push(message)} }
  const h=await harness({log:new CapturedLog(LogLevel.INFO),bindings:{PLAID_CLIENT_ID:secrets[4],PLAID_SECRET:secrets[5],PLAID_ENV:'sandbox',GUSTO_CLIENT_ID:secrets[6],GUSTO_CLIENT_SECRET:secrets[7]},outbound:async request=>{
    const u=new URL(request.url), body=request.method==='POST'?await request.json():null
    calls.push({host:u.host,path:u.pathname,auth:request.headers.get('authorization'),key:request.headers.get('x-api-key'),body})
    if(u.host==='api.stripe.com')return stripeFailure?Response.json({error:{message:secrets.join(' ')}},{status:401}):Response.json({id:'synthetic-pantry-stripe',country:'US',default_currency:'usd',settings:{dashboard:{display_name:'Rivera Studio'}}})
    if(u.host==='sandbox.plaid.com') {
      if(u.pathname==='/item/public_token/exchange')return Response.json({item_id:'synthetic-pantry-item',access_token:secrets[4]})
      if(u.pathname==='/accounts/get')return Response.json({accounts:[],item:{item_id:'synthetic-pantry-item'}})
      if(u.pathname==='/item/remove')return Response.json({request_id:'synthetic-pantry-remove'})
    }
    if(u.host==='api.gusto-demo.com') {
      if(u.pathname==='/oauth/token'){oauth++;return Response.json({access_token:secrets[oauth===1?6:8],refresh_token:secrets[oauth===1?7:9],expires_in:7200})}
      if(u.pathname==='/v1/token_info')return Response.json({resource:{type:'Company',uuid:'synthetic-pantry-company'}})
      if(u.pathname==='/v1/companies/synthetic-pantry-company')return Response.json({uuid:'synthetic-pantry-company',name:'Rivera Studio Payroll'})
    }
    if(u.host==='api.anthropic.com') {
      if(modelFailure)return Response.json({error:{message:secrets.join(' ')}},{status:500})
      return Response.json({content:[{type:'text',text:JSON.stringify({receipt:true,vendor:'Example Hardware',date:'2026-03-03',total:'19.49',tax:'1.49',currency:'USD',category:'6300',note:''})}],stop_reason:'end_turn'})
    }
    throw new Error('Unexpected provider path '+u.host+u.pathname)
  }})
  t.after(h.close)
  const {acct}=await books(h), viewer=await h.member('data-viewer@example.test','viewer'),keeper=await h.member('data-keeper@example.test','bookkeeper')
  await h.view('data-flows',viewer,403);await h.view('data-flows',keeper,403)
  const noAuth=await h.send('/api/pantry/data-flows');assert.equal(noAuth.status,401)
  assert.ok((await h.view('data-flows')).services.filter(s=>!['mail'].includes(s.id)).every(s=>!s.connected))
  await h.command('feed.connect',{publicToken:'synthetic-pantry-5001'},keeper,403)
  const feed=await h.command('feed.connect',{publicToken:'synthetic-pantry-5001',institution:{name:'Rivera Community Bank'}})
  await h.command('stripe.connect',{secretKey:secrets[0]},keeper,403)
  await h.command('stripe.connect',{secretKey:secrets[0]})
  const firstSeal=(await h.db.prepare('SELECT key_sealed FROM pt_stripe').first()).key_sealed
  await h.command('stripe.connect',{secretKey:secrets[1]})
  const replacement=(await h.db.prepare('SELECT key_sealed FROM pt_stripe').first()).key_sealed
  assert.notEqual(firstSeal,replacement)
  assert.deepEqual(calls.filter(c=>c.host==='api.stripe.com').map(c=>c.auth),secrets.slice(0,2).map(s=>'Bearer '+s))
  await h.command('reader.save',{provider:'anthropic',key:secrets[2]})
  await h.command('reader.test',{})
  await h.command('reader.save',{provider:'anthropic',key:secrets[3]})
  await h.command('reader.test',{})
  assert.deepEqual(calls.filter(c=>c.host==='api.anthropic.com').map(c=>c.key),secrets.slice(2,4))
  const consent=await h.command('gusto.connect',{}),state=new URL(consent.url).searchParams.get('state')
  assert.equal((await h.send('/api/pantry/gusto/callback?'+new URLSearchParams({state,code:'synthetic-pantry-6001'}),undefined,{cookie:h.owner})).status,303)
  // Re-consent rotates the stored OAuth pair through the real callback door.
  const oldOAuth=(await h.db.prepare('SELECT access_sealed FROM pt_gusto').first()).access_sealed
  const second=await h.command('gusto.connect',{})
  assert.equal((await h.send('/api/pantry/gusto/callback?'+new URLSearchParams({state:new URL(second.url).searchParams.get('state'),code:'synthetic-pantry-6002'}),undefined,{cookie:h.owner})).status,303)
  assert.notEqual((await h.db.prepare('SELECT access_sealed FROM pt_gusto').first()).access_sealed,oldOAuth)
  assert.deepEqual(calls.filter(c=>c.path==='/v1/token_info').map(c=>c.auth),[secrets[6],secrets[8]].map(s=>'Bearer '+s))
  const address=await h.command('receipt-address.create',{mailbox:'receipts@rivera.example'})
  const tag=(await h.db.prepare('SELECT tag_sealed FROM pt_receipt_inbox').first()).tag_sealed
  await h.command('receipt-address.create',{mailbox:'receipts@rivera.example'})
  assert.notEqual((await h.db.prepare('SELECT tag_sealed FROM pt_receipt_inbox').first()).tag_sealed,tag)
  const hook=await h.command('webhook.create',{destination:'https://hooks.rivera.example/books',events:['approved','paid']})
  const inventory=await h.view('data-flows'),service=id=>inventory.services.find(s=>s.id===id)
  for(const id of ['plaid','stripe','model','gusto','inbound']) {
    const row=service(id);assert.equal(row.connected,true,id)
    assert.ok(row.sends&&row.receives&&row.path&&row.broker&&row.fees&&row.biller&&row.controls,id)
  }
  assert.ok(service('plaid').fees.includes('per-connection'));assert.ok(service('plaid').broker.includes('Pantry Connect'))
  assert.ok(service('mail').fees.includes('message'));assert.equal(service('inbound').detail,(await h.view('receipts')).inbox.address)
  assert.ok(inventory.unavailable.find(s=>s.name==='Pantry Connect mail').path.includes('until the carrier accepts'))
  assert.ok(inventory.unavailable.find(s=>s.name==='Pantry Connect inbound address').path.includes('holding period'))
  assert.deepEqual(inventory.webhooks[0],{id:hook.id,host:'hooks.rivera.example',events:['approved','paid'],enabled:true,payload:['id','type','time','record.kind','record.id','record.revision','record.status']})
  stripeFailure=true
  await h.command('stripe.connect',{secretKey:secrets[0]},h.owner,400)
  assert.equal((await h.db.prepare('SELECT key_sealed FROM pt_stripe').first()).key_sealed,replacement,'a failed rotation preserves the working connection')
  modelFailure=true
  const failed=await h.command('reader.test',{});assert.equal(failed.ok,false)
  const before=await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
  await h.command('reader.remove',{})
  const readCount=calls.filter(c=>c.host==='api.anthropic.com').length
  const form=new FormData();form.set('file',new Blob([Buffer.from('%PDF-1.4 Rivera receipt for manual entry')],{type:'application/pdf'}),'rivera.pdf');form.set('source','upload')
  const captured=await fetch(h.origin+'/api/pantry/receipts/capture',{method:'POST',headers:{origin:h.origin,cookie:h.owner},body:form})
  assert.equal(captured.status,200)
  const capturedId=(await captured.json()).id
  const receipt=(await h.view('receipts')).review.find(r=>r.id===capturedId)
  assert.equal(receipt.read_status,'no-key');assert.equal(calls.filter(c=>c.host==='api.anthropic.com').length,readCount)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'),before)
  assert.equal((await h.view('data-flows')).services.find(s=>s.id==='stripe').connected,true)
  stripeFailure=false
  await h.command('stripe.disconnect',{});await h.command('gusto.disconnect',{});await h.command('feed.disconnect',{itemId:feed.id});await h.command('receipt-address.remove',{})
  assert.ok((await h.view('data-flows')).services.filter(s=>s.id!=='mail').every(s=>!s.connected))
  const publicData=JSON.stringify([inventory,failed,await h.view('activity'),await h.view('invoicing'),await h.view('connected'),await h.view('bank/feeds'),logs])
  for(const value of [...secrets,hook.secret,firstSeal,replacement,oldOAuth,tag])assert.ok(!publicData.includes(value),'no credential or ciphertext in views, Activity or server logs')
  const sensitiveBody=calls.find(c=>c.host==='api.anthropic.com').body
  assert.ok(!JSON.stringify(sensitiveBody).includes('Rivera Community Bank'),'the model receives the task, not all financial records')
  assert.ok(address.address)
  assert.ok(acct['4000'])
}
