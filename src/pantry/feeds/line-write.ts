// The only promotion path from a provider observation into a bank line.
import { uid } from '../core'
import { q, type Sql } from '../db'
import { protectedLine, transactionDetails } from './transaction-exceptions'
import type { PlaidTransaction } from './plaid'

export function posted(t: PlaidTransaction, bankAccountId: string, feedAccountId: string, stamp: string): Sql[] {
  const details = transactionDetails(t), amount = details.amountCents, payee = details.payee
  return [
    ...(t.pending_transaction_id ? [q('DELETE FROM pt_feed_pending WHERE feed_txn_id = ?', t.pending_transaction_id)] : []),
    q('DELETE FROM pt_feed_pending WHERE feed_txn_id = ?', t.transaction_id),
    q(`UPDATE pt_bank_lines SET posted_date = ?, amount_cents = ?, description = ?, payee = ?, reference = ?, removed_at = NULL WHERE feed_txn_id = ? AND source = 'feed' AND statement_id IS NULL AND NOT ${protectedLine('pt_bank_lines')}`, t.date, amount, details.description, payee, details.reference, t.transaction_id),
    q(`INSERT INTO pt_bank_lines (id, statement_id, bank_account_id, posted_date, amount_cents, description, reference, fingerprint, source, payee, feed_txn_id, arrived_at)
      SELECT ?, NULL, ?, ?, ?, ?, ?, ?, 'feed', ?, ?, ? WHERE NOT EXISTS (SELECT 1 FROM pt_bank_lines WHERE feed_txn_id = ?)`,
      uid(), bankAccountId, t.date, amount, details.description, (t.check_number ?? '').slice(0, 60), `plaid:${t.transaction_id}`, payee, t.transaction_id, stamp, t.transaction_id),
    q('UPDATE pt_bank_lines SET feed_snapshot = ?, feed_account_id = COALESCE(feed_account_id, ?) WHERE feed_txn_id = ?', JSON.stringify(details), feedAccountId, t.transaction_id),
  ]
}

