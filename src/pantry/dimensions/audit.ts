import type { Data } from '../core'
import { q, type Sql } from '../db'

/** Capture the audited record after its write in the same atomic batch. Never
 * read today's mutable record when rendering yesterday's event. */
export function auditDimensionStatements(id:string,kind:string,subject:string,detail:Data):Sql[]{
 const statements:Sql[]=[],values=new Map<string,{kind:string;name:string}>()
 const keys=new Map(['class','location','project'].flatMap(kind=>[kind+'Name',kind+'_name','default'+kind[0].toUpperCase()+kind.slice(1),'default_'+kind].map(key=>[key,kind])))
 const visit=(value:unknown)=>{
  if(Array.isArray(value)){value.forEach(visit);return}
  if(!value||typeof value!=='object')return
  for(const [key,child]of Object.entries(value)){
   const dimension=keys.get(key)
   if(dimension&&typeof child==='string'&&child)values.set(JSON.stringify([dimension,child]),{kind:dimension,name:child})
   else if(child&&typeof child==='object')visit(child)
  }
 }
 visit(detail)
 if(values.size)statements.push(q("INSERT OR IGNORE INTO pt_audit_dimensions(audit_id,kind,name) SELECT ?,json_extract(value,'$.kind'),json_extract(value,'$.name') FROM json_each(?)",id,JSON.stringify([...values.values()])))
 let source:string|undefined
 if(['invoice','credit'].includes(kind))source='SELECT class_name,location_name,project_name FROM pt_invoice_lines WHERE invoice_id=?'
 else if(kind==='bill')source='SELECT class_name,location_name,project_name FROM pt_bill_lines WHERE bill_id=?'
 else if(kind==='journal')source='SELECT class_name,location_name,project_name FROM pt_journal_lines WHERE entry_id=?'
 else if(kind==='payment')source='SELECT l.class_name,l.location_name,l.project_name FROM pt_journal_lines l JOIN pt_payments p ON p.journal_id=l.entry_id WHERE p.id=?'
 else if(['bank-line','receipt','vendor-credit','recognition'].includes(kind)){
  const table={'bank-line':'pt_bank_lines',receipt:'pt_receipts','vendor-credit':'pt_vendor_credits',recognition:'pt_recognition_schedules'}[kind]
  source=`SELECT class_name,location_name,project_name FROM ${table} WHERE id=?`
 }else if(kind==='customer-deposit')source='SELECT l.class_name,l.location_name,l.project_name FROM pt_journal_lines l JOIN pt_customer_deposits d ON d.journal_id=l.entry_id WHERE d.id=?'
 else if(kind==='match')source='SELECT l.class_name,l.location_name,l.project_name FROM pt_bank_lines l JOIN pt_match_bank_lines m ON m.bank_line_id=l.id WHERE m.match_id=?'
 if(source)for(const dimension of ['class','location','project'])statements.push(q(`INSERT OR IGNORE INTO pt_audit_dimensions(audit_id,kind,name) SELECT ?,?,${dimension}_name FROM (${source}) WHERE ${dimension}_name<>''`,id,dimension,subject))
 return statements
}
