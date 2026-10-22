import { who } from '../../access'
import type { Command, Context } from '../../context'
import { now, requireThat, text, uid, type Data } from '../../core'
import { all, audit, changed, guard, one, q, run } from '../../db'
import { ownerSession } from '../../erasure/owner'
import { bytesBase64 } from '../../invoice-logo'
import { estimate } from '../store'
import { SourceFailure, remoteId, type Source } from './model'
import { siblingOrigin } from './transport'
import { readInkwell } from './inkwell'
import { readPlatter } from './platter'
import { siblingProjection } from './store'

async function current(c:Context,b:Data){
 const e=await estimate(c.db,text(b.id,'Estimate'))
 requireThat(!e.erased_at,'The estimate subject was erased',410)
 requireThat(e.revision===b.revision,'Estimate changed; reload before linking a sibling record',409)
 const doc=await one(c.db,'SELECT sha256 FROM pt_estimate_documents WHERE estimate_id=? AND revision=? AND erased_at IS NULL',e.id,e.revision)
 requireThat(doc,'Send and retain the current estimate revision before attaching sibling evidence',409)
 return {e,doc}
}
const preview:Command={need:'owner',async run(c,b){
 const owner=await ownerSession(c),{e,doc}=await current(c,b)
 requireThat(b.provider==='inkwell'||b.provider==='platter','Choose Inkwell or Platter')
 const source:Source={provider:b.provider,origin:siblingOrigin(c,b.origin),remoteId:remoteId(b.remoteId),token:text(b.token,'Transient sibling token',1000)}
 requireThat(/^[A-Za-z0-9_./+=-]{8,1000}$/.test(source.token),'Enter the sibling Bearer token without a prefix or whitespace')
 requireThat(!source.remoteId.includes(source.token)&&!source.origin.includes(source.token),'Keep the credential out of record IDs and origins')
 const customer=await one(c.db,'SELECT email,contacts_json FROM pt_contacts WHERE id=? AND active=1',e.customer_id)
 requireThat(customer,'Customer is inactive',409)
 const emails=new Set<string>([customer.email,...JSON.parse(customer.contacts_json??'[]').map((p:Data)=>p.email)].filter(Boolean).map((s:string)=>s.trim().toLowerCase()))
 try{
  const evidence=source.provider==='inkwell'?await readInkwell(source,e,emails,doc.sha256):await readPlatter(source,e,emails)
  // Even a hostile upstream cannot turn an echoed credential into stored proof.
  requireThat(!JSON.stringify([evidence.summary,evidence.proof]).includes(source.token),'Sibling returned credential material; nothing was retained',409)
  const id=uid(),revision=uid(),at=now(),expires=new Date(Date.now()+15*60*1000).toISOString()
  await run(c.db,[...owner,
   guard('EXISTS(SELECT 1 FROM pt_estimates WHERE id=? AND revision=? AND erased_at IS NULL)',e.id,e.revision),
   guard('EXISTS(SELECT 1 FROM pt_estimate_documents WHERE estimate_id=? AND revision=? AND sha256=? AND erased_at IS NULL)',e.id,e.revision,doc.sha256),
   q("INSERT INTO pt_estimate_sibling_previews(id,estimate_id,estimate_revision,revision,owner_id,provider,origin,remote_id,remote_revision,summary,proof,proof_sha256,pdf_base64,pdf_sha256,created_at,expires_at,status)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,'pending')",id,e.id,e.revision,revision,c.actor.id,source.provider,source.origin,source.remoteId,evidence.remoteRevision,JSON.stringify(evidence.summary),JSON.stringify(evidence.proof),evidence.proofHash,evidence.pdf?bytesBase64(evidence.pdf):null,evidence.pdfHash??null,at,expires),
   audit(who(c.actor),'estimate.sibling-preview','estimate',e.id,{provider:source.provider,previewId:id,proofSha256:evidence.proofHash,ownerConsent:'Explicit source read; no sending, acceptance or payment instruction'})])
  return {ok:true,preview:siblingProjection((await one(c.db,'SELECT * FROM pt_estimate_sibling_previews WHERE id=?',id))!,true)}
 }catch(error){
  if(!(error instanceof SourceFailure))throw error
  const failure={id:uid(),estimate_id:e.id,estimate_revision:e.revision,provider:source.provider,origin:source.origin,remote_id:source.remoteId,error_class:error.code,at:now()}
  await run(c.db,[...owner,q('INSERT INTO pt_estimate_sibling_attempts(id,estimate_id,estimate_revision,provider,origin,remote_id,error_class,at)VALUES(?,?,?,?,?,?,?,?)',failure.id,e.id,e.revision,source.provider,source.origin,source.remoteId,failure.error_class,failure.at),audit(who(c.actor),'estimate.sibling-read-failed','estimate',e.id,{provider:source.provider,errorClass:failure.error_class})])
  return {ok:false,failure}
 }
}}
const confirm:Command={need:'owner',async run(c,b){
 const owner=await ownerSession(c),{e,doc}=await current(c,b),p=await one(c.db,'SELECT * FROM pt_estimate_sibling_previews WHERE id=? AND estimate_id=?',text(b.previewId,'Reviewed preview'),e.id)
 requireThat(p&&p.revision===b.previewRevision&&p.estimate_revision===e.revision&&p.owner_id===c.actor.id,'The reviewed preview changed; read the source again',409)
 requireThat(!p.erased_at,'This preview was erased',410)
 if(p.status==='attached'){const linked=await one(c.db,'SELECT * FROM pt_estimate_sibling_links WHERE id=?',p.link_id);requireThat(linked&&!linked.erased_at,'This linked record was erased',410);await run(c.db,owner);return {link:siblingProjection(linked)}}
 requireThat(p.expires_at>now(),'This preview expired; explicitly read the source again',409)
 const proof=JSON.parse(p.proof)
 requireThat(p.provider!=='inkwell'||proof.original_sha256===doc.sha256,'The retained PDF no longer matches the reviewed signature source',409)
 const existing=await one(c.db,'SELECT * FROM pt_estimate_sibling_links WHERE provider=? AND origin=? AND remote_id=? AND remote_revision=?',p.provider,p.origin,p.remote_id,p.remote_revision)
 requireThat(!existing||(existing.estimate_id===e.id&&existing.estimate_revision===e.revision&&existing.proof_sha256===p.proof_sha256&&!existing.erased_at),'That source revision is already attached elsewhere or changed',409)
 const id=existing?.id??uid(),at=now()
 await run(c.db,[...owner,
  guard('EXISTS(SELECT 1 FROM pt_estimates WHERE id=? AND revision=? AND erased_at IS NULL)',e.id,e.revision),
  guard('EXISTS(SELECT 1 FROM pt_estimate_documents WHERE estimate_id=? AND revision=? AND sha256=? AND erased_at IS NULL)',e.id,e.revision,doc.sha256),
  guard("EXISTS(SELECT 1 FROM pt_estimate_sibling_previews WHERE id=? AND revision=? AND status='pending' AND expires_at>? AND erased_at IS NULL)",p.id,b.previewRevision,at),
  ...(existing?[]:[q('INSERT INTO pt_estimate_sibling_links(id,estimate_id,estimate_revision,revision,provider,origin,remote_id,remote_revision,summary,proof,proof_sha256,pdf_base64,pdf_sha256,attached_at,attached_by)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)',id,e.id,e.revision,uid(),p.provider,p.origin,p.remote_id,p.remote_revision,p.summary,p.proof,p.proof_sha256,p.pdf_base64,p.pdf_sha256,at,c.actor.email)]),
  q("UPDATE pt_estimate_sibling_previews SET status='attached',link_id=?,proof='{}',pdf_base64=NULL WHERE id=? AND revision=? AND status='pending'",id,p.id,p.revision),changed(),
  audit(who(c.actor),'estimate.sibling-attached','estimate',e.id,{provider:p.provider,linkId:id,proofSha256:p.proof_sha256,ownerConsent:'Attach only the exact reviewed source evidence; native acceptance and conversion stay separate'})])
 return {link:siblingProjection((await one(c.db,'SELECT * FROM pt_estimate_sibling_links WHERE id=?',id))!)}
}}
export const siblingCommands:Record<string,Command>={'estimate.sibling-preview':preview,'estimate.sibling-confirm':confirm}
