import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { books,harness } from './harness.mjs'

const endpoint='https://receiver.example.test/pantry?tenant=synthetic-pantry-1'
async function waitFor(read,predicate) {
  for(let i=0;i<600;i++){const value=await read();if(predicate(value))return value;await new Promise(r=>setTimeout(r,25))}
  assert.fail('Webhook background work did not finish')
}
const history=h=>h.view('webhooks').then(r=>r.history)
const subscription=(h,id)=>h.view('webhooks').then(r=>r.subscriptions.find(s=>s.id===id))
function signed(request,secret) {
  const expected='v1='+createHmac('sha256',secret).update(request.timestamp+'.'+request.body).digest('hex')
  assert.ok(request.signature.split(', ').includes(expected),'receiver verifies exact bytes with its saved secret')
}
const lead=(h,n)=>h.command('contact.save',{kind:'customer',name:`Juniper Workshop ${n}`,email:`synthetic-pantry-${n}@example.test`})

export async function webhookLifecycle(t) {
  const received=[];let failApproval=true
  const h=await harness({outbound:async request=>{
    const body=await request.text(),event=JSON.parse(body)
    received.push({body,event,timestamp:request.headers.get('pantry-timestamp'),signature:request.headers.get('pantry-signature'),id:request.headers.get('pantry-event-id'),redirect:request.redirect})
    return new Response(null,{status:event.type==='approved'&&failApproval?503:204})
  }});t.after(h.close)
  const {acct}=await books(h)
  const viewer=await h.member('viewer@example.test','viewer'),agent=await h.agent(),credential=await h.command('integration.create',{name:'Invoices only',scopes:['invoices:write']})
  const base={destination:endpoint,events:['created','approved','posted','paid','matched','locked']}
  const sub=await h.command('webhook.create',base)
  assert.ok(/^[a-f0-9]{64}$/.test(sub.secret),'256 random bits are shown to the owner')
  for(const op of ['webhook.create','webhook.edit','webhook.rotate','webhook.set-enabled','webhook.delete']) {
    await h.command(op,{...base,id:sub.id,revision:sub.revision,enabled:false},viewer,403)
    for(const token of [agent.token,credential.token])assert.equal((await h.send('/api/pantry/command/'+op,{...base,id:sub.id,revision:sub.revision},{headers:{authorization:`Bearer ${token}`}})).status,401)
  }
  await h.view('webhooks',viewer,403)
  for(const token of [agent.token,credential.token])assert.equal((await h.send('/api/pantry/webhooks',undefined,{headers:{authorization:`Bearer ${token}`}})).status,401)
  for(const destination of ['http://receiver.example.test','https://127.0.0.1','https://2130706433','https://[::1]','https://localhost','https://private.localhost','https://private.local','https://private.internal','https://private.arpa','https://singlelabel','https://user:password@receiver.example.test','https://receiver.example.test:444','https://receiver.example.test/#fragment']) {
    await h.command('webhook.create',{...base,destination},h.owner,400)
    await h.command('webhook.edit',{id:sub.id,revision:sub.revision,...base,destination},h.owner,400)
  }
  const customer=await lead(h,1)
  const bank=await h.command('bank-account.save',{name:'Operating checking',institution:'Community Bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-10-01',openingBalance:'0.00'})
  const invoiceBody={customerId:customer.id,issueDate:'2026-10-20',lines:[{description:'Private engagement memo',accountId:acct['4000'],quantity:'1',rate:'125.00',taxCode:'exempt'}]}
  const createInvoice=()=>h.send('/api/pantry/integration/v1/invoices',invoiceBody,{headers:{authorization:`Bearer ${credential.token}`,'idempotency-key':'synthetic-pantry-invoice'}})
  const created=await createInvoice();assert.equal(created.status,200);const invoice=created.value
  assert.equal((await createInvoice()).value.id,invoice.id)

  await h.command('invoice.approve',{id:invoice.id,revision:invoice.revision})
  await h.command('invoice.issue',{id:invoice.id})
  await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-21',bankAccountId:bank.id,amount:'125.00',allocations:[{targetId:invoice.id,amount:'125.00'}]})
  let attempts=await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===invoice.id&&r.eventType==='paid')&&rows.some(r=>r.record.id===invoice.id&&r.eventType==='approved'))
  const failed=attempts.find(r=>r.record.id===invoice.id&&r.eventType==='approved')
  assert.equal(failed.statusCode,503);assert.equal(failed.errorClass,'http')
  failApproval=false
  await h.cron(Date.parse(failed.at)+62_000)
  attempts=await history(h)
  assert.equal(attempts.filter(r=>r.eventId===failed.eventId).length,2)
  assert.equal(attempts.find(r=>r.eventId===failed.eventId&&r.attempt===2).outcome,'succeeded')
  // A failed native write leaves neither record nor event in the atomic outbox.
  const before=await h.db.prepare('SELECT count(*) n FROM pt_webhook_events').first()
  await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-21',bankAccountId:bank.id,amount:'999.00',allocations:[{targetId:invoice.id,amount:'999.00'}]},h.owner,400)
  assert.equal((await h.db.prepare('SELECT count(*) n FROM pt_webhook_events').first()).n,before.n)
  await h.command('close.tasks',{period:'2026-09'})
  const close=await h.view('close/2026-09')
  for(const task of close.tasks)await h.command('close.task',{id:task.id,revision:task.revision,done:true})
  await h.command('period.lock',{period:'2026-09'})
  const statement=await h.command('statement.import',{bankAccountId:bank.id,fileName:'october.csv',content:'Posting Date,Description,Amount\n10/21/2026,JUNIPER WORKSHOP,125.00\n',opening:'0',closing:'125.00',start:'2026-10-01',end:'2026-10-31',confirmLast4:'4821'})
  const state=await h.view('reconciliation/'+statement.statement.id)
  await h.command('match.approve',{bankLineIds:[state.lines[0].id],journalLineIds:[state.postings.find(p=>p.amount===12500||p.debit_cents===12500).id]})
  await waitFor(()=>history(h),rows=>rows.some(r=>r.eventType==='matched')&&rows.some(r=>r.eventType==='locked'))
  for(const delivery of received) {
    assert.equal(delivery.id,delivery.event.id);signed(delivery,sub.secret)
    assert.deepEqual(Object.keys(delivery.event).sort(),['id','record','time','type'])
    assert.deepEqual(Object.keys(delivery.event.record).sort(),['id','kind','revision','status'])
    assert.ok(Math.abs(Date.now()/1000-Number(delivery.timestamp))<300)
    assert.ok(!delivery.body.includes('Private engagement memo')&&!delivery.body.includes(customer.email))
  }
  const view=await h.view('webhooks'), activity=JSON.stringify(await h.view('activity'))
  assert.ok(!JSON.stringify(view).includes(sub.secret));assert.ok(!activity.includes(endpoint));assert.ok(!activity.includes(sub.secret))
  for(const row of view.history)assert.deepEqual(Object.keys(row).sort(),['at','attempt','durationMs','errorClass','eventId','eventType','host','outcome','record','statusCode'])
}

export async function webhookRetries(t) {
  const received=[];let responseStatus=302
  const h=await harness({outbound:async request=>{
    received.push({body:await request.text(),timestamp:request.headers.get('pantry-timestamp'),signature:request.headers.get('pantry-signature')})
    return new Response('private receiver response',{status:responseStatus,headers:{location:'http://127.0.0.1/private','x-private':'private-header'}})
  }});t.after(h.close);await books(h)
  let sub=await h.command('webhook.create',{destination:endpoint,events:['created']})
  const originalSecret=sub.secret
  const first=await lead(h,2)
  let rows=await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===first.id))
  let attempt=rows.find(r=>r.record.id===first.id)
  assert.equal(attempt.errorClass,'redirect');assert.equal(received.length,1,'a redirect never reaches its destination')
  const delays=[60_000,300_000,1_800_000,7_200_000,43_200_000]
  for(let i=0;i<delays.length;i++) {
    const due=await h.db.prepare('SELECT state,next_at FROM pt_webhook_deliveries WHERE event_id=?').bind(attempt.eventId).first()
    assert.equal(due.state,'pending')
    assert.ok(Date.parse(due.next_at)-Date.parse(attempt.at)>=delays[i]&&Date.parse(due.next_at)-Date.parse(attempt.at)<delays[i]+10_000)
    const count=received.length;await h.cron(Date.parse(due.next_at)-1);assert.equal(received.length,count)
    await Promise.all([h.cron(Date.parse(due.next_at)),h.cron(Date.parse(due.next_at))])
    rows=await history(h);attempt=rows.find(r=>r.eventId===attempt.eventId&&r.attempt===i+2)
    assert.ok(attempt);assert.equal(received.length,count+1,'concurrent cron shares a durable claim')
  }
  assert.equal((await h.db.prepare('SELECT state FROM pt_webhook_deliveries WHERE event_id=?').bind(attempt.eventId).first()).state,'failed')
  assert.equal(new Set(received.map(r=>JSON.parse(r.body).id)).size,1,'all six attempts keep one event identity')
  assert.ok(!JSON.stringify(await history(h)).includes('private receiver response'))
  sub=await subscription(h,sub.id)
  const rotated=await h.command('webhook.rotate',{id:sub.id,revision:sub.revision})
  const second=await lead(h,3)
  rows=await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===second.id))
  const overlap=received.at(-1);signed(overlap,originalSecret)
  signed(overlap,rotated.secret);assert.equal(overlap.signature.split(', ').length,2)
  const secondAttempt=rows.find(r=>r.record.id===second.id)
  responseStatus=204
  await h.cron(Date.parse(secondAttempt.at)+86400001)
  assert.equal(received.at(-1).signature.split(', ').length,1,'old signing secret expires after 24 hours')
  signed(received.at(-1),rotated.secret)
  responseStatus=503
  const third=await lead(h,4)
  await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===third.id))
  sub=await subscription(h,sub.id);await h.command('webhook.set-enabled',{id:sub.id,revision:sub.revision,enabled:false})
  const count=received.length;sub=await subscription(h,sub.id);await h.command('webhook.set-enabled',{id:sub.id,revision:sub.revision,enabled:true})
  await h.cron(Date.now()+48*3600000);assert.equal(received.length,count,'enable never replays cancelled attempts')
  const fourth=await lead(h,5)
  await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===fourth.id))
  const preview=await h.command('erasure.preview',{kind:'contact',id:fourth.id})
  await h.command('erasure.execute',{kind:'contact',id:fourth.id,fingerprint:preview.fingerprint,requester:'Synthetic Pantry request',reason:'Remove unused enquiry',channel:'email',confirm:'ERASE'})
  const erased=await history(h);assert.ok(erased.some(r=>r.record.id===fourth.id&&r.outcome==='cancelled'&&r.errorClass==='record_erased'))
  const erasedCount=received.length;await h.cron(Date.now()+72*3600000);assert.equal(received.length,erasedCount)
  const fifth=await lead(h,6)
  await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===fifth.id))
  sub=await subscription(h,sub.id)
  await h.command('webhook.delete',{id:sub.id,revision:sub.revision})
  assert.equal((await h.view('webhooks')).subscriptions.length,0)
  const deletedCount=received.length;await h.cron(Date.now()+96*3600000);assert.equal(received.length,deletedCount)
}


export async function webhookTimeout(t) {
  let completed=false
  const h=await harness({outbound:async()=>{await new Promise(r=>setTimeout(r,11_000));completed=true;return new Response('unread receiver data',{status:200})}})
  t.after(h.close);await books(h)
  await h.command('webhook.create',{destination:endpoint,events:['created']})
  const customer=await lead(h,7)
  const rows=await waitFor(()=>history(h),rows=>rows.some(r=>r.record.id===customer.id))
  const attempt=rows.find(r=>r.record.id===customer.id)
  assert.equal(attempt.errorClass,'timeout');assert.equal(attempt.statusCode,null)
  assert.equal(completed,false,'bounded transport stops waiting before the slow receiver answers')
}
