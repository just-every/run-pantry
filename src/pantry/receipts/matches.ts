// Receipt candidates share one bounded date/amount/identity calculation across
// capture, typed corrections, delayed arrivals and owner-approved receipt rules.
import { addDays } from '../core'
import { all } from '../db'
import { hasDocument, vendorLikeness } from './attachments'

export type MatchFacts = { tip?: number | null; chargedUsd?: number | null; cardLast4?: string | null }
export type Candidate = { kind: 'bankline' | 'bill' | 'payment' | 'journal'; id: string; date: string; amount_cents: number; label: string; detail: string; entry_id: string | null; record: boolean; score: number }

export function matchFacts(r: Record<string, any>): MatchFacts {
  return r.read_match_fields ? JSON.parse(r.read_match_fields) : {}
}

export async function candidates(db: D1Database, total: number | null, day: string | null, vendor: string | null, currency: string | null = 'USD', facts: MatchFacts = {}): Promise<Candidate[]> {
  if (!total || !day || (!vendor && !facts.cardLast4)) return []
  const foreign = !!currency && currency !== 'USD'
  // Never infer an exchange rate. A printed or person-entered USD charge is
  // required; one percent covers conversion fees/rounding, rounded down.
  const expected = foreign ? facts.chargedUsd : total
  if (!expected) return []
  const tolerance = foreign ? Math.floor(expected / 100) : facts.tip ?? 0
  const from = addDays(day, -5), to = addDays(day, 5)
  const out: Candidate[] = []
  const lines = await all(db, `SELECT l.id, l.posted_date, l.amount_cents, l.description, b.name AS bank, b.number_last4,
      (SELECT jl.entry_id FROM pt_match_bank_lines mb JOIN pt_match_postings mp ON mp.match_id = mb.match_id AND mp.active = 1 JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE mb.bank_line_id = l.id AND mb.active = 1 LIMIT 1) AS entry_id
    FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id
    WHERE l.amount_cents < 0 AND -l.amount_cents BETWEEN ? AND ? AND l.posted_date BETWEEN ? AND ? AND l.removed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM pt_receipts r WHERE r.status = 'attached' AND r.target_kind = 'bankline' AND r.target_id = l.id)
    ORDER BY l.posted_date, l.id`, Math.max(1, expected - tolerance), expected + tolerance, from, to)
  for (const l of lines) {
    const vendorFits = vendorLikeness(vendor, l.description) >= 0.67
    const cardFits = !!facts.cardLast4 && facts.cardLast4 === l.number_last4
    if (!vendorFits && !cardFits) continue
    out.push({ kind: 'bankline', id: l.id, date: l.posted_date, amount_cents: -l.amount_cents, label: l.description,
      detail: `${l.bank} · ${l.entry_id ? 'matched in the books' : 'not in the books yet'} · ${cardFits ? 'card last four match' : 'vendor match'}${foreign ? ' · USD charge within 1%' : tolerance ? ' · within printed tip' : ' · exact amount'}`,
      entry_id: l.entry_id, record: !l.entry_id, score: 0 })
  }
  if (!foreign) {
    const bills = await all(db, `SELECT b.id, b.bill_date, b.total_cents, b.reference, b.journal_id, c.name AS vendor FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
      WHERE b.status <> 'void' AND b.total_cents = ? AND b.bill_date BETWEEN ? AND ? AND NOT EXISTS (SELECT 1 FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id)`, total, from, to)
    for (const b of bills) if (vendorLikeness(vendor, b.vendor) >= 0.67) out.push({ kind: 'bill', id: b.id, date: b.bill_date, amount_cents: b.total_cents, label: `${b.vendor} — bill ${b.reference}`, detail: 'Bill', entry_id: b.journal_id, record: false, score: 0 })
    const payments = await all(db, `SELECT p.id, p.payment_date, p.amount_cents, p.journal_id, c.name AS vendor FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id JOIN pt_journal_entries j ON j.id = p.journal_id
      WHERE p.direction = 'paid' AND p.reversal_id IS NULL AND p.amount_cents = ? AND p.payment_date BETWEEN ? AND ? AND NOT ${hasDocument('j')}`, total, from, to)
    for (const p of payments) if (vendorLikeness(vendor, p.vendor) >= 0.67) out.push({ kind: 'payment', id: p.id, date: p.payment_date, amount_cents: p.amount_cents, label: `Payment to ${p.vendor}`, detail: 'Payment', entry_id: p.journal_id, record: false, score: 0 })
    const entries = await all(db, `SELECT e.id, e.entry_date, e.memo FROM pt_journal_entries e
      WHERE e.status = 'posted' AND e.reversed_by_id IS NULL AND e.source_kind IN ('manual', 'bank') AND e.entry_date BETWEEN ? AND ? AND NOT ${hasDocument('e')}
        AND EXISTS (SELECT 1 FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id WHERE l.entry_id = e.id AND a.subtype = 'bank' AND l.credit_cents = ?)`, from, to, total)
    for (const e of entries) if (vendorLikeness(vendor, e.memo) >= 0.67) out.push({ kind: 'journal', id: e.id, date: e.entry_date, amount_cents: total, label: e.memo, detail: 'Journal entry', entry_id: e.id, record: false, score: 0 })
  }
  const seen = new Set<string>()
  return out.filter(c => !c.entry_id || (seen.has(c.entry_id) ? false : (seen.add(c.entry_id), true))).map(c => ({ ...c,
    score: Math.round(50 + 20 - 2 * Math.abs(Date.parse(c.date) - Date.parse(day)) / 86400000 + 30 * vendorLikeness(vendor, c.label)) })).sort((a, b) => b.score - a.score)
}
