import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { books, harness } from './harness.mjs'
const lender='synthetic-pantry-1@example.test'
const base={name:'Synthetic monthly lender package',selection:{kind:'report',report:'balance-sheet',query:{basis:'cash'}},format:'csv',cadence:'month-lock',recipients:[lender],active:true,consent:true}
const history=async h=>(await h.view('report-delivery')).history
const deliveries=h=>h.mail.filter(m=>[m.to].flat().includes(lender))
async function lock(h,period){
 await h.command('close.tasks',{period})
 const state=await h.view('close/'+period)
 for(const task of state.tasks)if(task.status!=='done')await h.command('close.task',{id:task.id,revision:task.revision,done:true})
 await h.command('period.lock',{period})
}
async function allow(h){return h.command('report-recipient.allow',{email:lender,note:'Owner consents to attach the monthly lender package',active:true})}
async function ownerProof(h,cookie,email){
 const started=await h.send('/auth/step-up',{action:'owner:transfer',returnTo:'/app'},{cookie});assert.equal(started.status,202)
 const message=h.mail.findLast(m=>[m.to].flat().includes(email)),token=new URL(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
 assert.equal((await h.send('/auth/confirm',{token},{cookie})).status,303)
}
async function reopen(h,period,requester){
 const state=await h.command('period.request-reopen',{period,reason:'Synthetic review of corrected report'},requester)
 await h.command('period.decide-reopen',{id:state.requests.find(r=>r.status==='pending')?.id??state.requests[0].id,decision:'approve',note:'Owner reviewed'})
}
export async function reportDeliveryMonthLock(t){
 const h=await harness();t.after(h.close);await books(h)
 const reader=await h.member('synthetic-pantry-2@example.test','viewer')
 const accountant=await h.member('synthetic-pantry-3@example.test','accountant')
 await lock(h,'2026-09')
 const saved=await h.command('custom-report.save',{definition:{name:'Synthetic operating result',source:'profit-and-loss',from:'2026-10-01',to:'2026-10-31',basis:'cash',columns:['name','amount']}})
 const pkg=await h.command('management-package.save',{name:'Synthetic lender package',reportIds:[saved.id],cover:'Owner reviewed attachment',commentary:['Monthly operating results']})
 const input={...base,selection:{kind:'management-package',id:pkg.id}}
 await h.command('report-schedule.save',input,h.owner,400)
 await allow(h)
 await h.command('report-schedule.save',{...input,consent:false},h.owner,400)
 await h.command('report-schedule.save',input,reader,403)
 await h.view('report-delivery',reader,403)
 assert.equal((await h.send('/api/pantry/report-delivery')).status,401)
 const schedule=await h.command('report-schedule.save',input)
 await h.cron();assert.equal((await history(h)).length,0,'Activation does not send earlier month locks')
 await lock(h,'2026-10');await Promise.all([h.cron(),h.cron()])
 let rows=await history(h);assert.equal(rows.length,1);const first=rows[0]
 assert.equal(first.status,'accepted');assert.equal(first.basis,'cash');assert.equal(first.schedule_id,schedule.id)
 assert.deepEqual([first.from_date,first.to_date],['2026-10-01','2026-10-31'])
 assert.equal(deliveries(h).length,1)
 const attachment=deliveries(h)[0].attachments[0],bytes=Buffer.from(attachment.content,'base64')
 assert.equal(createHash('sha256').update(bytes).digest('hex'),first.sha256,'Actual emailed bytes equal the frozen attachment hash')
 assert.match(bytes.toString(),/Cash basis/);assert.match(bytes.toString(),/Owner reviewed attachment/)
 const original=await h.send(`/api/pantry/report-delivery/${first.id}/attachment`,undefined,{cookie:h.owner})
 assert.equal(original.status,200);assert.equal(original.value,bytes.toString())
 await h.view(`report-delivery/${first.id}/attachment`,reader,403)
 assert.equal((await h.send(`/api/pantry/report-delivery/${first.id}/attachment`)).status,401)
 await h.command('custom-report.save',{id:saved.id,revision:saved.revision,definition:{...saved.definition,name:'Revised after delivery'}})
 assert.equal((await h.send(`/api/pantry/report-delivery/${first.id}/attachment`,undefined,{cookie:h.owner})).value,bytes.toString(),'Original attachment survives later edits')
 await h.cron();assert.equal(deliveries(h).length,1)
 await reopen(h,'2026-10',accountant);await h.command('period.lock',{period:'2026-10'});await h.cron()
 rows=await history(h);assert.equal(rows.length,2);assert.notEqual(rows[0].occurrence,first.occurrence,'A relock is a separate immutable lock event')
 await h.command('report-schedule.disable',schedule)
 await reopen(h,'2026-10',accountant);await h.command('period.lock',{period:'2026-10'});await h.cron()
 assert.equal(deliveries(h).length,2,'Disabling cancels future lock deliveries')
 const concurrent=await Promise.all([h.send('/api/pantry/command/report-schedule.save',{...input,...schedule},{cookie:h.owner}),h.send('/api/pantry/command/report-schedule.save',{...input,...schedule},{cookie:h.owner})])
 assert.deepEqual(concurrent.map(r=>r.status),[409,409],'A disabled revision cannot be reactivated by stale edits')
}
export async function reportDeliveryCalendar(t){
 const h=await harness();t.after(h.close);await books(h);await allow(h)
 const contact=await h.command('contact.save',{kind:'customer',name:'Synthetic report recipient',email:'synthetic-pantry-4@example.test'})
 const created=[]
 for(const [format,cadence]of [['pdf','weekly'],['xlsx','monthly'],['csv','weekly']])created.push(await h.command('report-schedule.save',{...base,format,cadence,recipients:[contact.email]}))
 const state=await h.view('report-delivery'),activation=state.schedules[0].activated_day
 const future=new Date(activation+'T12:00:00Z');future.setUTCDate(future.getUTCDate()+40)
 await h.cron(+future)
 const rows=await history(h)
 for(const schedule of created){
  const matches=rows.filter(r=>r.schedule_id===schedule.id);assert.ok(matches.length>0)
  assert.ok(matches.every(r=>r.status==='accepted'&&r.basis==='cash'&&r.from_date<r.to_date))
  assert.ok(matches.every(r=>r.occurrence.startsWith(schedule.id===created[1].id?'monthly:':'weekly:')))
 }
 const mailed=h.mail.filter(m=>[m.to].flat().includes(contact.email))
 assert.ok(mailed.some(m=>Buffer.from(m.attachments[0].content,'base64').subarray(0,4).toString()==='%PDF'))
 assert.ok(mailed.some(m=>Buffer.from(m.attachments[0].content,'base64').subarray(0,2).toString()==='PK'))
 const count=mailed.length;await h.cron(+future);assert.equal(h.mail.filter(m=>[m.to].flat().includes(contact.email)).length,count,'Catch-up is dated and once only')
 const existing=(await h.view('report-delivery')).schedules.find(s=>s.id===created[0].id)
 const edits=await Promise.all([1,2].map(n=>h.send('/api/pantry/command/report-schedule.save',{...base,cadence:'weekly',id:existing.id,revision:existing.revision,name:'Synthetic concurrent '+n},{cookie:h.owner})))
 assert.deepEqual(edits.map(r=>r.status).sort(),[200,409],'Only one concurrent revision is accepted')
}
export async function reportDeliverySuppression(t){
 const h=await harness({bindings:{MAIL_PROVIDER:'development'}});t.after(h.close);await books(h)
 await allow(h);await h.command('report-schedule.save',base);await lock(h,'2026-09');await h.cron()
 const rows=await history(h);assert.equal(rows.length,1);assert.equal(rows[0].status,'development');assert.equal(h.mail.length,0)
 await h.cron();assert.equal((await history(h)).length,1)
}
export async function reportDeliveryUncertain(t){
 const attempts=[]
 const h=await harness({bindings:{MAIL_PROVIDER:'sendgrid'},outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.sendgrid.com');attempts.push(await request.json());return new Response(null,{status:503})
 }});t.after(h.close);await books(h);await allow(h)
 const allowed=await h.command('report-schedule.save',base)
 await lock(h,'2026-09');await h.cron()
 let rows=await history(h);assert.equal(rows.length,1);assert.equal(rows[0].status,'uncertain');assert.equal(attempts.length,1)
 assert.ok(attempts[0].attachments[0].content.length>0)
 await h.cron();assert.equal(attempts.length,1,'Uncertain provider outcomes never blindly resend')
 const outside=(await h.view('report-delivery')).allowlist[0]
 await h.command('report-recipient.allow',{email:lender,revision:outside.revision,note:'Owner withdrew lender access',active:false})
 await lock(h,'2026-10');await h.cron();rows=await history(h)
 assert.equal(rows.find(r=>r.occurrence!==rows.find(x=>x.status==='uncertain').occurrence).status,'blocked')
 assert.equal(attempts.length,1)
 await h.command('report-schedule.disable',allowed)
}
export async function reportDeliveryRevokedOwner(t){
 const h=await harness();t.after(h.close);await books(h);await allow(h)
 await h.command('report-schedule.save',base)
 await ownerProof(h,h.owner,'owner@example.test')
 const invited=await h.send('/auth/invite',{email:'synthetic-pantry-5@example.test',displayName:'Synthetic second owner',role:'owner',returnTo:'/app'},{cookie:h.owner})
 assert.equal(invited.status,202)
 const second=await h.confirmMail('synthetic-pantry-5@example.test')
 await ownerProof(h,second,'synthetic-pantry-5@example.test')
 const me=await h.send('/auth/session',undefined,{cookie:h.owner})
 assert.equal(me.status,200)
 const changed=await h.send('/auth/operator/role',{operatorId:me.value.operator.id,role:'member'},{cookie:second});assert.equal(changed.status,200)
 await lock({...h,owner:second,command:(op,b)=>h.command(op,b,second),view:p=>h.view(p,second)},'2026-09')
 await h.cron()
 const rows=(await h.view('report-delivery',second)).history
 assert.equal(rows.length,1);assert.equal(rows[0].status,'blocked');assert.equal(deliveries(h).length,0)
}
