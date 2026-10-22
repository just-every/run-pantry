import type { Context } from '../../context'
import { requireThat, text, type Data } from '../../core'
import { all, one, run } from '../../db'
import { ownerSession } from '../../erasure/owner'
import { base64Bytes } from '../../invoice-logo'

export function siblingProjection(row:Data,preview=false){
 const {proof,pdf_base64,owner_id,...safe}=row
 return {...safe,summary:JSON.parse(row.summary),...(preview?{}:{document_href:row.pdf_sha256&&!row.erased_at?`/api/pantry/estimate-siblings/${encodeURIComponent(row.id)}/document`:null})}
}
export async function siblingsView(c:Context,estimateId:string){
 const guards=await ownerSession(c),id=text(estimateId,'Estimate')
 const [previews,links,attempts]=await Promise.all([
  all(c.db,'SELECT * FROM pt_estimate_sibling_previews WHERE estimate_id=? ORDER BY created_at DESC,id',id),
  all(c.db,'SELECT * FROM pt_estimate_sibling_links WHERE estimate_id=? ORDER BY attached_at DESC,id',id),
  all(c.db,'SELECT * FROM pt_estimate_sibling_attempts WHERE estimate_id=? ORDER BY at DESC,id LIMIT 100',id),
 ])
 await run(c.db,guards)
 return {previews:previews.map(r=>siblingProjection(r,true)),links:links.map(r=>siblingProjection(r)),attempts}
}
export async function siblingArtifact(c:Context,rawId:string){
 const guards=await ownerSession(c),id=text(rawId,'Signed record'),row=await one(c.db,'SELECT * FROM pt_estimate_sibling_links WHERE id=?',id)
 requireThat(row&&row.provider==='inkwell'&&row.pdf_sha256,'Signed record not found',404)
 requireThat(!row.erased_at&&row.pdf_base64,'This retained signed document was erased',410)
 await run(c.db,guards)
 return {bytes:base64Bytes(row.pdf_base64),sha256:row.pdf_sha256 as string,name:`signed-estimate-${row.estimate_id}.pdf`,mediaType:'application/pdf'}
}
