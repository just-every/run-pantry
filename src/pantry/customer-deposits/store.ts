import type { Context } from '../context'
import { dimensionTags } from '../dimensions'
import { all, one } from '../db'
import { requireThat, type Data } from '../core'
export async function customerDeposit(db:D1Database,id:string):Promise<Data>{
  const row=await one(db,'SELECT d.*,c.name AS customer_name,e.reversed_by_id AS reversal_id FROM pt_customer_deposits d JOIN pt_contacts c ON c.id=d.customer_id JOIN pt_journal_entries e ON e.id=d.journal_id WHERE d.id=?',id)
  requireThat(row,'Customer deposit not found',404)
  const coding=await one(db,'SELECT class_name,location_name,project_name FROM pt_journal_lines WHERE entry_id=? AND account_id=? ORDER BY line_no LIMIT 1',row.journal_id,row.liability_account_id)
  requireThat(coding,'Customer deposit source posting is missing',409)
  const applications=await all(db,'SELECT a.*,p.reversal_id,i.number FROM pt_customer_deposit_applications a JOIN pt_payments p ON p.id=a.payment_id JOIN pt_invoices i ON i.id=a.invoice_id WHERE a.deposit_id=? ORDER BY a.created_at,a.id',id)
  const applied=applications.filter(a=>!a.reversal_id).reduce((s,a)=>s+a.amount_cents,0)
  const reserved=Number((await one(db,`SELECT COALESCE(SUM(x.amount_cents),0) AS n FROM pt_invoice_deposit_plans x JOIN pt_invoices i ON i.id=x.invoice_id WHERE x.deposit_id=? AND i.status<>'issued'`,id))?.n??0)
  return {...row,...dimensionTags(coding),applications,applied_cents:applied,remaining_cents:row.reversal_id?0:row.amount_cents-applied,reserved_cents:reserved,available_cents:row.reversal_id?0:row.amount_cents-applied-reserved}
}
export async function customerDepositsView(c:Context){
  if(c.actor.kind!=='person'||['sales','payables-clerk','time-only'].includes(c.actor.role))return {deposits:[]}
  const banks=c.actor.role==='owner'?null:c.actor.policy?.bankAccounts
  const rows=await all(c.db,'SELECT id,bank_account_id FROM pt_customer_deposits ORDER BY date DESC,created_at DESC,id')
  return {deposits:await Promise.all(rows.filter(r=>!banks||banks.includes(r.bank_account_id)).map(r=>customerDeposit(c.db,r.id)))}
}
