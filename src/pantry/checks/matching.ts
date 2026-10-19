import type { Data } from '../core'
import { all } from '../db'

/** A check may clear months later. Its exact number and amount identify it;
 * payee text or an amount alone never identify a numbered check. */
export function namesCheck(line: Data, number: number) {
  const reference = String(line.reference ?? '').trim()
  if (/^\d+$/.test(reference) && Number(reference) === number) return true
  const words = `${line.description ?? ''} ${reference}`
  const matches = [...words.matchAll(/\b(?:CHECK|CHK|CHEQUE)\s*(?:NO\.?\s*)?[#:-]?\s*0*(\d+)\b/gi)]
  return matches.some(m => Number(m[1]) === number)
}

export async function checkPaymentCandidates(db: D1Database, lines: Data[]) {
  const offers: Record<string, Data[]> = {}
  for (const line of lines.filter(l => !l.match_id && !l.removed_at && l.amount_cents < 0)) {
    const candidates = await all(db, `SELECT ch.id AS checkId, ch.number AS checkNumber, p.id AS paymentId,
      p.direction, p.payment_date, p.reference, p.method, p.card_last4, ch.payee AS vendor, l.id AS journalLineId
      FROM pt_checks ch JOIN pt_payments p ON p.id = ch.payment_id JOIN pt_bank_accounts b ON b.id = p.bank_account_id
      JOIN pt_journal_lines l ON l.entry_id = p.journal_id AND l.account_id = b.account_id
      JOIN pt_journal_entries e ON e.id = p.journal_id
      WHERE ch.bank_account_id = ? AND ch.status = 'issued' AND p.reversal_id IS NULL
        AND p.amount_cents = ? AND p.payment_date <= ? AND e.status = 'posted' AND e.reversed_by_id IS NULL
        AND NOT EXISTS (SELECT 1 FROM pt_match_postings mp WHERE mp.journal_line_id = l.id AND mp.active = 1)
        AND NOT EXISTS (SELECT 1 FROM pt_match_bank_lines mb WHERE mb.bank_line_id = ? AND mb.active = 1)`, line.bank_account_id, -line.amount_cents, line.posted_date, line.id)
    offers[line.id] = candidates.filter(p => namesCheck(line, p.checkNumber)).map(p => ({ ...p, lineId: line.id, amount: line.amount_cents, named: true }))
  }
  return offers
}
