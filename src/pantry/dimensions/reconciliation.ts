import { all } from '../db'
import type { Data } from '../core'
import { FIRST_DAY, reportSourceRows } from '../report-sources'
import { inDimension, type DimensionScope } from './scope'

/** Statement balances carry no business dimension. Only Unassigned includes
 * those external numbers; book contributions use immutable bank-line coding.
 * A saved proof reads only entries already posted when it was completed. */
export async function dimensionReconciliation(db:D1Database,state:Data,dimension:DimensionScope) {
 const proof=state.completed?JSON.parse(state.completed.proof):state
 const posted=state.completed?new Set((await all(db,"SELECT id FROM pt_journal_entries WHERE status='posted' AND posted_at<=?",state.completed.completed_at)).map(e=>e.id)):null
 const bookRows=(await reportSourceRows(db,{accountId:state.bank.account_id,types:[],from:FIRST_DAY,to:state.statement.end_date,sign:1},'accrual')).filter(row=>inDimension(row,dimension)&&(!posted||posted.has(row.entry.id)))
 const outstandingIds=new Set((proof.outstanding as Data[]).map(row=>row.id))
 const outstandingRows=bookRows.filter(row=>outstandingIds.has(row.key)),clearedRows=bookRows.filter(row=>!outstandingIds.has(row.key))
 const sum=(rows:Data[])=>rows.reduce((n,row)=>n+row.amount,0)
 const opening=dimension.value===''?proof.opening:0,closing=dimension.value===''?proof.closing:0,book=sum(bookRows),outstanding=sum(outstandingRows),cleared=sum(clearedRows)
 return {opening,closing,book,outstanding,cleared,difference:closing-cleared,bookRows,outstandingRows,clearedRows}
}
