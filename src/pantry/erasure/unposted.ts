// Remove a transaction-free party's dormant, nonfinancial dependent rows.
import {all,changed,q,type Sql} from '../db'
import type {Data} from '../core'
export async function unpostedDependents(db:D1Database,id:string) {
  const statements:Sql[]=[],counts:Record<string,Data>={},removed:{table:string;key:Record<string,unknown>}[]=[]
  const selections:[string,string,string[]][]=[
    ['pt_autopay_notices','attempt_id IN(SELECT id FROM pt_autopay_attempts WHERE customer_id=?)',['id']],
    ['pt_autopay_attempts','customer_id=?',['id']],
    ['pt_autopay_policies','customer_id=?',['customer_id']],
    ['pt_autopay_setups','customer_id=?',['id']],
    ['pt_estimate_sibling_previews','estimate_id IN (SELECT id FROM pt_estimates WHERE customer_id=?)',['id']],
    ['pt_estimate_sibling_attempts','estimate_id IN (SELECT id FROM pt_estimates WHERE customer_id=?)',['id']],
    ['pt_estimate_sibling_links','estimate_id IN (SELECT id FROM pt_estimates WHERE customer_id=?)',['id']],
    ['pt_estimate_deliveries','estimate_id IN (SELECT id FROM pt_estimates WHERE customer_id=?)',['id']],
    ['pt_estimate_documents','estimate_id IN (SELECT id FROM pt_estimates WHERE customer_id=?)',['estimate_id','revision']],
    ['pt_estimates','customer_id=?',['id']],
    ['pt_time_projects','customer_id=? AND NOT EXISTS (SELECT 1 FROM pt_time_entries t WHERE t.project_id=pt_time_projects.id)',['id']],
    ['pt_recurring_runs','recurring_id IN (SELECT id FROM pt_recurring WHERE customer_id=?)',['recurring_id','occurrence']],
    ['pt_recurring_prices','recurring_id IN (SELECT id FROM pt_recurring WHERE customer_id=?)',['id']],
    ['pt_recurring','customer_id=?',['id']],
    ['pt_recurring_bill_runs','recurring_id IN (SELECT id FROM pt_recurring_bills WHERE vendor_id=?)',['recurring_id','occurrence']],
    ['pt_recurring_bills','vendor_id=?',['id']],
    ['pt_exemption_reminders','certificate_id IN (SELECT id FROM pt_exemption_certificates WHERE customer_id=?)',['certificate_id']],
    ['pt_exemption_certificates','customer_id=?',['id']],
  ]
  statements.push(q('UPDATE pt_contacts SET autopay_setup_id=NULL WHERE id=?',id))
  for(const [table,where,keys] of selections) {
    const rows=await all(db,`SELECT ${keys.join(',')} FROM ${table} WHERE ${where}`,id)
    if(!rows.length)continue
    statements.push(q(`DELETE FROM ${table} WHERE ${where}`,id),changed(rows.length));counts[table]={rowsRemoved:rows.length}
    removed.push(...rows.map(row=>({table,key:Object.fromEntries(keys.map(k=>[k,row[k]]))})))
  }
  return {statements,counts,removed}
}
