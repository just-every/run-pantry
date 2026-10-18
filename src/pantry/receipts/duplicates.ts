// Compare the captured original and any email attachment/reading copy. Receipt
// facts use the exact receipt date (and therefore its own accounting period).
import type { Data } from '../core'
import { guard, one, q, run, type Sql } from '../db'

export const vendorKey = (value: string | null) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
export type Fingerprint = { vendor: string | null; date: string | null; total: number | null }

// A later attached receipt also counts: an older unread capture must not get
// around the guard merely because someone filed a later copy first.
function match(id: string, f: Fingerprint): Sql {
  return q(`SELECT other.id, CASE WHEN EXISTS (
      SELECT 1 FROM pt_documents a JOIN pt_documents b ON b.sha256 = a.sha256
      WHERE a.id IN (current.document_id, current.file_document_id)
        AND b.id IN (other.document_id, other.file_document_id)
    ) THEN 'file' ELSE 'vendor-date-total' END AS basis
    FROM pt_receipts current JOIN pt_receipts other ON other.id <> current.id
    WHERE current.id = ? AND other.status <> 'dismissed'
      AND (other.rowid < current.rowid OR other.status = 'attached')
      AND (EXISTS (SELECT 1 FROM pt_documents a JOIN pt_documents b ON b.sha256 = a.sha256
        WHERE a.id IN (current.document_id, current.file_document_id) AND b.id IN (other.document_id, other.file_document_id))
        OR (? <> '' AND other.vendor_key = ? AND COALESCE(other.receipt_date, other.read_date) = ?
          AND COALESCE(other.total_cents, other.read_total_cents) = ?))
    ORDER BY other.rowid LIMIT 1`, id, vendorKey(f.vendor), vendorKey(f.vendor), f.date, f.total)
}

export const readFingerprint = (r: Data): Fingerprint => ({ vendor: r.vendor ?? r.read_vendor, date: r.receipt_date ?? r.read_date, total: r.total_cents ?? r.read_total_cents })

export async function duplicateOf(db: D1Database, id: string, f: Fingerprint) {
  const query = match(id, f)
  return one<{ id: string; basis: string }>(db, query.sql, ...query.params)
}

/** Persist the warning and its first capture link, even when acceptance stops. */
export async function flagDuplicate(db: D1Database, r: Data, f = readFingerprint(r)) {
  const found = await duplicateOf(db, r.id, f)
  await run(db, [q("UPDATE pt_receipts SET duplicate_of = ?, duplicate_basis = ? WHERE id = ? AND status = 'review'", found?.id ?? null, found?.basis ?? null, r.id)])
  return found
}

/** Recheck in the same atomic batch that attaches/posts, closing capture races. */
export function noDuplicate(id: string, f: Fingerprint) {
  const query = match(id, f)
  return guard(`NOT EXISTS (${query.sql})`, ...query.params)
}

export async function duplicateDetails(db: D1Database, id: string | null) {
  if (!id) return null
  return one(db, `SELECT r.id, r.document_id, r.file_document_id, r.status, r.received_at, r.decided_at,
      r.target_kind, r.target_id, r.linked_kind, r.linked_id,
      COALESCE(r.vendor, r.read_vendor) AS saved_vendor, COALESCE(r.receipt_date, r.read_date) AS receipt_date,
      COALESCE(r.total_cents, r.read_total_cents) AS total_cents, COALESCE(r.tax_cents, r.read_tax_cents) AS tax_cents,
      COALESCE(r.currency, r.read_currency) AS currency, COALESCE(r.account_id, r.read_account_id) AS account_id, COALESCE(r.vendor, r.read_vendor, d.name) AS vendor, d.name AS file_name, d.media_type
    FROM pt_receipts r JOIN pt_documents d ON d.id = r.document_id WHERE r.id = ?`, id)
}
