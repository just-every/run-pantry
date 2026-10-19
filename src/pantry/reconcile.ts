// Statement reconciliation: deterministic balance proof, never a confidence score.
// A statement reconciles when its opening follows the last reconciled closing,
// its lines add up to its balances, every line is matched, and the ledger's
// bank balance less items not yet on a statement equals the closing balance.
import { authority, who, type Actor } from './access'
import { now, requireThat, text, uid, usd, type Data } from './core'
import { all, audit, guard, one, q, run, assertOpen, type Sql } from './db'
import type { Command } from './context'
import { reconciliationHistory, reconciliationUndoPreview, reconciliationUndoCommands } from './reconciliation-undo'

export async function reconciliationState(db: D1Database, statementId: string): Promise<Data> {
  const statement = await one(db, 'SELECT * FROM pt_statements WHERE id = ?', statementId)
  requireThat(statement, 'Statement not found', 404)
  const bank = (await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', statement.bank_account_id))!
  const done = await one(db, 'SELECT * FROM pt_reconciliations WHERE statement_id = ?', statement.id)
  const previous = await one(db, 'SELECT * FROM pt_reconciliations WHERE bank_account_id = ? AND end_date < ? ORDER BY end_date DESC LIMIT 1', bank.id, statement.end_date)
  const blockers: { kind: string; message: string; amount?: number; ids?: string[] }[] = []

  const earlier = await one(db, 'SELECT s.end_date FROM pt_statements s LEFT JOIN pt_reconciliations r ON r.statement_id = s.id WHERE s.bank_account_id = ? AND s.end_date < ? AND s.end_date > ? AND r.id IS NULL ORDER BY s.end_date LIMIT 1', bank.id, statement.end_date, previous?.end_date ?? bank.opening_date)
  if (earlier) blockers.push({ kind: 'order', message: `Reconcile the statement ending ${earlier.end_date} first` })
  const expectedOpening = previous ? previous.closing_cents : bank.opening_cents
  if (statement.opening_cents !== expectedOpening) blockers.push({ kind: 'opening', amount: statement.opening_cents - expectedOpening, message: `Statement opening ${usd(statement.opening_cents)} differs from the ${previous ? 'last reconciled closing' : 'opening statement balance'} ${usd(expectedOpening)}` })

  const lines = await all(db, `SELECT l.*, m.match_id, mt.automatic, mt.payment_id, mt.note AS match_note FROM pt_bank_lines l LEFT JOIN pt_match_bank_lines m ON m.bank_line_id = l.id AND m.active = 1 LEFT JOIN pt_matches mt ON mt.id = m.match_id
    WHERE l.bank_account_id = ? AND l.posted_date BETWEEN ? AND ? AND (l.removed_at IS NULL OR m.match_id IS NOT NULL) ORDER BY l.posted_date, l.description, l.id`, bank.id, statement.start_date, statement.end_date)
  const lineTotal = lines.reduce((s, l) => s + l.amount_cents, 0)
  if (lineTotal !== statement.closing_cents - statement.opening_cents) blockers.push({ kind: 'statement', amount: statement.closing_cents - statement.opening_cents - lineTotal, message: `Statement lines total ${usd(lineTotal)} but the balances move by ${usd(statement.closing_cents - statement.opening_cents)}: a line is missing or the balances were entered wrongly` })
  const gone = lines.filter(l => l.removed_at)
  if (gone.length) blockers.push({ kind: 'removed', ids: gone.map(l => l.id), message: `${gone.length} line${gone.length === 1 ? ' was' : 's were'} removed by the bank after being matched; undo ${gone.length === 1 ? 'its match' : 'their matches'}` })
  const unmatched = lines.filter(l => !l.match_id)
  if (unmatched.length) blockers.push({ kind: 'unmatched', amount: unmatched.reduce((s, l) => s + l.amount_cents, 0), ids: unmatched.map(l => l.id), message: `${unmatched.length} statement line${unmatched.length === 1 ? '' : 's'} not matched to the books` })

  const balanceAt = async (day: string) => Number((await one(db, "SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date <= ?", bank.account_id, day))?.n ?? 0)
  const baseline = await balanceAt(bank.opening_date)
  if (baseline !== bank.opening_cents) blockers.push({ kind: 'baseline', amount: baseline - bank.opening_cents, message: `The books show ${usd(baseline)} in ${bank.name} on ${bank.opening_date}, but its opening statement balance is ${usd(bank.opening_cents)}; post the opening balance or correct it` })
  const book = await balanceAt(statement.end_date)
  // Book postings after the bank's opening that no statement line up to this end date has cleared.
  const outstanding = await all(db, `SELECT l.id, l.debit_cents - l.credit_cents AS amount, e.entry_date, e.memo, e.number FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
    WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date > ? AND e.entry_date <= ?
    AND NOT EXISTS (SELECT 1 FROM pt_match_postings mp JOIN pt_match_bank_lines mb ON mb.match_id = mp.match_id AND mb.active = 1 JOIN pt_bank_lines bl ON bl.id = mb.bank_line_id
      WHERE mp.journal_line_id = l.id AND mp.active = 1 AND bl.posted_date <= ?)
    ORDER BY e.entry_date, e.number, l.id`, bank.account_id, bank.opening_date, statement.end_date, statement.end_date)
  const outstandingTotal = outstanding.reduce((s, o) => s + Number(o.amount), 0)
  const cleared = book - outstandingTotal
  const difference = statement.closing_cents - cleared
  if (difference !== 0 && !blockers.some(b => b.kind === 'unmatched' || b.kind === 'baseline')) blockers.push({ kind: 'difference', amount: difference, message: `Cleared books ${usd(cleared)} differ from the statement closing ${usd(statement.closing_cents)} by ${usd(difference)}` })
  const postings = await all(db, `SELECT l.id, l.debit_cents - l.credit_cents AS amount, e.entry_date, e.memo, e.number, mp.match_id FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
    LEFT JOIN pt_match_postings mp ON mp.journal_line_id = l.id AND mp.active = 1
    WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date > ? AND e.entry_date <= ? AND e.reversed_by_id IS NULL ORDER BY e.entry_date, e.number, l.id`, bank.account_id, bank.opening_date, statement.end_date)
  return { undo: await reconciliationUndoPreview(db, statementId), history: await reconciliationHistory(db, statementId), statement, bank, completed: done, opening: statement.opening_cents, closing: statement.closing_cents, book, outstanding, outstandingTotal, cleared, difference, lines, postings, blockers, ready: !done && blockers.length === 0 }
}

/** The batch that records a ready statement's reconciliation with its proof. */
export async function completion(db: D1Database, actor: Actor, statementId: string): Promise<{ state: Data; statements: Sql[] }> {
  const state = await reconciliationState(db, statementId)
  requireThat(!state.completed, 'Already reconciled', 409)
  requireThat(state.ready, state.blockers.map((x: Data) => x.message).join('; ') || 'Not ready', 409)
  await assertOpen(db, state.statement.end_date)
  const id = uid(), matchIds = [...new Set(state.lines.map((l: Data) => l.match_id))]
  const proof = { opening: state.opening, closing: state.closing, book: state.book, outstanding: state.outstanding, cleared: state.cleared, lines: state.lines.map((l: Data) => ({ id: l.id, date: l.posted_date, amount: l.amount_cents, match: l.match_id })) }
  return { state, statements: [
    // The proof must still hold at commit: no match changed, lock or posting arrived.
    guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND start_date <= ? AND end_date >= ?)", state.statement.end_date, state.statement.start_date),
    guard(`(SELECT COUNT(*) FROM pt_match_bank_lines mb JOIN pt_bank_lines l ON l.id = mb.bank_line_id WHERE mb.active = 1 AND l.bank_account_id = ? AND l.posted_date BETWEEN ? AND ?) = ?`, state.bank.id, state.statement.start_date, state.statement.end_date, state.lines.length),
    guard("(SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id WHERE e.status = 'posted' AND l.account_id = ? AND e.entry_date <= ?) = ?", state.bank.account_id, state.statement.end_date, state.book),
    q('INSERT INTO pt_reconciliations (id, bank_account_id, statement_id, end_date, opening_cents, closing_cents, book_cents, outstanding_cents, proof, completed_by, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, state.bank.id, state.statement.id, state.statement.end_date, state.opening, state.closing, state.book, state.outstandingTotal, JSON.stringify(proof), actor.email, now()),
    ...matchIds.map(m => q('UPDATE pt_matches SET reconciliation_id = ? WHERE id = ?', id, m)),
    audit(who(actor), 'reconciliation.complete', 'statement', state.statement.id, { closing: state.closing, outstanding: state.outstandingTotal })] }
}

const complete: Command = { need: 'record', async run(c, b) {
  const { state, statements } = await completion(c.db, c.actor, text(b.statementId, 'Statement'))
  await run(c.db, [authority(c.actor, 'record'), ...statements])
  return reconciliationState(c.db, state.statement.id)
} }

export const reconcileCommands: Record<string, Command> = { 'reconciliation.complete': complete, ...reconciliationUndoCommands }
