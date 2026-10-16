// Which documents belong to which ledger entry. A document attaches to a bill,
// invoice, payment or journal entry; an entry keeps every document of the
// record it came from, and a bill payment keeps the bill's.
import { addDays, type Data } from '../core'
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

export type Candidate = { kind: 'bankline' | 'bill' | 'payment' | 'journal'; id: string; date: string; amount_cents: number; label: string; detail: string; entry_id: string | null; record: boolean; score: number }

/** Transactions a receipt of this total, date and vendor may belong to, best first. */
export async function candidates(db: D1Database, total: number | null, day: string | null, vendor: string | null, currency: string | null = 'USD'): Promise<Candidate[]> {
  if (!total) return []
  // A receipt in another currency was charged in dollars: its card line is found by date and vendor instead.
  if (currency && currency !== 'USD') {
    if (!day || !vendor) return []
    const lines = await all(db, `SELECT l.id, l.posted_date, l.amount_cents, l.description, b.name AS bank,
        (SELECT jl.entry_id FROM pt_match_bank_lines mb JOIN pt_match_postings mp ON mp.match_id = mb.match_id AND mp.active = 1 JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE mb.bank_line_id = l.id AND mb.active = 1 LIMIT 1) AS entry_id
      FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id
      WHERE l.amount_cents < 0 AND l.posted_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM pt_receipts r WHERE r.status = 'attached' AND r.target_kind = 'bankline' AND r.target_id = l.id) ORDER BY l.posted_date LIMIT 200`, addDays(day, -3), addDays(day, 10))
    return lines.map(l => ({ kind: 'bankline' as const, id: l.id, date: l.posted_date, amount_cents: -l.amount_cents, label: l.description, detail: `${l.bank} · charged in dollars · ${l.entry_id ? 'matched in the books' : 'not in the books yet'}`, entry_id: l.entry_id, record: !l.entry_id, score: Math.round(30 * vendorLikeness(vendor, l.description) + 20 - Math.abs(Date.parse(l.posted_date) - Date.parse(day)) / 86400000) }))
      .filter(c => vendorLikeness(vendor, c.label) >= 0.67).sort((a, b) => b.score - a.score)
  }
  const from = day ? addDays(day, -10) : '0000-01-01', to = day ? addDays(day, 10) : '9999-12-31', lineFrom = day ? addDays(day, -3) : from
  const out: Candidate[] = []
  const lines = await all(db, `SELECT l.id, l.posted_date, l.amount_cents, l.description, b.name AS bank,
      (SELECT jl.entry_id FROM pt_match_bank_lines mb JOIN pt_match_postings mp ON mp.match_id = mb.match_id AND mp.active = 1 JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE mb.bank_line_id = l.id AND mb.active = 1 LIMIT 1) AS entry_id
    FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id
    WHERE l.amount_cents = ? AND l.posted_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM pt_receipts r WHERE r.status = 'attached' AND r.target_kind = 'bankline' AND r.target_id = l.id)
    ORDER BY l.posted_date LIMIT 20`, -total, lineFrom, to)
  for (const l of lines) out.push({ kind: 'bankline', id: l.id, date: l.posted_date, amount_cents: -l.amount_cents, label: l.description, detail: l.entry_id ? `${l.bank} · matched in the books` : `${l.bank} · not in the books yet`, entry_id: l.entry_id, record: !l.entry_id, score: 0 })
  const bills = await all(db, `SELECT b.id, b.bill_date, b.total_cents, b.reference, b.journal_id, c.name AS vendor FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE b.status <> 'void' AND b.total_cents = ? AND b.bill_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id) LIMIT 20`, total, from, to)
  for (const b of bills) out.push({ kind: 'bill', id: b.id, date: b.bill_date, amount_cents: b.total_cents, label: `${b.vendor} — bill ${b.reference}`, detail: 'Bill', entry_id: b.journal_id, record: false, score: 0 })
  const payments = await all(db, `SELECT p.id, p.payment_date, p.amount_cents, p.journal_id, c.name AS vendor FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id JOIN pt_journal_entries j ON j.id = p.journal_id
    WHERE p.direction = 'paid' AND p.reversal_id IS NULL AND p.amount_cents = ? AND p.payment_date BETWEEN ? AND ? AND NOT ${hasDocument('j')} LIMIT 20`, total, lineFrom, to)
  for (const p of payments) out.push({ kind: 'payment', id: p.id, date: p.payment_date, amount_cents: p.amount_cents, label: `Payment to ${p.vendor}`, detail: 'Payment', entry_id: p.journal_id, record: false, score: 0 })
  const entries = await all(db, `SELECT e.id, e.entry_date, e.memo FROM pt_journal_entries e
    WHERE e.status = 'posted' AND e.reversed_by_id IS NULL AND e.source_kind IN ('manual', 'bank') AND e.entry_date BETWEEN ? AND ? AND NOT ${hasDocument('e')}
      AND EXISTS (SELECT 1 FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND a.subtype = 'bank' AND l.credit_cents = ?) LIMIT 20`, lineFrom, to, total)
  for (const e of entries) out.push({ kind: 'journal', id: e.id, date: e.entry_date, amount_cents: total, label: e.memo, detail: 'Journal entry', entry_id: e.id, record: false, score: 0 })
  // One entry is offered once: through its bank line when it has one.
  const seen = new Set<string>()
  const unique = out.filter(c => !c.entry_id || (seen.has(c.entry_id) ? false : (seen.add(c.entry_id), true)))
  for (const c of unique) {
    const days = day ? Math.abs(Date.parse(c.date) - Date.parse(day)) / 86400000 : 5
    c.score = Math.round(50 + Math.max(0, 20 - 2 * days) + 30 * vendorLikeness(vendor, c.label))
  }
  return unique.sort((a, b) => b.score - a.score)
}
