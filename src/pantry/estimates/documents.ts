import { buildInvoiceDocument } from '../invoice-documents'
import { invoicePdf, type InvoiceDocument } from '../invoice-pdf'
import { base64Bytes, bytesBase64 } from '../invoice-logo'
import { requireThat, sha256, type Data } from '../core'
import { one } from '../db'
import { estimateRaw } from './store'
import { percentLabel } from '../discounts'

export async function estimateDocument(db:D1Database,row:Data,p:Data,templateId?:string):Promise<InvoiceDocument> {
  const doc=await buildInvoiceDocument(db,{...row,kind:'invoice'},p,templateId)
  doc.title=`Estimate ${row.number}`
  doc.facts=doc.facts.map(([label,value])=>[label==='Issued'?'Estimated':label==='Due'?'Invoice due date':label,value])
  if(p.terms)doc.notes.push(`Proposed early-payment term: ${percentLabel(p.terms.percentMilli)} within ${p.terms.days} days of the converted invoice. This estimate has no payment offer.`)
  doc.notes.push('Acceptance applies to this estimate revision. This estimate does not post to the books.')
  return doc
}
export async function estimatePreview(db:D1Database,id:string,templateId?:string) {
  const {row,p}=await estimateRaw(db,id)
  const saved=!templateId?await one(db,'SELECT * FROM pt_estimate_documents WHERE estimate_id=? AND revision=?',id,row.revision):null
  requireThat(row.status==='draft'||templateId||saved,'The sent estimate document is missing; its bytes cannot be regenerated',409)
  requireThat(!saved?.erased_at,'This retained estimate document was erased',410)
  const document=saved?JSON.parse(saved.document):await estimateDocument(db,row,p,templateId)
  const pdf=saved?base64Bytes(saved.pdf_base64):invoicePdf(document)
  return {document,pdf,sha256:saved?.sha256 ?? await sha256(pdf),basis:saved?'sent':'preview',issuedRevision:saved?row.revision:null,pdfBase64:bytesBase64(pdf)}
}
export async function publicEstimate(db:D1Database,token:string) {
  requireThat(/^[A-Za-z0-9_-]{32}$/.test(token),'Estimate link not found',404)
  const row=await one(db,"SELECT * FROM pt_estimates WHERE link_token=? AND status IN ('sent','accepted') AND erased_at IS NULL",token)
  requireThat(row,'Estimate link not found',404)
  const saved=await one(db,'SELECT * FROM pt_estimate_documents WHERE estimate_id=? AND revision=? AND erased_at IS NULL',row.id,row.revision)
  requireThat(saved,'Estimate document not found',404)
  return {row,saved,document:JSON.parse(saved.document) as InvoiceDocument}
}

// Never regenerate an accepted copy from mutable customer or template settings.
export async function acceptedEstimatePdf(db:D1Database,id:string) {
  const row=await one(db,'SELECT * FROM pt_estimate_documents WHERE estimate_id=? AND accepted_sha256 IS NOT NULL ORDER BY accepted_at DESC LIMIT 1',id)
  requireThat(row,'No accepted estimate PDF is retained',404)
  requireThat(!row.erased_at,'This retained estimate document was erased',410)
  return base64Bytes(row.accepted_pdf_base64)
}
