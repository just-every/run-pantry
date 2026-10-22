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

/** Resolve a document component by its immutable posting ordinal or grouped
 * extra, so source-derived reports use the same correction as cash/ledger. */
export async function documentComponentCoding(db:D1Database){
 const coding=await documentCoding(db),posted=await all(db,'SELECT * FROM pt_journal_lines ORDER BY line_no')
 return (source:Data,role:'sale'|'discount'='sale')=>{
  const original=posted.find(l=>l.entry_id===source.journal_id&&(role==='sale'?l.line_no===Number(source.line_no)+1:l.memo.startsWith('Discounts ')&&['class','location','project'].every(k=>(l[k+'_name']??'')===(source[k+'_name']??''))))
  return original?correctedTags(original,coding):dimensionTags(source)
 }
}

export async function documentCorrectionFence(db:D1Database):Promise<Sql>{
 const expression='SELECT json_group_array(json_array(id,document_line_id,correcting_entry_id)) FROM (SELECT * FROM pt_reclassifications WHERE document_line_id IS NOT NULL ORDER BY id)'
 const row=(await all(db,expression))[0]
 return guard(`(${expression})=?`,Object.values(row)[0])
}
