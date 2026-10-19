// The Documents and integration upload doors retain the same duplicate evidence
// as phone/email capture. A flagged upload cannot file on its requested record.
import { authority, who } from '../access'
import { optionalText, requireThat, text } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import type { Command, Context } from '../context'
import type { NewDocument } from '../documents'
import { documentMatch, type Fingerprint } from './fingerprints'
import { duplicateDetails } from './duplicates'
import { readable, readWith } from './intake'

export async function documentCaptureStatements(c: Context, id: string, input: NewDocument): Promise<Sql[]> {
  const bill = input.linkedKind === 'bill' ? await one(c.db, 'SELECT c.name, b.reference, b.bill_date, b.total_cents FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.id = ?', input.linkedId) : null
  const reading = bill ? null : (await readWith(c.db, c.env, readable(input))).reading
  const f: Fingerprint = { vendor: bill?.name ?? reading?.vendor ?? null, invoiceNumber: bill?.reference ?? reading?.invoiceNumber ?? null, date: bill?.bill_date ?? reading?.date ?? null, total: bill?.total_cents ?? reading?.total ?? null }
  const match = documentMatch([id], f)
  return [
    q('UPDATE pt_documents SET capture_vendor = ?, capture_invoice_number = ?, capture_date = ?, capture_total_cents = ?, requested_linked_kind = linked_kind, requested_linked_id = linked_id WHERE id = ?', f.vendor, f.invoiceNumber ?? null, f.date, f.total, id),
    q(`UPDATE pt_documents SET duplicate_of = (SELECT document_id FROM (${match.sql})), duplicate_basis = (SELECT basis FROM (${match.sql})) WHERE id = ?`, ...match.params, ...match.params, id),
    q('UPDATE pt_documents SET linked_kind = NULL, linked_id = NULL WHERE id = ? AND duplicate_of IS NOT NULL', id),
  ]
}

export async function documentDuplicates(db: D1Database) {
  const rows = await all(db, 'SELECT id, name, media_type, uploaded_at, duplicate_of, duplicate_basis FROM pt_documents WHERE duplicate_of IS NOT NULL AND duplicate_decision IS NULL ORDER BY uploaded_at DESC')
  for (const row of rows) row.duplicate = await duplicateDetails(db, row.duplicate_of)
  return rows
}

export const decideDocumentDuplicate: Command = { need: 'record', async run(c, b) {
  const doc = await one(c.db, 'SELECT * FROM pt_documents WHERE id = ?', text(b.id, 'Document'))
  requireThat(doc?.duplicate_of && !doc.duplicate_decision, 'Duplicate document not found or already decided', 409)
  const decision = text(b.decision, 'Decision')
  requireThat(decision === 'keep' || decision === 'skip', 'Choose Keep both or Skip')
  const reason = decision === 'keep' ? text(b.reason, 'Reason to keep both', 300) : optionalText(b.reason, 'Reason', 300)
  const f: Fingerprint = { vendor: doc.capture_vendor, invoiceNumber: doc.capture_invoice_number, date: doc.capture_date, total: doc.capture_total_cents }
  const match = documentMatch([doc.id], f)
  await run(c.db, [authority(c.actor, 'record'),
    guard(`(SELECT document_id FROM (${match.sql})) = ?`, ...match.params, doc.duplicate_of),
    q(`UPDATE pt_documents SET duplicate_decision = ?, duplicate_reason = ?, linked_kind = ?, linked_id = ? WHERE id = ? AND duplicate_decision IS NULL AND duplicate_of = ?`,
      decision, reason || null, decision === 'keep' ? doc.requested_linked_kind : null, decision === 'keep' ? doc.requested_linked_id : null, doc.id, doc.duplicate_of), changed(),
    audit(who(c.actor), `document.duplicate-${decision}`, 'document', doc.id, { duplicateDocumentId: doc.duplicate_of, basis: doc.duplicate_basis, reason })])
  return (await one(c.db, 'SELECT id, duplicate_of, duplicate_basis, duplicate_decision, duplicate_reason, linked_kind, linked_id FROM pt_documents WHERE id = ?', doc.id))!
} }
