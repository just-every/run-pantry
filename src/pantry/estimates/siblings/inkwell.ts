import { sha256, type Data } from '../../core'
import { sourceBytes, sourceJson } from './transport'
import { hash, hashProof, object, sourceNeed, sourceString, timestamp, type Evidence, type Source } from './model'
export async function readInkwell(source:Source,estimate:Data,emails:Set<string>,originalHash:string):Promise<Evidence>{
 const base=`/api/v1/envelopes/${encodeURIComponent(source.remoteId)}/artifacts/`
 const data=await sourceJson(source,base+'handoff')
 sourceNeed(data.format==='inkwell-handoff/1'&&data.envelopeId===source.remoteId,'source_invalid')
 sourceNeed(data.status==='completed','source_not_completed')
 const original=hash(data.originalSha256),signed=hash(data.signedSha256)
 sourceNeed(original===originalHash,'original_mismatch')
 sourceNeed(Array.isArray(data.signers)&&data.signers.length>0&&data.signers.length<=20,'source_invalid')
 const signers=data.signers.map((s:unknown)=>{sourceNeed(object(s),'source_invalid');return {name:sourceString(s.name,200),email:sourceString(s.email,254).toLowerCase(),...(s.signedAt?{signed_at:timestamp(s.signedAt)}:{})}})
 const party=signers.find((s:Data)=>s.signed_at&&emails.has(s.email));sourceNeed(party,'contact_mismatch')
 const proof={format:'pantry-inkwell-link/1',envelope_id:source.remoteId,title:sourceString(data.title,500),original_sha256:original,signed_sha256:signed,completed_at:timestamp(data.executedOn),signers}
 const pdf=await sourceBytes(source,base+'signed',4*1024*1024)
 sourceNeed(new TextDecoder().decode(pdf.slice(0,5))==='%PDF-','source_invalid')
 sourceNeed(await sha256(pdf)===signed,'signed_mismatch')
 return {remoteRevision:signed,proof,proofHash:await hashProof(proof),pdf,pdfHash:signed,summary:{title:proof.title,status:'completed',customer_name:estimate.customer_name,contact_email:party.email,total_cents:estimate.total_cents,deposit_cents:0,currency:'USD',completed_at:proof.completed_at,original_sha256:original,signed_sha256:signed}}
}
