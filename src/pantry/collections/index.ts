// Evidence-backed drafts. Sending is a distinct owner action for one reviewed
// revision; promises/disputes/stop also hold the ordinary reminder route.
import { authority,must,who } from '../access'
import type { Command,Context } from '../context'
import { businessDay,deliver,sendingSettings } from '../delivery'
import { customerRecipients } from '../customer-profile'
import { invoice } from '../invoices'
import { date,now,requireThat,text,uid,type Data } from '../core'
import { all,audit,changed,guard,one,q,run } from '../db'
const owner=(c:Context)=>must(c.actor,'owner')
async function current(c:Context,id:string){const i=await invoice(c.db,id),row=await one(c.db,'SELECT * FROM pt_collection_cases WHERE invoice_id=?',id);requireThat(row,'Prepare a collection draft first',404);return {i,row}}
async function allowedNow(c:Context,i:Data,row:Data,today:string){
 requireThat(i.kind==='invoice'&&i.status==='issued'&&i.open_cents>0,'This invoice is no longer an open receivable',409)
 requireThat(!['disputed','stopped','paid'].includes(row.status),'Chasing is stopped for this invoice',409)
 requireThat(!row.promise_date||row.promise_date<today,'A promise to pay pauses chasing through its selected date',409)
 requireThat(!await one(c.db,"SELECT id FROM pt_stripe_payments WHERE invoice_id=? AND status='processing'",i.id),'A payment is processing; leave this invoice alone',409)
 // Sibling-issued invoices are excluded until their connection explicitly
 // opts into chasing. No such connection permission is inferred here.
 requireThat(!await one(c.db,"SELECT target_id FROM pt_integration_requests WHERE target_id=? AND target_kind='invoice'",i.id),'App-issued invoice: leave collection to its originating app',409)
}
export async function collectionsView(c:Context){owner(c);const rows=await all(c.db,'SELECT c.*,i.number,p.name AS customer FROM pt_collection_cases c JOIN pt_invoices i ON i.id=c.invoice_id JOIN pt_contacts p ON p.id=i.customer_id ORDER BY i.due_date,c.invoice_id')
 for(const row of rows){row.evidence=JSON.parse(row.evidence);const i=await invoice(c.db,row.invoice_id);row.currentOpen=i.open_cents;row.currentStatus=i.open_cents<=0?'paid':row.status;row.sends=await all(c.db,'SELECT s.*,d.status,d.detail FROM pt_collection_sends s JOIN pt_deliveries d ON d.id=s.delivery_id WHERE s.invoice_id=? ORDER BY s.at',row.invoice_id)}
 return {cases:rows,today:businessDay((await sendingSettings(c.db)).time_zone)}
}
const prepare:Command={need:'owner',async run(c){owner(c);const today=businessDay((await sendingSettings(c.db)).time_zone)
 for(const row of await all(c.db,"SELECT id FROM pt_invoices WHERE kind='invoice' AND status='issued' AND void_date IS NULL AND due_date<? ORDER BY due_date,id",today)){
  const i=await invoice(c.db,row.id),old=await one(c.db,'SELECT * FROM pt_collection_cases WHERE invoice_id=?',i.id)
  if(i.open_cents<=0){if(old)await run(c.db,[authority(c.actor,'owner'),q("UPDATE pt_collection_cases SET status='paid',approved_revision=NULL,revision=?,updated_at=? WHERE invoice_id=?",uid(),now(),i.id)]);continue}
  if(old&&(['disputed','stopped'].includes(old.status)||old.promise_date&&old.promise_date>=today))continue
  const customer=await one(c.db,'SELECT * FROM pt_contacts WHERE id=?',i.customer_id),recipients=customerRecipients(customer!)
  if(old&&old.invoice_revision===i.revision&&old.open_cents===i.open_cents&&recipients.includes(old.recipient)&&['draft','approved'].includes(old.status))continue
  if(!recipients.length)continue
  if(await one(c.db,"SELECT target_id FROM pt_integration_requests WHERE target_id=? AND target_kind='invoice'",i.id))continue
  const history=await all(c.db,"SELECT p.payment_date,p.amount_cents,p.reference FROM pt_payments p WHERE p.contact_id=? AND p.direction='received' AND p.reversal_id IS NULL ORDER BY p.payment_date DESC,p.id LIMIT 12",i.customer_id),correspondence=await all(c.db,'SELECT id,subject,status,at FROM pt_deliveries WHERE invoice_id=? ORDER BY at DESC,id LIMIT 12',i.id)
  const evidence={invoiceId:i.id,number:i.number,dueDate:i.due_date,openCents:i.open_cents,paymentHistory:history,correspondence},subject=`Checking in on invoice ${i.number}`,body=`Hello,\n\n${history.length?'Thank you for your previous payments. ':''}${correspondence.find(m=>m.status==='accepted')?'Following up on our earlier invoice correspondence. ':''}Our records show invoice ${i.number}, due ${i.due_date}, with $${(i.open_cents/100).toFixed(2)} still open. Could you confirm the expected payment date? If you have already paid or need to discuss it, please reply so we can check our records.\n\nThank you.`
  const revision=uid()
  await run(c.db,[authority(c.actor,'owner'),...(old?[q("UPDATE pt_collection_cases SET status='draft',subject=?,body=?,recipient=?,evidence=?,promise_date=NULL,invoice_revision=?,open_cents=?,approved_by=NULL,approved_revision=NULL,revision=?,updated_at=? WHERE invoice_id=? AND revision=?",subject,body,recipients[0],JSON.stringify(evidence),i.revision,i.open_cents,revision,now(),i.id,old.revision),changed()]:[q("INSERT INTO pt_collection_cases(invoice_id,status,subject,body,recipient,evidence,invoice_revision,open_cents,revision,updated_at)VALUES(?,'draft',?,?,?,?,?,?,?,?)",i.id,subject,body,recipients[0],JSON.stringify(evidence),i.revision,i.open_cents,revision,now())]),audit(who(c.actor),'collections.draft','invoice',i.id,{revision,openCents:i.open_cents,historyCount:history.length,correspondenceCount:correspondence.length})])
 }
 return collectionsView(c)
}}
const save:Command={need:'owner',async run(c,b){owner(c);const {i,row}=await current(c,text(b.id,'Invoice'));requireThat(row.revision===b.revision,'Draft changed; reload',409);requireThat(!['disputed','stopped','paid'].includes(row.status),'Chasing is stopped',409)
 await run(c.db,[authority(c.actor,'owner'),q("UPDATE pt_collection_cases SET subject=?,body=?,status='draft',approved_by=NULL,approved_revision=NULL,revision=?,updated_at=? WHERE invoice_id=? AND revision=?",text(b.subject,'Subject',200),text(b.body,'Message',4000),uid(),now(),i.id,b.revision),changed(),audit(who(c.actor),'collections.edit','invoice',i.id,{withdrawsApproval:true})]);return collectionsView(c)
}}
const approve:Command={need:'owner',async run(c,b){owner(c);const {i,row}=await current(c,text(b.id,'Invoice')),today=businessDay((await sendingSettings(c.db)).time_zone);await allowedNow(c,i,row,today);requireThat(row.revision===b.revision&&row.invoice_revision===i.revision&&row.open_cents===i.open_cents,'Invoice or draft changed; review current evidence',409)
 await run(c.db,[authority(c.actor,'owner'),q("UPDATE pt_collection_cases SET status='approved',approved_by=?,approved_revision=revision WHERE invoice_id=? AND revision=? AND status='draft'",c.actor.email,i.id,b.revision),changed(),audit(who(c.actor),'collections.approve','invoice',i.id,{revision:row.revision,recipient:row.recipient})]);return collectionsView(c)
}}
const send:Command={need:'owner',async run(c,b){owner(c);const {i,row}=await current(c,text(b.id,'Invoice')),today=businessDay((await sendingSettings(c.db)).time_zone);await allowedNow(c,i,row,today);requireThat(row.status==='approved'&&row.revision===b.revision&&row.approved_revision===row.revision&&row.approved_by===c.actor.email&&row.invoice_revision===i.revision&&row.open_cents===i.open_cents,'Review and approve the exact current draft before sending',409)
 const customer=await one(c.db,'SELECT * FROM pt_contacts WHERE id=?',i.customer_id);requireThat(customerRecipients(customer!).includes(row.recipient),'Recipient changed; prepare and approve a new draft',409)
 const d=await deliver(c.env,c.db,who(c.actor),i.id,row.recipient,'reminder',null,{subject:row.subject,body:row.body,claim:[authority(c.actor,'owner'),guard("EXISTS(SELECT 1 FROM pt_collection_cases WHERE invoice_id=? AND revision=? AND approved_revision=revision AND status='approved')",i.id,row.revision),guard("EXISTS(SELECT 1 FROM pt_invoices i WHERE i.id=? AND i.revision=? AND i.kind='invoice' AND i.status='issued' AND i.void_date IS NULL AND i.total_cents-COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON p.id=a.source_id AND a.source_kind='payment' WHERE a.target_kind='invoice' AND a.target_id=i.id AND (a.source_kind='credit' OR p.reversal_id IS NULL) AND a.voided_on IS NULL),0)=?) AND NOT EXISTS(SELECT 1 FROM pt_stripe_payments WHERE invoice_id=? AND status='processing')",i.id,row.invoice_revision,row.open_cents,i.id),guard('EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND revision=? AND active=1)',i.customer_id,customer!.revision)],onClaim:id=>[q('INSERT INTO pt_collection_sends VALUES(?,?,?,?,?,?)',uid(),i.id,row.revision,id,now(),JSON.stringify({subject:row.subject,body:row.body,recipient:row.recipient,evidence:JSON.parse(row.evidence)})),q("UPDATE pt_collection_cases SET status='sent' WHERE invoice_id=? AND revision=? AND status='approved'",i.id,row.revision),changed()]})
 requireThat(d,'A reminder already claimed this invoice today; no second send was attempted',409)
 return {delivery:d,cases:(await collectionsView(c)).cases}
}}
const hold:Command={need:'owner',async run(c,b){owner(c);const {i,row}=await current(c,text(b.id,'Invoice'));requireThat(row.revision===b.revision,'Case changed; reload',409);requireThat(['promise','disputed','stopped','draft'].includes(b.status),'Choose a promise, dispute, stop or explicit resumption')
 const promise=b.status==='promise'?date(b.promiseDate,'Promised payment date'):null,note=text(b.note,'Customer reply or owner reason',2000)
 requireThat(!promise||promise>=businessDay((await sendingSettings(c.db)).time_zone),'A new promise must be today or later')
 await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_collection_cases SET status=?,promise_date=?,reply_note=?,approved_by=NULL,approved_revision=NULL,revision=?,updated_at=? WHERE invoice_id=? AND revision=?',b.status,promise,note,uid(),now(),i.id,b.revision),changed(),q('UPDATE pt_invoices SET reminders_paused=1 WHERE id=?',i.id),audit(who(c.actor),'collections.hold','invoice',i.id,{status:b.status,promiseDate:promise,note,ordinaryReminders:'Paused; owner can resume in invoice settings'})]);return collectionsView(c)
}}
export const collectionCommands:Record<string,Command>={'collections.prepare':prepare,'collections.save':save,'collections.approve':approve,'collections.send':send,'collections.hold':hold}
