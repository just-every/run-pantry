import { requireThat, type Data } from '../core'
import { all, one } from '../db'
import { billsView } from '../payables'
import { profiles } from './settings'

export async function batchView(db: D1Database, id: string) {
  const batch = await one(db, 'SELECT b.*, a.name AS bank_name, a.number_last4 FROM pt_check_batches b JOIN pt_bank_accounts a ON a.id = b.bank_account_id WHERE b.id = ?', id)
  requireThat(batch, 'Check batch not found', 404)
  batch.checks = await all(db, `SELECT c.*, p.payment_date, p.amount_cents, p.journal_id, p.reversal_id AS payment_reversal_id,
    (SELECT m.id FROM pt_matches m JOIN pt_match_postings mp ON mp.match_id = m.id JOIN pt_journal_lines l ON l.id = mp.journal_line_id WHERE l.entry_id = p.journal_id AND mp.active = 1 LIMIT 1) AS match_id
    FROM pt_checks c JOIN pt_payments p ON p.id = c.payment_id WHERE c.batch_id = ? ORDER BY c.number`, id)
  for (const check of batch.checks) check.allocations = await all(db, `SELECT b.id AS bill_id, b.reference, a.amount_cents FROM pt_allocations a JOIN pt_bills b ON b.id = a.target_id WHERE a.source_kind = 'payment' AND a.source_id = ? AND a.target_kind = 'bill' ORDER BY b.reference`, check.payment_id)
  batch.exports = await all(db, 'SELECT id, created_by, created_at, format FROM pt_check_exports WHERE batch_id = ? ORDER BY created_at DESC', id)
  batch.exports = batch.exports.map((e: Data) => ({ ...e, format: JSON.parse(e.format) }))
  return batch
}

export async function checksView(db: D1Database) {
  const batches = await all(db, 'SELECT id FROM pt_check_batches ORDER BY created_at DESC, rowid DESC LIMIT 100')
  return { profiles: await profiles(db), batches: await Promise.all(batches.map(b => batchView(db, b.id))), bills: (await billsView(db)).filter(b => b.status === 'posted' && b.open_cents > 0) }
}
