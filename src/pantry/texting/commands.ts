import { authority, must, who } from '../access'
import { now, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, one, q, run } from '../db'
import type { Command } from '../context'
import { contact } from '../contacts'
import { seal } from '../seal'
import { reminderDays } from '../reminder-content'
import { textingSettings, textingView } from './store'
import { TEST_FROM } from './provider'
import { phoneNumber, selectedPurposes, template, timeZone } from './policy'
import { subjectFence, textSubject } from './subjects'
import { reserveText } from './send'

const connect:Command={need:'owner',async run(c,b){
 must(c.actor,'owner')
 requireThat(b.confirmTestOnly===true,'Confirm these are Twilio test credentials; live texting is unavailable')
 const sid=text(b.testAccountSid,'Twilio test account SID',100),token=text(b.testAuthToken,'Twilio test auth token',200)
 requireThat(!/[\s:/]/.test(sid)&&!/[\r\n]/.test(token),'Enter the test credentials from Twilio')
 requireThat(!b.fromNumber||b.fromNumber===TEST_FROM,'Only the Twilio magic test sender is available')
 const before=await textingSettings(c.db),at=now(),revision=uid()
 await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_texting SET account_sid_sealed=?,auth_token_sealed=?,from_number=?,enabled=0,revision=?,updated_by=?,updated_at=? WHERE id=1',await seal(c.env.SESSION_SECRET,'texting-account',sid),await seal(c.env.SESSION_SECRET,'texting-token',token),TEST_FROM,revision,c.actor.email,at),changed(),audit(who(c.actor),'texting.connect','texting','1',{before:{connected:!!before.account_sid_sealed,enabled:!!before.enabled},after:{connected:true,enabled:false,testMode:true,revision}})])
 return textingView(c)
}}
const disconnect:Command={need:'owner',async run(c){
 must(c.actor,'owner')
 await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_texting SET account_sid_sealed=NULL,auth_token_sealed=NULL,enabled=0,revision=?,updated_by=?,updated_at=? WHERE id=1',uid(),c.actor.email,now()),q("UPDATE pt_text_messages SET status='cancelled',detail='Twilio disconnected',updated_at=? WHERE status='held'",now()),audit(who(c.actor),'texting.disconnect','texting','1')])
 return textingView(c)
}}
const settings:Command={need:'owner',async run(c,b){
 must(c.actor,'owner')
 const old=await textingSettings(c.db)
 requireThat(b.revision===old.revision,'Text settings changed; reload',409)
 requireThat(b.approve===true,'Approve the exact text templates and reminder schedule')
 const enabled=b.enabled===true,invoiceTemplate=template(b.invoiceTemplate??old.invoice_template,'Invoice text'),reminderTemplate=template(b.reminderTemplate??old.reminder_template,'Reminder text'),days=reminderDays(b.reminderDays??JSON.parse(old.reminder_days)),businessContact=text(b.businessContact,'Business HELP contact',500)
 requireThat(!enabled||old.account_sid_sealed,'Connect the Twilio test account first',409)
 const revision=uid(),at=now()
 const snapshot=(s:Data)=>({enabled:!!s.enabled,invoiceTemplate:s.invoice_template,reminderTemplate:s.reminder_template,reminderDays:JSON.parse(s.reminder_days),businessContact:s.business_contact,revision:s.revision})
 await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_texting SET enabled=?,invoice_template=?,reminder_template=?,reminder_days=?,business_contact=?,revision=?,updated_by=?,updated_at=? WHERE id=1 AND revision=?',enabled?1:0,invoiceTemplate,reminderTemplate,JSON.stringify(days),businessContact,revision,c.actor.email,at,old.revision),changed(),audit(who(c.actor),'texting.settings-approved','texting','1',{before:snapshot(old),after:{enabled,invoiceTemplate,reminderTemplate,reminderDays:days,businessContact,revision}})])
 return textingView(c)
}}
const consent:Command={need:'owner',async run(c,b){
 must(c.actor,'owner')
 const customer=await contact(c.db,text(b.customerId,'Customer'),'customer'),phone=phoneNumber(b.phone),old=await one(c.db,'SELECT * FROM pt_text_consents WHERE phone=?',phone),at=now()
 requireThat(!old||old.customer_id===customer.id,'This number has consent recorded for another customer',409)
 const revoke=b.revoke===true
 if(revoke){
  requireThat(old,'No consent exists for that number',409)
  await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_text_consents SET revoked_at=?,revision=? WHERE phone=?',at,uid(),phone),q('INSERT INTO pt_text_blocks(phone,at,keyword) VALUES(?,?,?) ON CONFLICT(phone) DO UPDATE SET at=excluded.at,keyword=excluded.keyword',phone,at,'owner revoke'),q("UPDATE pt_text_messages SET status='cancelled',updated_at=?,detail='Consent revoked' WHERE phone=? AND status='held'",at,phone),audit(who(c.actor),'texting.consent-revoked','customer',customer.id,{phone,at})])
 }else{
  const purposes=selectedPurposes(b.purposes),zone=timeZone(b.timeZone),source=text(b.source,'Consent source',500),wording=text(b.wording,'Exact consent wording',2000),consentedAt=text(b.consentedAt,'Consent time',40),revision=uid()
  requireThat(Number.isFinite(Date.parse(consentedAt))&&Date.parse(consentedAt)<=Date.parse(at),'Consent time must be a past or current timestamp')
  const blocked=await one(c.db,'SELECT * FROM pt_text_blocks WHERE phone=?',phone)
  requireThat(!blocked||Date.parse(consentedAt)>Date.parse(blocked.at),'A STOP requires fresh consent recorded after the opt-out',409)
  await run(c.db,[authority(c.actor,'owner'),guard('EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND active=1 AND erased_at IS NULL)',customer.id),q('INSERT INTO pt_text_consents(phone,customer_id,purposes,time_zone,source,wording,consented_at,recorded_by,recorded_at,revoked_at,revision)VALUES(?,?,?,?,?,?,?,?,?,NULL,?) ON CONFLICT(phone) DO UPDATE SET purposes=excluded.purposes,time_zone=excluded.time_zone,source=excluded.source,wording=excluded.wording,consented_at=excluded.consented_at,recorded_by=excluded.recorded_by,recorded_at=excluded.recorded_at,revoked_at=NULL,revision=excluded.revision',phone,customer.id,JSON.stringify(purposes),zone,source,wording,new Date(consentedAt).toISOString(),c.actor.email,at,revision),q('DELETE FROM pt_text_blocks WHERE phone=?',phone),audit(who(c.actor),'texting.consent-recorded','customer',customer.id,{before:old,after:{phone,purposes,timeZone:zone,source,wording,consentedAt,recordedAt:at,revision}})])
 }
 return textingView(c)
}}
const share:Command={need:'record',async run(c,b){
 must(c.actor,'record')
 const s=await textSubject(c.env,c.db,text(b.id,'Record'),b.kind??'invoice',b.kind??'invoice',true),phone=phoneNumber(b.phone??s.customer.phone),body=`${s.business}: ${s.row.number} ${s.link}`,id=uid(),at=now(),fence=subjectFence(s)
 await run(c.db,[authority(c.actor,'record'),guard(fence.sql,...fence.params),q('INSERT INTO pt_text_shares(id,subject_kind,subject_id,customer_id,phone,body,actor_email,at)VALUES(?,?,?,?,?,?,?,?)',id,s.kind,s.row.id,s.customer.id,phone,body,c.actor.email,at),audit(who(c.actor),'texting.link-shared',s.kind,s.row.id,{shareId:id,phone,channel:'own-phone',at,body})])
 return {id,phone,body,at,actorEmail:c.actor.email,smsUri:`sms:${phone}?body=${encodeURIComponent(body)}`}
}}
const send:Command={need:'owner',async run(c,b){
 must(c.actor,'owner')
 return reserveText(c.env,c.db,who(c.actor),{id:text(b.id,'Record'),kind:b.kind??'invoice',purpose:b.purpose??b.kind??'invoice',requestId:text(b.requestId,'Text request',100),phone:b.phone},[authority(c.actor,'owner')])
}}
export const textingCommands:Record<string,Command>={'texting.connect':connect,'texting.disconnect':disconnect,'texting.settings':settings,'texting.consent':consent,'texting.share':share,'texting.send':send}
