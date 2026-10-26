import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { books, harness } from './harness.mjs'

export function twilioSignature(token,url,fields) {
 let value=url
 for(const key of Object.keys(fields).sort())value+=key+fields[key]
 return createHmac('sha1',token).update(value).digest('base64')
}

export async function textingJourney(t,{credentials={testAccountSid:'synthetic-pantry-1',testAuthToken:'synthetic-pantry-2'},provider}={}) {
 let sends=0,uncertain=false
 const h=await harness({clock:'2026-10-17T14:00:00Z',sessionClock:'2026-12-01T12:00:00Z',outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.twilio.com')
  assert.equal(request.method,'POST')
  const form=new URLSearchParams(await request.clone().text())
  assert.equal(form.get('From'),'+15005550006','Real senders are forbidden in this proof')
  assert.equal(form.get('To'),'+15005550006','Only the Twilio magic test destination is used')
  assert.ok(form.get('Body').includes('/i/'))
  sends++
  if(uncertain)throw new Error('synthetic-pantry-3: connection interrupted after acceptance may have occurred')
  if(provider)return provider(request,sends)
  return Response.json({sid:`synthetic-pantry-${sends+10}`,status:'queued'})
 }})
 t.after(()=>h.close())
 const {acct}=await books(h),phone='+15005550006'
 const call=(op,body,status=200,clock)=>clock?h.send('/api/pantry/command/'+op,body,{cookie:h.owner,headers:{'x-synthetic-pantry-clock':clock}}).then(r=>{assert.equal(r.status,status,op+': '+JSON.stringify(r.value));return r.value}):h.command(op,body,h.owner,status)
 let sending=(await h.view('invoicing')).sending
 await call('sending.save',{revision:sending.revision,remindersOn:true,reminderDays:'0,1',timeZone:'America/New_York'})
 const customer=await call('contact.save',{kind:'customer',name:'synthetic-pantry-1',email:'synthetic-pantry-1@example.test',phone})
 const make=async()=>{
  let inv=await call('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-17',dueDate:'2026-10-18',lines:[{description:'synthetic-pantry-1',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
  inv=await call('invoice.approve',{id:inv.id,revision:inv.revision});inv=await call('invoice.issue',{id:inv.id});await call('invoice.send',{id:inv.id});return inv
 }
 const inv=await make()
 const share=await call('texting.share',{id:inv.id})
 assert.equal(share.phone,phone);assert.match(share.smsUri,/^sms:\+15005550006\?body=/)
 assert.ok(decodeURIComponent(share.smsUri).includes('/i/'))
 let view=await h.view('texting')
 assert.ok(view.shares.some(s=>s.subject_id===inv.id&&s.actor_email==='owner@example.test'&&s.at))
 assert.equal(view.settings.enabled,false)
 await call('texting.send',{id:inv.id,requestId:'synthetic-pantry-1'},409)
 const viewer=await h.member('synthetic-pantry-2@example.test','viewer')
 await h.command('texting.connect',{...credentials,confirmTestOnly:true},viewer,403)
 await call('texting.connect',{...credentials,confirmTestOnly:true})
 view=await h.view('texting')
 await call('texting.settings',{revision:view.settings.revision,enabled:true,approve:true,businessContact:'synthetic-pantry-1 support synthetic-pantry-1@example.test',invoiceTemplate:view.settings.invoiceTemplate,reminderTemplate:view.settings.reminderTemplate,reminderDays:'0,1'})
 await call('texting.send',{id:inv.id,requestId:'synthetic-pantry-2'},409)
 await call('texting.consent',{customerId:customer.id,phone,timeZone:'America/New_York',purposes:['invoice'],source:'synthetic-pantry-1 signed form',wording:'I consent to invoice links only.',consentedAt:'2026-10-17T13:00:00Z'})
 await call('texting.send',{id:inv.id,purpose:'reminder',requestId:'synthetic-pantry-3'},409)
 await call('texting.consent',{customerId:customer.id,phone,timeZone:'America/New_York',purposes:['invoice','reminder'],source:'synthetic-pantry-1 signed form',wording:'I consent to invoice links and invoice reminders. Reply STOP to stop.',consentedAt:'2026-10-17T13:30:00Z'})
 const initial=await call('texting.send',{id:inv.id,requestId:'synthetic-pantry-4'})
 assert.equal(initial.status,'queued');assert.ok(initial.provider_message_id);assert.equal(sends,1)
 assert.equal((await call('texting.send',{id:inv.id,requestId:'synthetic-pantry-4'})).id,initial.id);assert.equal(sends,1)
 const signed=async(path,fields,{invalid=false,clock}={})=>{
  const signature=invalid?'synthetic-pantry-1':twilioSignature(credentials.testAuthToken,h.origin+path,fields)
  return h.send(path,undefined,{raw:new URLSearchParams(fields).toString(),headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':signature,...(clock?{'x-synthetic-pantry-clock':clock}:{})}})
 }
 const statusPath='/api/pantry/texting/twilio/status?messageId='+initial.id
 const statusFields={AccountSid:credentials.testAccountSid,MessageSid:initial.provider_message_id,MessageStatus:'delivered'}
 assert.equal((await signed(statusPath,statusFields,{invalid:true})).status,403)
 assert.equal((await h.view('texting')).messages.find(m=>m.id===initial.id).status,'queued')
 for(const status of ['sent','delivered','queued'])assert.equal((await signed(statusPath,{...statusFields,MessageStatus:status})).status,200)
 assert.equal((await h.view('texting')).messages.find(m=>m.id===initial.id).status,'delivered','Late queued cannot regress delivered')
 const beforeEmail=(await h.view('sales')).deliveries.filter(d=>d.invoice_id===inv.id).length
 await Promise.all([h.cron(Date.parse('2026-10-18T10:30:00Z')),h.cron(Date.parse('2026-10-18T10:30:00Z'))])
 let reminder=(await h.view('texting')).messages.find(m=>m.invoice_id===inv.id&&m.purpose==='reminder')
 assert.equal(reminder.status,'held');assert.equal(reminder.not_before,'2026-10-18T12:00:00.000Z');assert.equal(sends,1)
 await h.cron(Date.parse('2026-10-18T11:59:00Z'));assert.equal(sends,1)
 await Promise.all([h.cron(Date.parse('2026-10-18T12:00:00Z')),h.cron(Date.parse('2026-10-18T12:00:00Z'))]);await h.cron(Date.parse('2026-10-18T12:00:00Z'))
 reminder=(await h.view('texting')).messages.find(m=>m.id===reminder.id)
 assert.equal(reminder.status,'queued');assert.equal(sends,2)
 const reminderPath='/api/pantry/texting/twilio/status?messageId='+reminder.id
 for(const status of ['sent','failed','undeliverable'])assert.equal((await signed(reminderPath,{AccountSid:credentials.testAccountSid,MessageSid:reminder.provider_message_id,MessageStatus:status})).status,200)
 view=await h.view('texting')
 assert.ok(view.messages.find(m=>m.id===reminder.id).events.some(e=>e.status==='undeliverable'))
 const fields={AccountSid:credentials.testAccountSid,MessageSid:'synthetic-pantry-20',From:phone,To:phone,Body:'HELP'}
 const help=await signed('/api/pantry/texting/twilio/inbound',fields)
 assert.equal(help.status,200);assert.match(help.value,/synthetic-pantry-1@example.test/)
 assert.equal((await signed('/api/pantry/texting/twilio/inbound',{...fields,MessageSid:'synthetic-pantry-21',Body:'STOP'},{invalid:true})).status,403)
 assert.equal((await h.view('texting')).consents[0].revoked_at,null)
 const stop={...fields,MessageSid:'synthetic-pantry-22',Body:' unsubscribe! '}
 assert.equal((await signed('/api/pantry/texting/twilio/inbound',stop)).status,200)
 assert.equal((await signed('/api/pantry/texting/twilio/inbound',stop)).status,200)
 await call('texting.send',{id:inv.id,requestId:'synthetic-pantry-5'},409)
 await h.cron(Date.parse('2026-10-19T14:00:00Z'))
 assert.equal(sends,2)
 const afterEmail=(await h.view('sales')).deliveries.filter(d=>d.invoice_id===inv.id)
 assert.ok(afterEmail.length>beforeEmail,'STOP leaves invoice email and reminder history intact')
 assert.ok(afterEmail.some(d=>d.kind==='reminder'))
 assert.ok((await h.view('texting')).consents[0].revoked_at)
 if(!provider){
  // A network exception is retained as uncertain and cannot open a new send.
  await call('texting.consent',{customerId:customer.id,phone,timeZone:'America/New_York',purposes:['invoice'],source:'synthetic-pantry-2 signed form',wording:'I renew consent to invoice links.',consentedAt:'2026-10-20T13:00:00Z'},200,'2026-10-20T14:00:00Z')
  const inv2=await make();uncertain=true
  const unknown=await call('texting.send',{id:inv2.id,requestId:'synthetic-pantry-6'},200,'2026-10-20T14:00:00Z')
  assert.equal(unknown.status,'uncertain');const count=sends
  await call('texting.send',{id:inv2.id,requestId:'synthetic-pantry-7'},409,'2026-10-20T14:00:00Z')
  await h.cron(Date.parse('2026-10-20T15:00:00Z'));assert.equal(sends,count)
 }
 return {sends,invoiceId:inv.id,initialProviderId:initial.provider_message_id,reminderProviderId:reminder.provider_message_id,realSmsSent:false,callbacks:'synthetic signed events only'}
}
