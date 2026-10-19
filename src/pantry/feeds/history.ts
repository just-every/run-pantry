// Historical observations stay apart from bank lines until their identity and
// posting eligibility are known. In particular a held row cannot reach rules,
// invoice matching, transfers or manual match approval.
import { authority, who } from '../access'
import { addDays, date, now, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, periodOpen, q, run, type Sql } from '../db'
import type { Command } from '../context'
import { posted } from './line-write'
import { protectedLine, transactionDetails, transactionException } from './transaction-exceptions'
import type { PlaidTransaction } from './plaid'

export async function historyOptions(db: D1Database, bankAccountId: string) {
  const bank = await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', bankAccountId)
  requireThat(bank, 'Bank account not found', 404)
  const entity = await one(db, 'SELECT books_start FROM pt_entity WHERE id = 1')
  const last = await one(db, `SELECT MAX(day) AS day FROM (
    SELECT end_date AS day FROM pt_reconciliations WHERE bank_account_id = ?
    UNION ALL SELECT c.cutover_date AS day FROM pt_cutovers c
      JOIN pt_journal_lines l ON l.entry_id = c.opening_entry_id
      WHERE c.status = 'accepted' AND l.account_id = ? AND c.cutover_date = ?
  )`, bankAccountId, bank.account_id, bank.opening_date)
  return { books_start: entity?.books_start, last_reconciled_end: last?.day ?? null, opening_date: bank.opening_date }
}

export async function historyChoice(db: D1Database, bankAccountId: string, input?: Data, current?: Data) {
  if (!input && current?.bank_account_id === bankAccountId && current.history_start) return { mode: current.history_mode, start: current.history_start }
  const options = await historyOptions(db, bankAccountId), mode = input?.mode ?? 'booksStart'
  requireThat(['booksStart', 'lastReconciled', 'explicit'].includes(mode), 'Choose books start, last reconciled statement, or an explicit history date')
  requireThat(options.books_start, 'Set the books start date before connecting a feed', 409)
  if (mode === 'lastReconciled') requireThat(options.last_reconciled_end, 'This account has no reconciled statement or accepted move-in balance; choose books start or an explicit date', 409)
  const start = mode === 'explicit' ? date(input?.startDate, 'History start date') : mode === 'lastReconciled' ? addDays(options.last_reconciled_end, 1) : options.books_start
  requireThat(start <= now().slice(0, 10), 'History start cannot be in the future')
  return { mode, start }
}

export const feedAccountIdle = (id: string) => guard(`EXISTS (SELECT 1 FROM pt_feed_accounts f JOIN pt_feed_items i ON i.id = f.item_id
  WHERE f.id = ? AND (i.claim_until IS NULL OR i.claim_until < ?))`, id, now())

const normalized = (value: string) => value.normalize('NFKC').toLocaleUpperCase('en-US').replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
const eligible = (line: string) => `${line}.posted_date >= (SELECT books_start FROM pt_entity WHERE id = 1)
  AND ${line}.posted_date > (SELECT opening_date FROM pt_bank_accounts WHERE id = ${line}.bank_account_id)
  AND NOT EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND ${line}.posted_date BETWEEN start_date AND end_date)`

function hold(a: Data, t: PlaidTransaction, stamp: string, state: string, reason: string, candidates: Data[]): Sql[] {
  const details = transactionDetails(t), snapshot = JSON.stringify(details)
  return [q(`INSERT INTO pt_feed_history (id, feed_account_id, bank_account_id, feed_txn_id, posted_date, amount_cents, description, details, state, reason, candidates, observed_at, revision)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT (feed_txn_id) DO UPDATE SET posted_date = excluded.posted_date, amount_cents = excluded.amount_cents,
      description = excluded.description, details = excluded.details, removed_at = NULL,
      state = CASE WHEN excluded.state = 'reference' THEN 'reference' ELSE pt_feed_history.state END,
      reason = CASE WHEN excluded.state = 'reference' THEN excluded.reason ELSE pt_feed_history.reason END,
      candidates = excluded.candidates,
      revision = CASE WHEN pt_feed_history.details <> excluded.details OR pt_feed_history.candidates <> excluded.candidates THEN excluded.revision ELSE pt_feed_history.revision END,
      observed_at = excluded.observed_at`, uid(), a.id, a.bank_account_id, t.transaction_id, t.date, details.amountCents, details.description, snapshot, state, reason, JSON.stringify(candidates), stamp, uid())]
}

/** Load once per claimed sync, rather than spending provider-history-sized D1 queries. */
export async function historyIndex(db: D1Database, itemId: string) {
  const [lines, history, locked] = await Promise.all([
    all(db, `SELECT l.* FROM pt_bank_lines l JOIN pt_feed_accounts f ON f.bank_account_id = l.bank_account_id WHERE f.item_id = ?`, itemId),
    all(db, 'SELECT h.* FROM pt_feed_history h JOIN pt_feed_accounts f ON f.id = h.feed_account_id WHERE f.item_id = ?', itemId),
    all(db, "SELECT start_date, end_date FROM pt_periods WHERE status = 'locked'"),
  ])
  return { lines, history: new Map(history.map(h => [h.feed_txn_id, h])), providerIds: new Set(lines.map(l => l.feed_txn_id).filter(Boolean)), locked }
}
type HistoryIndex = Awaited<ReturnType<typeof historyIndex>>

/** Observations are processed in order: two transactions cannot adopt one file row. */
export function historyObservation(index: HistoryIndex, a: Data, t: PlaidTransaction, stamp: string): { held: boolean; statements: Sql[] } {
  const history = index.history.get(t.transaction_id)
  const existing = index.providerIds.has(t.transaction_id)
  let reason = ''
  if (t.date < a.books_start) reason = 'before-books'
  else if (index.locked.some(p => t.date >= p.start_date && t.date <= p.end_date)) reason = 'locked-period'
  else if (t.date <= a.opening_date) reason = 'opening-balance'
  if (existing && (reason || history?.state === 'reference')) {
    reason ||= history!.reason
    index.history.set(t.transaction_id, { ...history, state: 'reference', reason })
    return { held: true, statements: [
      transactionException(a.id, t.transaction_id, 'modified', JSON.stringify(transactionDetails(t)), stamp),
      ...hold(a, t, stamp, 'reference', reason, []),
      q(`UPDATE pt_bank_lines SET removed_at = ? WHERE feed_txn_id = ? AND statement_id IS NULL AND NOT ${protectedLine('pt_bank_lines')}`, stamp, t.transaction_id),
      q('UPDATE pt_bank_lines SET feed_snapshot = ? WHERE feed_txn_id = ?', JSON.stringify(transactionDetails(t)), t.transaction_id),
      q('DELETE FROM pt_feed_pending WHERE feed_txn_id = ?', t.transaction_id),
    ] }
  }
  // The provider id (including an OFX FITID) is the first identity evidence.
  if (existing) return { held: false, statements: [] }
  if (history?.state === 'duplicate') return { held: true, statements: [] }
  const amount = transactionDetails(t).amountCents
  const candidates = index.lines.filter(l => l.bank_account_id === a.bank_account_id && l.statement_id && !l.removed_at &&
    (l.fingerprint === `fitid:${t.transaction_id}` || (l.posted_date === t.date && l.amount_cents === amount)))
  const byId = candidates.filter(l => l.fingerprint === `fitid:${t.transaction_id}` && (!l.feed_txn_id || l.feed_txn_id === t.transaction_id))
  const exact = candidates.filter(l => !l.feed_txn_id && l.posted_date === t.date && l.amount_cents === amount && normalized(l.description) === normalized(transactionDetails(t).description))
  const target = byId.length === 1 ? byId[0] : exact.length === 1 ? exact[0] : null
  if (target && !t.pending && history?.state !== 'doubtful') {
    index.providerIds.add(t.transaction_id)
    target.feed_txn_id = t.transaction_id
    return { held: true, statements: [
    guard('EXISTS (SELECT 1 FROM pt_bank_lines WHERE id = ? AND posted_date = ? AND amount_cents = ? AND description = ? AND removed_at IS NULL)', target.id, target.posted_date, target.amount_cents, target.description),
    q('UPDATE pt_bank_lines SET feed_txn_id = ?, feed_account_id = ?, feed_snapshot = ? WHERE id = ? AND feed_txn_id IS NULL', t.transaction_id, a.id, JSON.stringify(transactionDetails(t)), target.id), changed(),
    ...(history?.id ? [q('DELETE FROM pt_feed_history WHERE id = ? AND state IN (\'reference\', \'doubtful\')', history.id)] : []),
  ] } }
  if (reason) { index.history.set(t.transaction_id, { ...history, state: 'reference', reason }); return { held: true, statements: hold(a, t, stamp, 'reference', reason, candidates) } }
  if (history?.state === 'reference') return { held: true, statements: hold(a, t, stamp, 'reference', history.reason, candidates) }
  if (history?.state === 'distinct') { index.providerIds.add(t.transaction_id); return { held: false, statements: [] } }
  if (history?.state === 'doubtful' || candidates.length) {
    index.history.set(t.transaction_id, { ...history, state: 'doubtful' })
    return { held: true, statements: hold(a, t, stamp, 'doubtful', exact.length > 1 ? 'multiple-statement-lines' : 'description-differs', candidates) }
  }
  if (!t.pending) index.providerIds.add(t.transaction_id)
  return { held: false, statements: [periodOpen(t.date),
    guard('EXISTS (SELECT 1 FROM pt_entity WHERE id = 1 AND books_start <= ?) AND EXISTS (SELECT 1 FROM pt_bank_accounts WHERE id = ? AND opening_date < ?)', t.date, a.bank_account_id, t.date),
    guard("NOT EXISTS (SELECT 1 FROM pt_bank_lines WHERE bank_account_id = ? AND statement_id IS NOT NULL AND removed_at IS NULL AND posted_date = ? AND amount_cents = ?)", a.bank_account_id, t.date, amount)] }
}

export const removeHistoryObservation = (id: string, stamp: string) => q('UPDATE pt_feed_history SET removed_at = ?, revision = ? WHERE feed_txn_id = ? AND removed_at IS NULL', stamp, uid(), id)

export async function historyView(db: D1Database) {
  const rows = await all(db, `SELECT h.*, b.name AS bank_name, f.item_id, i.institution_name FROM pt_feed_history h
    JOIN pt_bank_accounts b ON b.id = h.bank_account_id JOIN pt_feed_accounts f ON f.id = h.feed_account_id
    JOIN pt_feed_items i ON i.id = f.item_id ORDER BY h.posted_date, h.id`)
  const view = rows.map(r => ({ ...r, ...JSON.parse(r.details), candidates: JSON.parse(r.candidates) }))
  return { references: view.filter(r => r.state === 'reference'), duplicates: view.filter(r => r.state !== 'reference') }
}

export const duplicateDecision: Command = { need: 'record', async run(c, b) {
  const row = await one(c.db, 'SELECT * FROM pt_feed_history WHERE id = ?', text(b.id, 'Duplicate observation'))
  requireThat(row, 'Duplicate observation not found', 404)
  requireThat(row.state === 'doubtful' && row.revision === b.revision && !row.removed_at, 'This duplicate question changed or was already decided; reload it', 409)
  requireThat(b.decision === 'duplicate' || b.decision === 'distinct', 'Choose the existing statement line or keep a separate transaction')
  const details = JSON.parse(row.details), candidates: Data[] = JSON.parse(row.candidates)
  let target: Data | null = null
  if (b.decision === 'duplicate') {
    const candidate = candidates.find(l => l.id === b.bankLineId)
    requireThat(candidate, 'Choose one of the statement lines shown for this transaction')
    target = await one(c.db, "SELECT * FROM pt_bank_lines WHERE id = ? AND bank_account_id = ? AND statement_id IS NOT NULL AND removed_at IS NULL", b.bankLineId, row.bank_account_id)
    requireThat(target, 'The statement line changed; reload the duplicate question', 409)
    requireThat(['posted_date', 'amount_cents', 'description', 'feed_txn_id', 'fingerprint'].every(key => candidate[key] === target![key]), 'The statement line changed; refresh the feed before deciding', 409)
  }
  const txn: PlaidTransaction = { transaction_id: row.feed_txn_id, account_id: '', date: details.date, amount: -details.amountCents / 100, name: details.description, merchant_name: details.payee, check_number: details.reference, pending: details.pending }
  const statements: Sql[] = [authority(c.actor, 'record'), feedAccountIdle(row.feed_account_id),
    guard("EXISTS (SELECT 1 FROM pt_feed_history WHERE id = ? AND revision = ? AND state = 'doubtful' AND removed_at IS NULL)", row.id, b.revision)]
  if (target) {
    statements.push(guard("EXISTS (SELECT 1 FROM pt_bank_lines WHERE id = ? AND bank_account_id = ? AND statement_id IS NOT NULL AND removed_at IS NULL AND posted_date = ? AND amount_cents = ? AND description = ? AND feed_txn_id IS ?)", target.id, row.bank_account_id, target.posted_date, target.amount_cents, target.description, target.feed_txn_id))
    if (!target.feed_txn_id) statements.push(q('UPDATE pt_bank_lines SET feed_txn_id = ?, feed_account_id = ?, feed_snapshot = ? WHERE id = ? AND feed_txn_id IS NULL', row.feed_txn_id, row.feed_account_id, row.details, target.id), changed())
  } else {
    requireThat(!details.pending, 'Wait for the pending bank transaction to post before keeping it separately', 409)
    requireThat(!(await one(c.db, 'SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND ? BETWEEN s.start_date AND s.end_date', row.bank_account_id, row.posted_date)), 'Undo this period’s reconciliation before adding a separate bank transaction', 409)
    statements.push(periodOpen(row.posted_date), guard(`EXISTS (SELECT 1 FROM pt_feed_history h WHERE h.id = ? AND ${eligible('h')})`, row.id),
      guard('NOT EXISTS (SELECT 1 FROM pt_reconciliations r JOIN pt_statements s ON s.id = r.statement_id WHERE r.bank_account_id = ? AND ? BETWEEN s.start_date AND s.end_date)', row.bank_account_id, row.posted_date),
      ...posted(txn, row.bank_account_id, row.feed_account_id, now()))
  }
  statements.push(q('UPDATE pt_feed_history SET state = ?, bank_line_id = COALESCE(?, (SELECT id FROM pt_bank_lines WHERE feed_txn_id = ?)), decided_by = ?, decided_at = ?, revision = ? WHERE id = ?', b.decision, target?.id ?? null, row.feed_txn_id, c.actor.email, now(), uid(), row.id),
    audit(who(c.actor), 'feed.duplicate-decide', 'feed-history', row.id, { decision: b.decision, bankLineId: target?.id ?? null, feedTransactionId: row.feed_txn_id }))
  await run(c.db, statements)
  return { history: await historyView(c.db) }
} }
