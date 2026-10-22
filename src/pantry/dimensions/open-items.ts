// Dimension shares of open documents use the same original line amounts and
// cumulative settlement rounding as cash recognition. Header balances are never
// assigned to a project just because one of its lines names that project.
import { all } from '../db'
import { cashLines } from '../basis'
import { afterTaxShares } from '../discounts'
import { unappliedRows, appliedAsOf } from '../open-items'
import type { Data } from '../core'
import { inDimension, type DimensionScope } from './scope'

type Document = { id:string; kind:string; journalId:string; amount:number; total:number; recognizable:boolean }
export async function dimensionOpenItems(db:D1Database,kind:'receivable'|'payable',asOf:string,dimension:DimensionScope) {
 const documents=new Map<string,Document>()
 const posted=await all(db,`SELECT l.*,e.entry_date,e.source_id,e.id AS journal_id FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id JOIN pt_accounts a ON a.id=l.account_id WHERE e.status='posted' AND e.entry_date<=? AND a.subtype NOT IN ('receivable','payable')`,asOf)
 const corrections=await all(db,`SELECT r.correcting_entry_id,root.entry_id AS journal_id FROM pt_reclassifications r JOIN pt_journal_lines root ON root.id=r.document_line_id WHERE r.document_line_id IS NOT NULL`)

 const add=(row:Data,kind:string,total:number,parts:Data[])=>{
  const entries=new Set([row.journal_id,...corrections.filter(c=>c.journal_id===row.journal_id).map(c=>c.correcting_entry_id)])
  const effective=row.journal_id?posted.filter(l=>entries.has(l.entry_id)).map(l=>({...l,amount:(l.debit_cents-l.credit_cents)*(['invoice','vendor-credit'].includes(kind)?-1:1)})):parts
  const amount=effective.length?effective.filter(p=>inDimension(p,dimension)).reduce((n,p)=>n+p.amount,0):dimension.value===''?total:0
  documents.set(row.id,{id:row.id,kind,journalId:row.journal_id,amount,total,recognizable:!!row.journal_id&&parts.length>0})
 }
 const invoices=await all(db,"SELECT * FROM pt_invoices WHERE status='issued' AND issue_date<=?",asOf)
 const invoiceLines=await all(db,'SELECT * FROM pt_invoice_lines ORDER BY invoice_id,line_no')
 for(const i of invoices) {
  const lines=invoiceLines.filter(l=>l.invoice_id===i.id),after=afterTaxShares(lines,JSON.parse(i.discounts??'[]'),i.after_tax_discount_cents)
  add(i,i.kind,i.total_cents,lines.map((l,n)=>({...l,amount:l.amount_cents-(l.discount_cents??0)+l.tax_cents-(after[n]??0)})))
 }
 const bills=await all(db,"SELECT * FROM pt_bills WHERE (status='posted' OR (opening=1 AND status<>'void')) AND bill_date<=?",asOf)
 const billLines=await all(db,'SELECT * FROM pt_bill_lines ORDER BY bill_id,line_no')
 for(const b of bills)add(b,'bill',b.total_cents,billLines.filter(l=>l.bill_id===b.id).map(l=>({...l,amount:l.amount_cents})))
 for(const v of await all(db,'SELECT * FROM pt_vendor_credits WHERE credit_date<=?',asOf))add(v,'vendor-credit',v.amount_cents,[{...v,amount:v.amount_cents}])
 const recognized=new Map<string,number>(),allocated=new Map<string,number>()
 for(const c of await cashLines(db,'0000-01-01',asOf)) {
  if(c.role==='control'||!inDimension(c,dimension))continue
  const doc=documents.get(c.docId);if(!doc)continue
  const amount=c.net*(['invoice','vendor-credit'].includes(doc.kind)?-1:1)
  recognized.set(doc.id,(recognized.get(doc.id)??0)+amount)
  if(c.settlement.allocationId){const key=doc.id+':'+c.settlement.allocationId;allocated.set(key,(allocated.get(key)??0)+amount)}
 }
 // Imported opening items without source lines carry their entire balance as
 // Unassigned; their actual allocations still reduce that opening balance.
 for(const a of await appliedAsOf(db,kind,asOf)) {
  const doc=documents.get(a.target_id)
  if(doc&&!doc.recognizable&&dimension.value==='') {
   recognized.set(doc.id,(recognized.get(doc.id)??0)+a.amount_cents)
   allocated.set(doc.id+':'+a.id,a.amount_cents)
  }
 }
 const paymentCoding=new Map((await all(db,`SELECT p.id,l.class_name,l.location_name,l.project_name FROM pt_payments p JOIN pt_journal_lines l ON l.entry_id=p.journal_id JOIN pt_accounts a ON a.id=l.account_id WHERE a.subtype=?`,kind)).map(p=>[p.id,p]))
 const byJournal=new Map([...documents.values()].map(d=>[d.journalId,d]))
 const unapplied=(await unappliedRows(db,kind,asOf)).map((u):Data=>{
  let amount=0
  if(u.part.startsWith('payment'))amount=inDimension(paymentCoding.get(u.record.id)??{},dimension)?u.amount:0
  else {
   const doc=u.part==='credit'?documents.get(u.id):u.record.kind==='invoice'?documents.get(u.record.id):byJournal.get(u.record.id)
   amount=u.part==='credit'?(doc?.amount??0):-(allocated.get((doc?.id??'')+':'+u.id)??0)
  }
  return {...u,amount}
 })
 return {documents,recognized,allocated,unapplied}
}
