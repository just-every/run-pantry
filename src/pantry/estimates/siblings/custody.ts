// Internal custody hooks. The parent retention policy selects the financial
// clock and requires owner-confirmed expiry before calling the mutation helper.
import { all, guard, one, q, changed, type Sql } from '../../db'
import { requireThat, type Data } from '../../core'
export async function siblingCustodyRows(db:D1Database,customerId:string){
 return all(db,`SELECT l.id,l.estimate_id,l.estimate_revision,l.revision,l.provider,l.proof_sha256,l.pdf_sha256,l.erased_at
 FROM pt_estimate_sibling_links l JOIN pt_estimates e ON e.id=l.estimate_id WHERE e.customer_id=? ORDER BY l.id`,customerId)
}
export async function expireSiblingEvidence(db:D1Database,id:string,erasureId:string,at:string):Promise<Sql[]>{
 const row=await one(db,'SELECT * FROM pt_estimate_sibling_links WHERE id=? AND erased_at IS NULL',id)
 requireThat(row,'The retained sibling record changed; reload',409)
 const old=JSON.parse(row.summary),summary=Object.fromEntries(['status','total_cents','deposit_cents','currency','completed_at','accepted_at','original_sha256','signed_sha256','deposit_meaning','money_received'].filter(k=>old[k]!==undefined).map(k=>[k,old[k]]))
 return [q("INSERT INTO pt_erasure_scope(erasure_id,table_name,row_id,operation)VALUES(?,'pt_estimate_sibling_links',?,'expire')",erasureId,id),
  guard('EXISTS(SELECT 1 FROM pt_estimate_sibling_links WHERE id=? AND revision=? AND proof_sha256=? AND pdf_sha256 IS ? AND erased_at IS NULL)',id,row.revision,row.proof_sha256,row.pdf_sha256),
  q("UPDATE pt_estimate_sibling_links SET proof='{}',pdf_base64=NULL,summary=?,erased_at=? WHERE id=? AND erased_at IS NULL",JSON.stringify(summary),at,id),changed()]
}
