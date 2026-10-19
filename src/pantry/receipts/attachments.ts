// Which documents belong to which ledger entry. A document attaches to a bill,
// invoice, payment or journal entry; an entry keeps every document of the
// record it came from, and a bill payment keeps the bill's.
import { type Data } from '../core'
import { all } from '../db'

// D1 limits compound SELECTs, so each path is its own query or EXISTS term.
const PATHS = [
  "SELECT e.id AS entry_id, e.document_id FROM pt_journal_entries e WHERE e.document_id IS NOT NULL",
  "SELECT d.linked_id AS entry_id, d.id AS document_id FROM pt_documents d WHERE d.linked_kind = 'journal'",
  "SELECT p.journal_id AS entry_id, d.id AS document_id FROM pt_payments p JOIN pt_documents d ON d.linked_kind = 'payment' AND d.linked_id = p.id",
  "SELECT b.journal_id AS entry_id, d.id AS document_id FROM pt_bills b JOIN pt_documents d ON d.linked_kind = 'bill' AND d.linked_id = b.id WHERE b.journal_id IS NOT NULL",
  "SELECT i.journal_id AS entry_id, d.id AS document_id FROM pt_invoices i JOIN pt_documents d ON d.linked_kind = 'invoice' AND d.linked_id = i.id WHERE i.journal_id IS NOT NULL",
  "SELECT p.journal_id AS entry_id, d.id AS document_id FROM pt_payments p JOIN pt_allocations a ON a.source_kind = 'payment' AND a.source_id = p.id AND a.target_kind = 'bill' JOIN pt_documents d ON d.linked_kind = 'bill' AND d.linked_id = a.target_id",
]

/** SQL condition: the entry `alias` keeps at least one document. */
export const hasDocument = (alias: string) => '(' + PATHS.map(p => `EXISTS (SELECT 1 FROM (${p}) x WHERE x.entry_id = ${alias}.id)`).join(' OR ') + ')'

/** The documents of each entry, by entry id. */
export async function entryDocuments(db: D1Database) {
  const out: Record<string, Data[]> = {}, seen = new Set<string>()
  for (const path of PATHS) {
    const rows = await all<{ entry_id: string; id: string; name: string; media_type: string; sha256: string }>(db, `SELECT x.entry_id, d.id, d.name, d.media_type, d.sha256 FROM (${path}) x JOIN pt_documents d ON d.id = x.document_id ORDER BY d.uploaded_at, d.id`)
    for (const r of rows) if (!seen.has(r.entry_id + r.id)) { seen.add(r.entry_id + r.id); (out[r.entry_id] ??= []).push({ id: r.id, name: r.name, media_type: r.media_type, sha256: r.sha256 }) }
  }
  return out
}

/**
 * Spending in the period that keeps no receipt: posted entries that take money
 * out of a bank or card account, other than transfers between them and bills'
 * payments (the bill holds the receipt; the bill check covers it), with no
 * document and no recorded reason.
 */
export async function missingReceipts(db: D1Database, start: string, end: string) {
  return all(db, `SELECT e.id, e.number, e.entry_date, e.memo, e.source_kind, SUM(l.credit_cents) AS amount_cents
    FROM pt_journal_entries e JOIN pt_journal_lines l ON l.entry_id = e.id JOIN pt_accounts a ON a.id = l.account_id AND a.subtype = 'bank'
    WHERE e.status = 'posted' AND e.reversed_by_id IS NULL AND e.reverses_id IS NULL AND e.entry_date BETWEEN ? AND ? AND l.credit_cents > 0
      AND EXISTS (SELECT 1 FROM pt_journal_lines o JOIN pt_accounts oa ON oa.id = o.account_id WHERE o.entry_id = e.id AND oa.subtype <> 'bank')
      AND NOT EXISTS (SELECT 1 FROM pt_payments p JOIN pt_allocations x ON x.source_kind = 'payment' AND x.source_id = p.id AND x.target_kind = 'bill' WHERE p.journal_id = e.id)
      AND NOT ${hasDocument('e')}
      AND NOT EXISTS (SELECT 1 FROM pt_receipt_waivers w WHERE w.entry_id = e.id)
    GROUP BY e.id ORDER BY e.entry_date, e.number`, start, end)
}

const STOP = new Set(['the', 'inc', 'llc', 'co', 'corp', 'company', 'ltd', 'store', 'shop', 'pos', 'debit', 'purchase', 'card', 'payment', 'online', 'www', 'com'])
const words = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').split(/\s+/).filter(w => w.length > 1 && !STOP.has(w) && !/^\d+$/.test(w))

/** 0..1: how well a bank description or record name names the vendor. */
export function vendorLikeness(vendor: string | null, text: string) {
  if (!vendor) return 0
  const v = words(vendor), t = words(text), compact = t.join('')
  if (!v.length) return 0
  if (compact.includes(v.join(''))) return 1
  return v.filter(w => t.includes(w) || (w.length >= 4 && compact.includes(w))).length / v.length
}

export { candidates, type Candidate } from './matches'
