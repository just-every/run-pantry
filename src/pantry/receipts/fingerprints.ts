// All document intake uses the same comparison, including legacy attachments.
import { q, type Sql } from '../db'

export const vendorKey = (value: string | null | undefined) => (value ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')
export type Fingerprint = { vendor: string | null; invoiceNumber?: string | null; date: string | null; total: number | null }

/** Current document ids are database ids; placeholders carry every input. */
export function documentMatch(documentIds: string[], f: Fingerprint, receiptId: string | null = null): Sql {
  const ids = receiptId ? "(SELECT document_id FROM pt_receipts WHERE id = ?), COALESCE((SELECT file_document_id FROM pt_receipts WHERE id = ?), '')" : documentIds.map(() => '?').join(', ')
  const documentParams = receiptId ? [receiptId, receiptId] : documentIds
  const sameFile = `EXISTS (SELECT 1 FROM pt_documents current WHERE current.id IN (${ids}) AND current.sha256 = other.sha256)`
  const sameInvoice = `(? <> '' AND other.vendor_key = ? AND ? <> '' AND other.invoice_key = ?)`
  return q(`SELECT other.receipt_id, other.document_id,
      CASE WHEN ${sameFile} THEN 'file' WHEN ${sameInvoice} THEN 'vendor-invoice' ELSE 'vendor-date-total' END AS basis
    FROM pt_capture_facts other
    WHERE other.document_id NOT IN (${ids}) AND (? IS NULL OR COALESCE(other.receipt_id, '') <> ?)
      AND (other.document_order < (SELECT MIN(rowid) FROM pt_documents WHERE id IN (${ids})) OR other.status = 'attached')
      AND (${sameFile} OR ${sameInvoice}
        OR (? <> '' AND other.vendor_key = ? AND other.receipt_date = ? AND other.total_cents = ?))
    ORDER BY other.document_order LIMIT 1`,
    ...documentParams, vendorKey(f.vendor), vendorKey(f.vendor), vendorKey(f.invoiceNumber), vendorKey(f.invoiceNumber),
    ...documentParams, receiptId, receiptId, ...documentParams,
    ...documentParams, vendorKey(f.vendor), vendorKey(f.vendor), vendorKey(f.invoiceNumber), vendorKey(f.invoiceNumber),
    vendorKey(f.vendor), vendorKey(f.vendor), f.date, f.total)
}
