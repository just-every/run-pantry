import { runtimeBindings, type Bindings } from '../../auth.server'
import { requireThat, type Data } from '../core'
import { one } from '../db'
import { contact } from '../contacts'
import { invoiceByLink } from '../invoice-links'
import { estimateExpired } from '../estimates/validity'
import { reminderEligible } from '../reminder-claims'
import { autopayHolding } from '../autopay'

export async function textSubject(env:Bindings,db:D1Database,id:string,kind='invoice',purpose=kind,forShare=false) {
 requireThat(['invoice','estimate','receipt'].includes(kind),'Choose an invoice or estimate')
 requireThat(kind!=='receipt','Hosted sales receipts are not available yet',409)
 const row=await one(db,kind==='invoice'?'SELECT * FROM pt_invoices WHERE id=?':'SELECT * FROM pt_estimates WHERE id=?',id)
 requireThat(row,'Record not found',404)
 requireThat(row.link_token&&(forShare||row.sent_at)&&!row.void_date&&!row.erased_at,'Send this record by email first; its hosted link must still be active',409)
 if(kind==='invoice') {
  requireThat(row.kind==='invoice'&&row.status==='issued'&&await invoiceByLink(db,row.link_token),'This invoice link is unavailable',409)
  if(purpose==='reminder'){
   requireThat(!row.reminders_paused&&await one(db,`SELECT 1 WHERE ${reminderEligible}`,id),'Reminders are stopped for this invoice',409)
   requireThat(!await autopayHolding(env,db,id),'Reminders pause during automatic payment attempts',409)
  }
 }else requireThat(['sent','accepted'].includes(row.status)&&!estimateExpired(JSON.parse(row.pricing)),'This estimate link is unavailable',409)
 const customer=await contact(db,row.customer_id,'customer')
 requireThat(customer.active,'Customer is inactive',409)
 const business=await one(db,'SELECT legal_name FROM pt_entity WHERE id=1')
 const path=`/${kind==='invoice'?'i':'e'}/${row.link_token}`
 const link=runtimeBindings(env).AUTH_ORIGIN+path
 return {row,customer,business:business?.legal_name??'Business',path,link,kind,purpose} as Data
}
export function subjectFence(s:Data) {
 if(s.kind==='invoice')return {sql:"EXISTS(SELECT 1 FROM pt_invoices i JOIN pt_contacts c ON c.id=i.customer_id WHERE i.id=? AND i.link_token=? AND i.status='issued' AND i.kind='invoice' AND i.void_date IS NULL AND c.active=1 AND c.erased_at IS NULL)",params:[s.row.id,s.row.link_token]}
 return {sql:"EXISTS(SELECT 1 FROM pt_estimates e JOIN pt_contacts c ON c.id=e.customer_id WHERE e.id=? AND e.link_token=? AND e.revision=? AND e.erased_at IS NULL AND e.status IN ('sent','accepted') AND c.active=1 AND c.erased_at IS NULL)",params:[s.row.id,s.row.link_token,s.row.revision]}
}
