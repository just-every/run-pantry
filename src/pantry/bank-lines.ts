// Bank lines across accounts, newest first, as the Transactions screen shows
// them: how each was filed (by a person, by a rule, or not yet), where it came
// from (file or feed), and the feed's pending transactions beside them.
import type { Data } from './core'
import { all } from './db'
import { recordedPaymentCandidates } from './recorded-payments'
import { depositProposals } from './automatch'
import { transferState } from './transfers'

export async function bankLinesView(db: D1Database): Promise<Data> {
  const lines = await all(db, `SELECT l.id, l.bank_account_id, l.posted_date, l.amount_cents, l.description, l.payee, l.source, l.statement_id, l.feed_txn_id, l.removed_at, l.rules_off,
      b.name AS bank_name, m.id AS match_id, m.rule_id, m.reconciliation_id, m.approved_by, m.automatic, m.payment_id, r.name AS rule_name
    FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id
    LEFT JOIN pt_match_bank_lines mb ON mb.bank_line_id = l.id AND mb.active = 1 LEFT JOIN pt_matches m ON m.id = mb.match_id LEFT JOIN pt_bank_rules r ON r.id = m.rule_id
    WHERE l.removed_at IS NULL OR mb.match_id IS NOT NULL
    ORDER BY l.posted_date DESC, l.id LIMIT 300`)
  const matches = [...new Set(lines.map(l => l.match_id).filter(Boolean))] as string[]
  const filedTo = new Map<string, string[]>()
  for (let i = 0; i < matches.length; i += 90) {
    const chunk = matches.slice(i, i + 90)
    const rows = await all(db, `SELECT DISTINCT mp.match_id, a.name FROM pt_match_postings mp JOIN pt_journal_lines bl ON bl.id = mp.journal_line_id
      JOIN pt_journal_lines jl ON jl.entry_id = bl.entry_id AND jl.id <> bl.id JOIN pt_accounts a ON a.id = jl.account_id
      WHERE mp.active = 1 AND mp.match_id IN (${chunk.map(() => '?').join(',')}) ORDER BY a.name`, ...chunk)
    for (const r of rows) filedTo.set(r.match_id, [...(filedTo.get(r.match_id) ?? []), r.name])
  }
  const pending = await all(db, `SELECT p.feed_txn_id AS id, p.txn_date AS posted_date, p.amount_cents, p.description, p.payee, f.bank_account_id, b.name AS bank_name
    FROM pt_feed_pending p JOIN pt_feed_accounts f ON f.id = p.feed_account_id JOIN pt_bank_accounts b ON b.id = f.bank_account_id ORDER BY p.txn_date DESC, p.feed_txn_id`)
  const transfers = new Map((await transferState(db)).map(t => [t.bank_line_id, t]))
  return { recordedPayments: await recordedPaymentCandidates(db, lines), depositProposals: await depositProposals(db, lines), lines: lines.map(l => ({ ...l, transfer: transfers.get(l.id) ?? null, filed_to: l.match_id ? filedTo.get(l.match_id) ?? [] : [] })), pending }
}
