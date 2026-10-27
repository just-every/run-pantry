import { all, guard, type Sql } from '../db'
import { dimensionTags } from './index'
import type { Data } from '../core'

/** One chain per original document component; move the destination line to
 * recode again. The other side is a contra, not a second movable component. */
export async function documentCoding(db:D1Database){
 const rows=await all(db,`SELECT r.document_line_id,l.*,e.number FROM pt_reclassifications r JOIN pt_journal_entries e ON e.id=r.correcting_entry_id JOIN pt_journal_lines l ON l.entry_id=e.id AND l.line_no=1 WHERE r.document_line_id IS NOT NULL ORDER BY r.created_at,r.rowid`)
 return new Map(rows.map(r=>[String(r.document_line_id),r]))
}
export const correctedTags=(line:Data,coding:Map<string,Data>)=>dimensionTags(coding.get(String(line.id))??line)

/** Settlement writes/reversals must not race a reviewed document correction. */
export async function settlementFence(db:D1Database):Promise<Sql>{
 const expression=`SELECT json_group_array(json_array(a.id,a.amount_cents,a.allocation_date,a.voided_on,a.voided_by,p.reversal_id)) FROM (SELECT * FROM pt_allocations ORDER BY id) a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id`
 const state=(await all(db,expression))[0]
 return guard(`(${expression})=?`,Object.values(state)[0])
}

/** Read all immutable siblings of a corrected document posting.
 * Invoice extras follow all sale ordinals and retain their posting account,
 * side and reviewed dimension group, independently of person-entered memos. */
export async function correctedDocumentPostings(db:D1Database){
 return all(db,`SELECT l.*,i.kind AS invoice_kind,i.discount_account_id,
  (SELECT count(*) FROM pt_invoice_lines il WHERE il.invoice_id=i.id) AS invoice_line_count
  FROM pt_journal_lines l LEFT JOIN pt_invoices i ON i.journal_id=l.entry_id
  WHERE l.entry_id IN (SELECT entry_id FROM pt_journal_lines WHERE id IN
   (SELECT document_line_id FROM pt_reclassifications WHERE document_line_id IS NOT NULL))
  ORDER BY l.entry_id,l.line_no`)
}

export function isInvoiceExtra(line:Data,source:Data,accountId:string,sign:number){
 return line.invoice_kind && Number(line.line_no)>Number(line.invoice_line_count)+1 &&
  line.account_id===accountId && (line.debit_cents-line.credit_cents)*sign>0 &&
  ['class','location','project'].every(k=>(line[k+'_name']??'')===(source[k+'_name']??''))
}

/** Resolve the original component first, then follow that posting's own id. */
export async function documentComponentCoding(db:D1Database){
 const coding=await documentCoding(db)
 const posted=coding.size?await correctedDocumentPostings(db):[]
 const byEntry=new Map<string,typeof posted>()
 for(const line of posted){const rows=byEntry.get(line.entry_id)??[];rows.push(line);byEntry.set(line.entry_id,rows)}
 return(source:Data,role:'sale'|'discount'='sale')=>{
  const original=(byEntry.get(source.journal_id)??[]).find(l=>role==='sale'
   ?l.line_no===Number(source.line_no)+1
   :isInvoiceExtra(l,source,l.discount_account_id,l.invoice_kind==='credit'?-1:1))
  return original?correctedTags(original,coding):dimensionTags(source)
 }
}

export async function documentCorrectionFence(db:D1Database):Promise<Sql>{
 const expression='SELECT json_group_array(json_array(id,document_line_id,correcting_entry_id)) FROM (SELECT * FROM pt_reclassifications WHERE document_line_id IS NOT NULL ORDER BY id)'
 const row=(await all(db,expression))[0]
 return guard(`(${expression})=?`,Object.values(row)[0])
}
