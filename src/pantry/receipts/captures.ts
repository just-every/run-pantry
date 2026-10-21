// Explicit multi-receipt crops retain a single exact source photograph. Each
// part is published atomically with its receipt and can be retried by its index.
import type { Hono } from 'hono'
import type { Bindings } from '../../auth.server'
import { authority, must, person, who } from '../access'
import { Fault, now, requireThat, uid, type Data } from '../core'
import { all, audit, guard, one, q, run } from '../db'
import { documentStatements, MAX_DOCUMENT_BYTES } from '../documents'
import { readable, receive } from './intake'
import { applyRules } from './review'
import { bytesOf } from './upload'

type Region = { x: number; y: number; width: number; height: number }
function regionsOf(value: FormDataEntryValue | null): Region[] {
  let regions: unknown
  try { regions = JSON.parse(String(value)) } catch { throw new Fault(400, 'Choose the receipt regions') }
  requireThat(Array.isArray(regions) && regions.length >= 2 && regions.length <= 20, 'Choose 2–20 receipt regions')
  requireThat(regions.every(r => r && typeof r === 'object' && ['x','y','width','height'].every(k => typeof r[k] === 'number' && Number.isFinite(r[k])) && r.x >= 0 && r.y >= 0 && r.width > 0 && r.height > 0 && r.x + r.width <= 1.000001 && r.y + r.height <= 1.000001), 'Receipt regions must fit inside the photograph')
  return regions
}
const uploadForm = async (c: any, limit: number) => {
  requireThat(Number(c.req.header('content-length') ?? 0) <= limit + 100_000, 'The upload is too large', 413)
  return c.req.formData().catch(() => { throw new Fault(400, 'Send the photograph as a form upload') }) as Promise<FormData>
}

export async function captureProvenance(db: D1Database, receipts: Data[]) {
  if (!receipts.length) return
  const rows = await all(db, `SELECT p.receipt_id,p.part_index,s.id,s.regions,s.document_id,d.sha256,d.name
    FROM pt_capture_parts p JOIN pt_capture_sources s ON s.id=p.source_id JOIN pt_documents d ON d.id=s.document_id`)
  const byId = new Map(rows.map(row => [row.receipt_id, row]))
  for (const receipt of receipts) {
    const row = byId.get(receipt.id)
    if (row) receipt.capture = { id: row.id, index: row.part_index, region: JSON.parse(row.regions)[row.part_index], originalDocumentId: row.document_id, originalSha256: row.sha256, originalName: row.name }
  }
}

export function captureRoutes(api: Hono<{ Bindings: Bindings }>) {
  api.post('/api/pantry/receipts/captures', async c => {
    const actor = await person(c.req.raw, c.env); must(actor, 'record')
    const form = await uploadForm(c, MAX_DOCUMENT_BYTES)
    const file = await bytesOf(form.get('file'), MAX_DOCUMENT_BYTES, 'The photograph')
    requireThat(file && /^image\/(jpeg|png)$/.test(file.mediaType), 'Choose a JPEG or PNG photograph to split')
    const regions = regionsOf(form.get('regions')), id = uid(), revision = uid()
    const source = form.get('source') === 'camera' ? 'camera' : 'upload'
    const original = await documentStatements(who(actor).email, { ...file, linkedKind: 'capture-source', linkedId: id, note: 'Exact whole photograph for the selected receipt regions' })
    await run(c.env.DB, [authority(actor, 'record'), ...original.statements,
      q('INSERT INTO pt_capture_sources(id,document_id,revision,regions,source,created_by,created_at) VALUES(?,?,?,?,?,?,?)', id, original.id, revision, JSON.stringify(regions), source, who(actor).email, now()),
      audit(who(actor), 'receipt.capture-plan', 'document', original.id, { captureId: id, regions, sha256: original.sha256 })])
    return c.json({ id, revision, originalDocumentId: original.id })
  })
  api.post('/api/pantry/receipts/captures/:id/parts/:index', async c => {
    const actor = await person(c.req.raw, c.env); must(actor, 'record')
    const source = await one(c.env.DB, 'SELECT s.*,d.erased_at FROM pt_capture_sources s JOIN pt_documents d ON d.id=s.document_id WHERE s.id=?', c.req.param('id'))
    requireThat(source, 'Capture not found', 404)
    requireThat(!source.erased_at, 'The original photograph was erased', 410)
    const index = Number(c.req.param('index')), regions = JSON.parse(source.regions)
    requireThat(Number.isInteger(index) && index >= 0 && index < regions.length, 'Choose a receipt region')
    const form = await uploadForm(c, 4_000_000)
    requireThat(form.get('captureRevision') === source.revision, 'The capture changed; start again', 409)
    const existing = await one(c.env.DB, 'SELECT receipt_id AS id FROM pt_capture_parts WHERE source_id=? AND part_index=?', source.id, index)
    if (existing) return c.json({ id: existing.id, duplicate: null })
    const file = await bytesOf(form.get('file'), 4_000_000, 'The receipt crop')
    requireThat(file && file.mediaType === 'image/jpeg', 'The receipt crop is a JPEG')
    const result = await receive(c.env.DB, c.env, { by: who(actor), source: source.source, original: { ...file, note: 'Derived receipt crop; exact whole photograph is linked separately' }, read: readable(file),
      guards: [authority(actor, 'record'), guard('EXISTS(SELECT 1 FROM pt_capture_sources s JOIN pt_documents d ON d.id=s.document_id WHERE s.id=? AND s.revision=? AND d.erased_at IS NULL)', source.id, source.revision)],
      publication: (receiptId, documentId) => [q('INSERT INTO pt_capture_parts(source_id,part_index,receipt_id,document_id) VALUES(?,?,?,?)', source.id, index, receiptId, documentId)] })
    await applyRules(c.env.DB, result.id)
    return c.json({ id: result.id, duplicate: null })
  })
}
