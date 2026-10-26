import type { Context } from '../context'
import { must } from '../access'
import { all, one } from '../db'
export async function textingSettings(db:D1Database) {return (await one(db,'SELECT * FROM pt_texting WHERE id=1'))!}
export const standingTextApproval="EXISTS(SELECT 1 FROM pt_texting t JOIN oa_operators o ON lower(o.email)=lower(t.updated_by) WHERE t.id=1 AND t.enabled=1 AND o.role='owner' AND o.status='active')"
export async function textingView(c:Context) {
 must(c.actor,'owner')
 const s=await textingSettings(c.db)
 const [consents,messages,shares]=await Promise.all([
  all(c.db,'SELECT * FROM pt_text_consents ORDER BY recorded_at DESC'),
  all(c.db,'SELECT * FROM pt_text_messages ORDER BY at DESC,id LIMIT 500'),
  all(c.db,'SELECT * FROM pt_text_shares ORDER BY at DESC,id LIMIT 500')])
 const events=await all(c.db,'SELECT e.* FROM pt_text_events e JOIN pt_text_messages m ON m.id=e.message_id ORDER BY e.at,e.id LIMIT 2000')
 return {settings:{connected:!!s.account_sid_sealed,testMode:true,enabled:!!s.enabled,fromNumber:s.from_number,businessContact:s.business_contact,invoiceTemplate:s.invoice_template,reminderTemplate:s.reminder_template,reminderDays:JSON.parse(s.reminder_days),revision:s.revision,updatedAt:s.updated_at,updatedBy:s.updated_by},consents:consents.map(c=>({...c,purposes:JSON.parse(c.purposes)})),messages:messages.map(m=>({...m,events:events.filter(e=>e.message_id===m.id)})),shares}
}
