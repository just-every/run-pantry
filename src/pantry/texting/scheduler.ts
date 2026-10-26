import type { Bindings } from '../../auth.server'
import { Fault } from '../core'
import { all, one } from '../db'
import { dueStep } from '../delivery'
import { customerReminderDays } from '../reminder-content'
import { reminderEligible } from '../reminder-claims'
import { localClock } from './policy'
import { standingTextApproval, textingSettings } from './store'
import { flushHeldTexts, reserveText, textActor } from './send'

export async function sendDueTexts(env:Bindings,db:D1Database,at=new Date()) {
 await flushHeldTexts(env,db,at)
 const s=await textingSettings(db)
 if(!s.enabled||!s.account_sid_sealed||!await one(db,`SELECT 1 WHERE ${standingTextApproval}`))return
 const schedule=JSON.parse(s.reminder_days) as number[]
 if(!schedule.length)return
 const rows=await all(db,`SELECT i.*,c.phone,c.reminder_days,c.erased_at AS customer_erased FROM pt_invoices i JOIN pt_contacts c ON c.id=i.customer_id WHERE i.kind='invoice' AND i.status='issued' AND i.sent_at IS NOT NULL AND i.void_date IS NULL AND i.reminders_paused=0 AND c.active=1 AND c.erased_at IS NULL`)
 for(const inv of rows) {
  if(!await one(db,`SELECT 1 WHERE ${reminderEligible}`,inv.id))continue
  const consents=await all(db,'SELECT * FROM pt_text_consents WHERE customer_id=? AND revoked_at IS NULL AND NOT EXISTS(SELECT 1 FROM pt_text_blocks b WHERE b.phone=pt_text_consents.phone)',inv.customer_id)
  for(const consent of consents){
   if(!JSON.parse(consent.purposes).includes('reminder'))continue
   const day=localClock(consent.time_zone,at).day
   const prior=await all<{reminder_step:number|null}>(db,"SELECT reminder_step FROM pt_text_messages WHERE invoice_id=? AND phone=? AND purpose='reminder' AND reminder_cycle=?",inv.id,consent.phone,inv.reminder_cycle)
   const customerSchedule=customerReminderDays(inv,schedule).filter(d=>schedule.includes(d)),step=dueStep(inv.due_date,day,customerSchedule,prior.flatMap(p=>p.reminder_step===null?[]:[p.reminder_step]))
   if(step===null)continue
   if(await one(db,"SELECT 1 FROM pt_text_messages WHERE invoice_id=? AND phone=? AND purpose='reminder' AND reminder_day=?",inv.id,consent.phone,day))continue
   try{await reserveText(env,db,textActor,{id:inv.id,kind:'invoice',purpose:'reminder',phone:consent.phone,requestId:`reminder:${inv.id}:${consent.phone}:${day}`,reminderDay:day,reminderStep:step},[],at)}
   catch(error){if(error instanceof Fault&&error.status===409)continue;throw error}
  }
 }
}
