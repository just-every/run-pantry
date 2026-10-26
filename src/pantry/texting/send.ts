import type { Bindings } from '../../auth.server'
import { Fault, now, requireThat, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type AuditActor, type Sql } from '../db'
import { invoice } from '../invoices'
import { renderReminder } from '../reminder-content'
import { sendingSettings } from '../delivery'
import { reminderEligible } from '../reminder-claims'
import { nextTextTime, phoneNumber } from './policy'
import { sendTestText } from './provider'
import { standingTextApproval, textingSettings } from './store'
import { subjectFence, textSubject } from './subjects'

export const textActor:AuditActor={email:'pantry:texting',kind:'system'}
const rowFor=(db:D1Database,id:string)=>one(db,'SELECT * FROM pt_text_messages WHERE id=?',id)
export async function reserveText(env:Bindings,db:D1Database,actor:AuditActor,b:Data,authority:Sql[]=[],at=new Date()) {
 const existing=await one(db,'SELECT * FROM pt_text_messages WHERE request_id=?',b.requestId)
 if(existing){requireThat(existing.subject_id===b.id&&existing.purpose===b.purpose,'This text request belongs to another action',409);return existing}
 const s=await textingSettings(db)
 requireThat(s.enabled&&s.account_sid_sealed&&await one(db,`SELECT 1 WHERE ${standingTextApproval}`),'Owner-approved texting is off',409)
 requireThat(['invoice','reminder','estimate'].includes(b.purpose)&&((b.kind==='invoice'&&['invoice','reminder'].includes(b.purpose))||(b.kind==='estimate'&&b.purpose==='estimate')),'Text purpose does not match the record')
 const subject=await textSubject(env,db,b.id,b.kind,b.purpose)
 const consents=await all(db,'SELECT * FROM pt_text_consents WHERE customer_id=? AND revoked_at IS NULL ORDER BY recorded_at DESC',subject.customer.id)
 const consent=b.phone?consents.find(c=>c.phone===phoneNumber(b.phone)):consents.find(c=>c.phone===subject.customer.phone&&JSON.parse(c.purposes).includes(b.purpose))??consents.find(c=>JSON.parse(c.purposes).includes(b.purpose))
 requireThat(consent&&JSON.parse(consent.purposes).includes(b.purpose),'Record consent for this number and text purpose first',409)
 requireThat(!await one(db,'SELECT 1 FROM pt_text_blocks WHERE phone=?',consent.phone),'This number opted out of texting',409)
 requireThat(!await one(db,"SELECT 1 FROM pt_text_messages WHERE subject_id=? AND phone=? AND purpose=? AND status IN ('uncertain','sending')",b.id,consent.phone,b.purpose),'A prior text has uncertain acceptance; it cannot be replayed',409)
 const inv=b.kind==='invoice'?await invoice(db,b.id):subject.row,raw=b.purpose==='reminder'?s.reminder_template:s.invoice_template
 const body=renderReminder(raw,{...inv,open_cents:inv.open_cents??inv.total_cents},subject.business,subject.customer.name,subject.link)
 requireThat(body.length<=1500,'The merged text exceeds 1500 characters; shorten the approved template')
 const businessZone=(await sendingSettings(db)).time_zone,notBefore=nextTextTime(consent.time_zone,at,businessZone),status=notBefore>at.toISOString()?'held':'sending',id=uid(),fence=subjectFence(subject)
 const reminderDay=b.purpose==='reminder'?b.reminderDay??new Intl.DateTimeFormat('en-CA',{timeZone:consent.time_zone,year:'numeric',month:'2-digit',day:'2-digit'}).format(at):null
 try {
 await run(db,[...authority,guard(standingTextApproval),guard(fence.sql,...fence.params),...(b.purpose==='reminder'?[guard(reminderEligible,b.id),guard('EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND reminders_paused=0)',b.id)]:[]),guard('EXISTS(SELECT 1 FROM pt_texting WHERE id=1 AND enabled=1 AND revision=?)',s.revision),guard('EXISTS(SELECT 1 FROM pt_text_consents WHERE phone=? AND customer_id=? AND revision=? AND revoked_at IS NULL) AND NOT EXISTS(SELECT 1 FROM pt_text_blocks WHERE phone=?)',consent.phone,subject.customer.id,consent.revision,consent.phone),
  q('INSERT INTO pt_text_messages(id,request_id,subject_kind,subject_id,invoice_id,customer_id,purpose,phone,body,status,at,updated_at,not_before,actor_email,actor_kind,settings_revision,consent_revision,link_path,reminder_step,reminder_day,reminder_cycle)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,b.requestId,b.kind,b.id,b.kind==='invoice'?b.id:null,subject.customer.id,b.purpose,consent.phone,body,status,at.toISOString(),at.toISOString(),status==='held'?notBefore:null,actor.email,actor.kind,s.revision,consent.revision,subject.path,b.reminderStep??null,reminderDay,b.purpose==='reminder'?inv.reminder_cycle:null),
  audit(actor,'texting.reserved',b.kind,b.id,{messageId:id,purpose:b.purpose,phone:consent.phone,body,status,notBefore,settingsRevision:s.revision,consentRevision:consent.revision})])
 } catch(error) {
  const prior=await one(db,'SELECT * FROM pt_text_messages WHERE request_id=?',b.requestId)
  if(prior)return prior
  throw error
 }
 if(status==='sending')await transmitText(env,db,id,at,true)
 return (await rowFor(db,id))!
}
async function cancelText(db:D1Database,m:Data,detail:string,at:Date) {
 await run(db,[q("UPDATE pt_text_messages SET status='cancelled',detail=?,updated_at=? WHERE id=? AND status IN ('held','sending')",detail,at.toISOString(),m.id),audit(textActor,'texting.cancelled',m.subject_kind,m.subject_id,{messageId:m.id,detail})])
}
// A held row is claimed before touching the provider. A crash leaves 'sending',
// which is deliberately never selected again: an uncertain send cannot repeat.
export async function transmitText(env:Bindings,db:D1Database,id:string,at=new Date(),claimed=false) {
 const m=await rowFor(db,id)
 if(!m||!(claimed?m.status==='sending':m.status==='held'))return
 const s=await textingSettings(db),consent=await one(db,'SELECT * FROM pt_text_consents WHERE phone=?',m.phone)
 if(!s.enabled||!await one(db,`SELECT 1 WHERE ${standingTextApproval}`)||s.revision!==m.settings_revision||!consent||consent.revoked_at||consent.revision!==m.consent_revision||!JSON.parse(consent.purposes).includes(m.purpose)||await one(db,'SELECT 1 FROM pt_text_blocks WHERE phone=?',m.phone)){await cancelText(db,m,'Texting approval or consent changed before dispatch',at);return}
 let subject:Data
 try {subject=await textSubject(env,db,m.subject_id,m.subject_kind,m.purpose)} catch(error){if(!(error instanceof Fault))throw error;await cancelText(db,m,error.message,at);return}
 if(subject.path!==m.link_path){await cancelText(db,m,'The customer link changed',at);return}
 const notBefore=nextTextTime(consent.time_zone,at,(await sendingSettings(db)).time_zone)
 if(notBefore>at.toISOString()){
  await run(db,[q("UPDATE pt_text_messages SET status='held',not_before=?,updated_at=? WHERE id=? AND status IN ('held','sending')",notBefore,at.toISOString(),m.id)])
  return
 }
 if(!claimed){
  const fence=subjectFence(subject)
  try{await run(db,[guard(standingTextApproval),guard(fence.sql,...fence.params),guard('NOT EXISTS(SELECT 1 FROM pt_text_blocks WHERE phone=?) AND EXISTS(SELECT 1 FROM pt_text_consents WHERE phone=? AND revision=? AND revoked_at IS NULL)',m.phone,m.phone,m.consent_revision),guard('EXISTS(SELECT 1 FROM pt_texting WHERE id=1 AND enabled=1 AND revision=?)',s.revision),...(m.purpose==='reminder'?[guard(reminderEligible,m.invoice_id),guard('EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND reminders_paused=0)',m.invoice_id)]:[]),q("UPDATE pt_text_messages SET status='sending',not_before=NULL,updated_at=? WHERE id=? AND status='held'",at.toISOString(),m.id),changed()])}
  catch(error){if(error instanceof Fault&&error.status===409)return;throw error}
 }
 // STOP is checked again immediately before the network boundary.
 if(await one(db,'SELECT 1 FROM pt_text_blocks WHERE phone=?',m.phone)){await cancelText(db,m,'Number opted out before provider request',at);return}
 const result=await sendTestText(env,s,m),finished=now()
 await run(db,[q("UPDATE pt_text_messages SET status=?,provider_message_id=?,detail=?,updated_at=? WHERE id=? AND status='sending'",result.status,result.providerId,result.detail,finished,id),changed(),q('INSERT INTO pt_text_events(id,message_id,status,at,detail)VALUES(?,?,?,?,?)',uid(),id,result.status,finished,result.detail),audit(textActor,'texting.provider-result',m.subject_kind,m.subject_id,{messageId:id,status:result.status,providerMessageId:result.providerId,detail:result.detail})])
}
export async function flushHeldTexts(env:Bindings,db:D1Database,at=new Date()) {
 for(const m of await all(db,"SELECT id FROM pt_text_messages WHERE status='held' AND not_before<=? ORDER BY not_before LIMIT 100",at.toISOString()))await transmitText(env,db,m.id,at)
}
