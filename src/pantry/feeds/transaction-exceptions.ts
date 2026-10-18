// Provider changes are observations, never permission to rewrite a filed line.
// Keep both sides of the discrepancy so a person can correct the books explicitly.
import { uid } from '../core'
import { all, q, type Sql } from '../db'
import type { PlaidTransaction } from './plaid'

const reconciled = (line: string) => `EXISTS (SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id
  WHERE r.bank_account_id = ${line}.bank_account_id AND ${line}.posted_date BETWEEN s.start_date AND s.end_date)`
const matched = (line: string) => `EXISTS (SELECT 1 FROM pt_match_bank_lines mb WHERE mb.bank_line_id = ${line}.id AND mb.active = 1)`
export const protectedLine = (line: string) => `(${matched(line)} OR ${reconciled(line)})`

export const transactionDetails = (t: PlaidTransaction) => ({
  date: t.date, amountCents: -Math.round(t.amount * 100),
  description: (t.name || t.merchant_name || '(no description)').slice(0, 300),
  payee: (t.merchant_name ?? '').slice(0, 120), reference: (t.check_number ?? '').slice(0, 60), pending: t.pending,
})

/** Insert before changing the observed snapshot, in the same batch as the line write. */
export function transactionException(feedAccountId: string | null, transactionId: string, kind: 'modified' | 'removed', change: string, stamp: string, reportedModified = true): Sql {
  return q(`INSERT INTO pt_feed_transaction_exceptions
    (id, feed_account_id, bank_line_id, feed_txn_id, kind, protection, preserved_line, provider_change, detected_at)
    SELECT ?, COALESCE(?, l.feed_account_id), l.id, l.feed_txn_id, ?,
      CASE WHEN ${reconciled('l')} THEN 'reconciled'
        WHEN EXISTS (SELECT 1 FROM pt_match_bank_lines mb JOIN pt_matches m ON m.id = mb.match_id WHERE mb.bank_line_id = l.id AND mb.active = 1 AND m.rule_id IS NOT NULL) THEN 'categorised'
        ELSE 'matched' END,
      json_object('date', l.posted_date, 'amountCents', l.amount_cents, 'description', l.description, 'payee', l.payee, 'reference', l.reference), ?, ?
    FROM pt_bank_lines l WHERE l.feed_txn_id = ? AND ${protectedLine('l')} AND l.feed_snapshot IS NOT ?
      AND (l.feed_snapshot IS NOT NULL OR ? = 1)
    ON CONFLICT (bank_line_id, kind, provider_change) DO NOTHING`,
  uid(), feedAccountId, kind, change, stamp, transactionId, change, reportedModified ? 1 : 0)
}

export async function transactionExceptions(db: D1Database) {
  const rows = await all(db, `SELECT e.*, f.item_id, b.name AS bank_name, i.institution_name
    FROM pt_feed_transaction_exceptions e JOIN pt_feed_accounts f ON f.id = e.feed_account_id
    JOIN pt_feed_items i ON i.id = f.item_id JOIN pt_bank_lines l ON l.id = e.bank_line_id
    JOIN pt_bank_accounts b ON b.id = l.bank_account_id ORDER BY e.detected_at DESC, e.id`)
  return rows.map(e => ({ ...e, name: `Bank ${e.kind} a ${e.protection} line`,
    preservedLine: JSON.parse(e.preserved_line), providerChange: JSON.parse(e.provider_change),
  }))
}
