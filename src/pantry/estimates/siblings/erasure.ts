import { all, changed, q, type Sql } from '../../db'
import { scrub } from '../../erasure/personal'
import type { Data } from '../../core'
type Input={id:string;member:boolean;memberEmail?:string;posted:boolean;values:string[];marker:string;erasureId:string;at:string}
/** Private previews/errors are disposable; attached original proof has custody. */
export async function siblingCopies(db:D1Database,input:Input){
 const statements:Sql[]=[],counts:Record<string,Data>={},removed:{table:string;key:Record<string,unknown>}[]=[],affectedRecordIds:string[]=[]
 if(!input.member&&!input.posted)return {statements,counts,removed,affectedRecordIds}
 const count=(table:string,field:string,n=1)=>{counts[table]??={};counts[table][field]=(counts[table][field]??0)+n}
 const redact=(v:any):any=>typeof v==='string'?scrub(v,input.values,input.marker):Array.isArray(v)?v.map(redact):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,redact(x)])):v
 const owners=input.member?await all(db,'SELECT id FROM oa_operators WHERE lower(email)=lower(?)',input.memberEmail??input.id):[]
 const ownerIds=new Set(owners.map(r=>r.id))
 const estimates=new Set((await all(db,'SELECT id FROM pt_estimates WHERE customer_id=?',input.id)).map(r=>r.id))
 // Unposted contacts are removed with all dependents by unpostedDependents.
 if(input.member||input.posted){
  const previews=await all(db,'SELECT id,revision,owner_id,estimate_id FROM pt_estimate_sibling_previews')
  for(const row of previews)if(input.member?ownerIds.has(row.owner_id):estimates.has(row.estimate_id)){
   statements.push(q('DELETE FROM pt_estimate_sibling_previews WHERE id=? AND revision=?',row.id,row.revision),changed())
   removed.push({table:'pt_estimate_sibling_previews',key:{id:row.id}});count('pt_estimate_sibling_previews','rowsRemoved');affectedRecordIds.push(row.id)
  }
  if(!input.member)for(const row of await all(db,'SELECT id,estimate_id FROM pt_estimate_sibling_attempts'))if(estimates.has(row.estimate_id)){
   statements.push(q('DELETE FROM pt_estimate_sibling_attempts WHERE id=?',row.id),changed());removed.push({table:'pt_estimate_sibling_attempts',key:{id:row.id}});count('pt_estimate_sibling_attempts','rowsRemoved');affectedRecordIds.push(row.id)
  }
 }
 for(const row of await all(db,'SELECT id,estimate_id,summary,attached_by,revision,erased_at FROM pt_estimate_sibling_links')){
  if(row.erased_at)continue
  const own=!input.member&&estimates.has(row.estimate_id),summary=redact(JSON.parse(row.summary))
  if(own&&summary.contact_email)summary.contact_email=input.marker
  const next=JSON.stringify(summary),by=input.member&&[input.id,input.memberEmail].includes(row.attached_by)?input.marker:row.attached_by
  if(next===row.summary&&by===row.attached_by)continue
  statements.push(q('UPDATE pt_estimate_sibling_links SET summary=?,attached_by=? WHERE id=? AND revision=? AND summary=? AND attached_by=?',next,by,row.id,row.revision,row.summary,row.attached_by),changed())
  count('pt_estimate_sibling_links','rowsReplaced');count('pt_estimate_sibling_links','fieldsReplaced',(next!==row.summary?1:0)+(by!==row.attached_by?1:0));affectedRecordIds.push(row.id)
 }
 return {statements,counts,removed,affectedRecordIds}
}
