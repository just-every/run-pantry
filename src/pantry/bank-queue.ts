// Explicit native review decisions. A batch rechecks the displayed suggestion
// and commits all its matches together; a stale member leaves the batch untouched.
import { authority, who } from './access'
import { bankAuthority } from './access-policy/banks'
import { now, requireThat, sha256, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, periodOpen, q, run, type Sql } from './db'
import type { Command, Context } from './context'
import { lineSuggestions, suggestionDecisions } from './line-suggestions'
import { matchPlan } from './matching'
import { depositProposals } from './automatch'
import { recordedPaymentCandidates } from './recorded-payments'

function ids(value:unknown):string[]{
 requireThat(Array.isArray(value)&&value.length>0&&value.length<=50&&value.every(x=>typeof x==='string'),'Choose 1–50 bank lines')
 requireThat(new Set(value).size===value.length,'Choose each bank line once')
 return value as string[]
}
async function queuePreview(c:Context,selected:string[]){
 const rows=await all(c.db,`SELECT * FROM pt_bank_lines WHERE id IN (${selected.map(()=>'?').join(',')})`,...selected)
 requireThat(rows.length===selected.length,'A bank line is missing',409)
 const suggestions=await lineSuggestions(c.db,rows),deposits=await depositProposals(c.db,rows),payments=await recordedPaymentCandidates(c.db,rows)
 return Promise.all(rows.map(async line=>{
  const suggestion=suggestions[line.id]
  const unavailable=!!(line.removed_at||line.excluded_at||!suggestion||suggestion.billId||deposits[line.id]||payments[line.id]?.length||await one(c.db,"SELECT 1 FROM pt_transfer_halves WHERE bank_line_id=? AND status IN ('pending','exception','paired')",line.id))
  return {id:line.id,description:line.description,amount_cents:line.amount_cents,bank_account_id:line.bank_account_id,suggestion:suggestion??null,
   available:!unavailable,fingerprint:await sha256(JSON.stringify({line,suggestion})),reason:unavailable?'Review this line individually; its current state has no category-only suggestion':'Review this category before accepting'}
 }))
}
const preview:Command={need:'record',async run(c,b){return {items:await queuePreview(c,ids(b.ids))}}}
const accept:Command={need:'record',async run(c,b){
 requireThat(Array.isArray(b.items),'Review the selected suggestions')
 const selected=ids(b.items.map((x:Data)=>x.id)),current=await queuePreview(c,selected),statements:Sql[]=[]
 for(const item of current){
  requireThat(item.available&&b.items.find((x:Data)=>x.id===item.id)?.fingerprint===item.fingerprint,'A line or its suggestion changed; review the whole selection again',409)
  const line=await one(c.db,'SELECT * FROM pt_bank_lines WHERE id=?',item.id),s=item.suggestion!
  const plan=await matchPlan(c.db,c.actor,{bankLineIds:[item.id],journalLineIds:[],create:[{type:item.amount_cents<0?'fee':'income',direction:item.amount_cents<0?'out':'in',amount:(Math.abs(item.amount_cents)/100).toFixed(2),...s.dimensions,accountId:s.accountId,contactId:s.contactId,memo:line!.description}]})
  statements.push(...plan.statements,...await suggestionDecisions(c.db,[line!],[s.accountId],who(c.actor),s.contactId?[s.contactId]:[],[s.dimensions??{}]))
 }
 await run(c.db,[authority(c.actor,'record'),...statements,audit(who(c.actor),'bank-queue.accept','bank-review',uid(),{lines:selected,count:selected.length})])
 return {accepted:selected}
}}
const exclusion:Command={need:'record',async run(c,b){
 const id=text(b.id,'Bank line'),line=await one(c.db,'SELECT * FROM pt_bank_lines WHERE id=?',id)
 requireThat(line&&!line.removed_at,'Bank line not found',404)
 const restore=b.restore===true,revision=uid(),at=now(),reason=text(b.reason,'Reason',500)
 requireThat(restore?line.excluded_at&&b.revision===line.exclusion_revision:!line.excluded_at,'The exclusion changed; reload',409)
 requireThat(restore||['personal','duplicate'].includes(b.kind),'Exclude as personal or duplicate')
 await run(c.db,[authority(c.actor,'record'),...bankAuthority(c.actor,[line.bank_account_id]),periodOpen(line.posted_date),
  guard('NOT EXISTS(SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id=? AND active=1)',id),
  guard("NOT EXISTS(SELECT 1 FROM pt_transfer_halves WHERE bank_line_id=? AND status IN ('pending','exception','paired'))",id),
  guard('NOT EXISTS(SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id=r.statement_id WHERE r.bank_account_id=? AND ? BETWEEN s.start_date AND s.end_date)',line.bank_account_id,line.posted_date),
  restore?q('UPDATE pt_bank_lines SET excluded_at=NULL,exclusion_revision=? WHERE id=? AND exclusion_revision=? AND excluded_at IS NOT NULL',revision,id,b.revision):
   q('UPDATE pt_bank_lines SET excluded_at=?,excluded_reason=?,excluded_kind=?,excluded_by=?,exclusion_revision=? WHERE id=? AND excluded_at IS NULL',at,reason,b.kind,c.actor.email,revision,id),changed(),
  audit(who(c.actor),restore?'bank-line.restore':'bank-line.exclude','bank-line',id,{kind:restore?line.excluded_kind:b.kind,reason})])
 return {id,revision}
}}
export const queueCommands:Record<string,Command>={'bank-queue.preview':preview,'bank-queue.accept':accept,'bank-line.exclude':exclusion}
