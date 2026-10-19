import type { Data } from '../core'
import { guard, one, q, run, type Sql } from '../db'
import { documentMatch, type Fingerprint } from './fingerprints'
export { vendorKey, type Fingerprint } from './fingerprints'

// A later filed copy also counts: an older unread capture cannot bypass review.
function match(id: string, f: Fingerprint): Sql {
  return documentMatch([], f, id)
}

export const readFingerprint = (r: Data): Fingerprint => ({ vendor: r.vendor ?? r.read_vendor, invoiceNumber: r.invoice_number ?? r.read_invoice_number, date: r.receipt_date ?? r.read_date, total: r.total_cents ?? r.read_total_cents })
export type Duplicate = { id: string; receipt_id: string | null; document_id: string; basis: string }

export async function duplicateOf(db: D1Database, id: string, f: Fingerprint): Promise<Duplicate | null> {
  const query = match(id, f)
  const found = await one<Omit<Duplicate, 'id'>>(db, query.sql, ...query.params)
  return found ? { ...found, id: found.receipt_id ?? found.document_id } : null
}

export async function flagDuplicate(db: D1Database, r: Data, f = readFingerprint(r)) {
  const found = await duplicateOf(db, r.id, f)
  await run(db, [q("UPDATE pt_receipts SET duplicate_of = ?, duplicate_document_id = ?, duplicate_basis = ? WHERE id = ? AND status = 'review'", found?.receipt_id ?? null, found?.document_id ?? null, found?.basis ?? null, r.id)])
  return found
}

/** A keep decision is valid only for the original the person actually saw. */
export function noDuplicate(id: string, f: Fingerprint, approved?: Duplicate | null) {
  const query = match(id, f)
  return approved ? guard(`(SELECT document_id FROM (${query.sql})) = ?`, ...query.params, approved.document_id) : guard(`NOT EXISTS (${query.sql})`, ...query.params)
}

export async function duplicateDetails(db: D1Database, id: string | null) {
  if (!id) return null
  return one(db, `SELECT COALESCE(r.id, d.id) AS id, COALESCE(r.document_id, d.id) AS document_id, r.file_document_id,
      COALESCE(r.status, CASE WHEN d.linked_kind IS NOT NULL THEN 'attached' ELSE 'review' END) AS status,
      COALESCE(r.received_at, d.uploaded_at) AS received_at, r.decided_at,
      COALESCE(r.target_kind, d.linked_kind) AS target_kind, COALESCE(r.target_id, d.linked_id) AS target_id,
      COALESCE(r.linked_kind, d.linked_kind) AS linked_kind, COALESCE(r.linked_id, d.linked_id) AS linked_id,
      COALESCE(r.vendor, r.read_vendor, d.capture_vendor, c.name) AS saved_vendor,
      COALESCE(r.invoice_number, r.read_invoice_number, d.capture_invoice_number, b.reference) AS invoice_number,
      COALESCE(r.receipt_date, r.read_date, d.capture_date, b.bill_date) AS receipt_date,
      COALESCE(r.total_cents, r.read_total_cents, d.capture_total_cents, b.total_cents) AS total_cents,
      COALESCE(r.tax_cents, r.read_tax_cents) AS tax_cents, COALESCE(r.currency, r.read_currency) AS currency,
      COALESCE(r.account_id, r.read_account_id) AS account_id,
      COALESCE(r.vendor, r.read_vendor, d.capture_vendor, c.name, d.name) AS vendor, d.name AS file_name, d.media_type
    FROM pt_documents d LEFT JOIN pt_receipts r ON r.document_id = d.id OR r.file_document_id = d.id
      LEFT JOIN pt_bills b ON d.linked_kind = 'bill' AND d.linked_id = b.id LEFT JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE d.id = ? OR r.id = ? ORDER BY d.rowid LIMIT 1`, id, id)
}
