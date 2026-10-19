// Existing payments are offered before adding another expense or receipt.
import type { Data } from './core'
import { all } from './db'

const plain = (value: string) => value.toUpperCase().replace(/[^A-Z0-9]+/g, '')

export async function recordedPaymentCandidates(db: D1Database, lines: Data[]) {
  const offers: Record<string, Data[]> = {}
  const open = lines.filter(l => !l.match_id && !l.removed_at)
  const byId = new Map(open.map(l => [l.id, l]))
  for (let i = 0; i < open.length; i += 90) {
    const chunk = open.slice(i, i + 90)
    const candidates = await all(db, `SELECT x.id AS lineId, x.amount_cents AS amount, p.id AS paymentId,
        p.direction, p.payment_date, p.reference, p.method, p.card_last4,
        c.name AS vendor, c.bank_reference, l.id AS journalLineId
      FROM pt_bank_lines x JOIN pt_payments p ON p.bank_account_id = x.bank_account_id
      JOIN pt_contacts c ON c.id = p.contact_id JOIN pt_bank_accounts b ON b.id = p.bank_account_id
      JOIN pt_journal_lines l ON l.entry_id = p.journal_id AND l.account_id = b.account_id
      JOIN pt_journal_entries e ON e.id = l.entry_id
      WHERE x.id IN (${chunk.map(() => '?').join(',')}) AND x.removed_at IS NULL
        AND p.reversal_id IS NULL AND e.status = 'posted' AND e.reversed_by_id IS NULL
        AND l.debit_cents - l.credit_cents = x.amount_cents
        AND p.payment_date BETWEEN date(x.posted_date, '-7 days') AND date(x.posted_date, '+7 days')
        AND NOT EXISTS (SELECT 1 FROM pt_match_postings mp WHERE mp.journal_line_id = l.id AND mp.active = 1)
        AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines mb WHERE mb.bank_line_id = x.id AND mb.active = 1)
      ORDER BY p.payment_date, p.id`, ...chunk.map(l => l.id))
    for (const p of candidates) {
      const line = byId.get(p.lineId)!, words = plain(`${line.description} ${line.reference ?? ''}`)
      const named = [p.vendor, p.bank_reference, p.reference].some(t => plain(t ?? '').length >= 3 && words.includes(plain(t)))
      ;(offers[line.id] ??= []).push({ ...p, named })
    }
  }
  for (const list of Object.values(offers)) list.sort((a, b) => Number(b.named) - Number(a.named))
  return offers
}
