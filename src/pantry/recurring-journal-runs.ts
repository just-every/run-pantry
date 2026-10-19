// Atomic occurrence generation. A failed date remains explicit evidence;
// only a person retries it, and successful occurrence keys never run again.
import { Fault, now, requireThat, uid, type Data } from './core'
import { all, approval, audit, changed, guard, one, periodOpen, q, run, type AuditActor, type Sql } from './db'
import { entryStatements, parseLines } from './journal'
import { journalInputLines, recurringJournalDate } from './recurring-journals'

const actor: AuditActor = { email: 'pantry:recurring-journals', kind: 'system' }
const approverCondition = `EXISTS (SELECT 1 FROM oa_operators o LEFT JOIN pt_members m ON lower(m.email) = lower(o.email)
  WHERE lower(o.email) = lower(?) AND o.status = 'active' AND (o.role = 'owner' OR (m.active = 1 AND m.can_post = 1 AND m.role <> 'viewer')))`

export async function generateJournalOccurrence(db: D1Database, t: Data, day: string, today: string, options: { retry?: boolean; authority?: Sql } = {}) {
  const revision = t.revision, snapshot = JSON.stringify({ revision, name: t.name, memo: t.memo, lines: t.lines, mode: t.mode, approved_by: t.approved_by, approved_revision: t.approved_revision })
  const next = recurringJournalDate(t.start_date, t.every, t.runs + 1), ended = !!t.end_date && next > t.end_date
  const fence = () => [
    ...(options.authority ? [options.authority] : []),
    guard('EXISTS (SELECT 1 FROM pt_recurring_journals WHERE id = ? AND revision = ? AND status = ? AND lines = ? AND runs = ?)', t.id, revision, t.status, JSON.stringify(t.lines), t.runs),
  ]
  const advance = () => options.retry ? [] : [q('UPDATE pt_recurring_journals SET runs = runs + 1, next_date = ?, status = ?, updated_at = ? WHERE id = ? AND revision = ? AND runs = ?', ended ? null : next, ended ? 'ended' : 'active', now(), t.id, revision, t.runs), changed()]
  const claim = (journalId: string | null, status: string, detail: string) => options.retry
    ? [q("UPDATE pt_recurring_journal_runs SET journal_id = ?, status = ?, detail = ?, at = ? WHERE recurring_id = ? AND occurrence = ? AND template_revision = ? AND journal_id IS NULL AND status IN ('failed', 'blocked')", journalId, status, detail, now(), t.id, day, revision), changed()]
    : [q('INSERT INTO pt_recurring_journal_runs (recurring_id, occurrence, template_revision, template_snapshot, journal_id, status, detail, late, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', t.id, day, revision, snapshot, journalId, status, detail, day < today ? 1 : 0, now())]
  const provenance = { id: t.id, revision, occurrence: day }
  const storeFailure = async (reason: string, blocked: boolean) => {
    try {
      await run(db, [...fence(), ...claim(null, blocked ? 'blocked' : 'failed', reason), ...advance(),
        audit(actor, 'recurring-journal.failed', 'recurring-journal', t.id, { revision, recurringJournal: provenance, occurrence: day, reason, before: null, after: { status: blocked ? 'blocked' : 'failed', reason } })])
    } catch (error) { if (!await raced(db, t, day, options.retry)) throw error }
  }
  let lines: Awaited<ReturnType<typeof parseLines>>
  try {
    const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", day)
    requireThat(!locked, `${day} is in locked period ${locked?.id}; reopen it before retrying`, 409)
    lines = await parseLines(db, journalInputLines(t.lines))
    if (t.mode === 'post') {
      requireThat(t.approved_revision === revision && t.approved_snapshot === JSON.stringify(lines), 'Template amounts or coding do not match the approved revision; edit and approve it again', 409)
      requireThat(t.approved_by && await one(db, `SELECT 1 AS ok WHERE ${approverCondition}`, t.approved_by), 'The template approver no longer holds the posting grant; review the template again', 409)
    }
  } catch (error) {
    if (!(error instanceof Fault)) console.error('Recurring journal preparation failed', error)
    return storeFailure(error instanceof Fault ? error.message : 'Journal preparation failed; check the server log', error instanceof Fault && error.status === 409)
  }
  const id = uid(), journalRevision = uid(), automatic = t.mode === 'post'
  const statement = { id, revision: journalRevision, date: day, memo: t.memo, sourceKind: 'manual', sourceId: t.id,
    preparedBy: t.prepared_by, preparedKind: 'person' as const, lines }
  const statements: Sql[] = [...fence(), periodOpen(day),
    ...lines.map(l => guard("EXISTS (SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1 AND subtype NOT IN ('receivable', 'payable'))", l.accountId)),
    ...(automatic ? [guard('EXISTS (SELECT 1 FROM pt_recurring_journals WHERE id = ? AND approved_revision = ? AND approved_snapshot = ? AND approved_by = ?)', t.id, revision, JSON.stringify(lines), t.approved_by), guard(approverCondition, t.approved_by)] : []),
    ...entryStatements(statement, automatic ? actor.email : undefined),
    ...(automatic ? [approval({ email: t.approved_by, kind: 'person' }, 'journal', id, journalRevision, 'post', 'approved', `Recurring journal ${t.name}; approved template revision ${revision}; occurrence ${day}`)] : []),
    ...claim(id, automatic ? 'posted' : 'drafted', automatic ? 'Posted under this exact approved template revision' : 'Draft created; a person must review and post its exact journal revision'), ...advance(),
    audit(actor, automatic ? 'journal.post' : 'journal.draft', 'journal', id, { recurringJournal: provenance, before: null, after: { date: day, memo: t.memo, lines, status: automatic ? 'posted' : 'draft' } }),
    audit(actor, 'recurring-journal.run', 'recurring-journal', t.id, { revision, recurringJournal: provenance, before: null, after: { occurrence: day, journalId: id, status: automatic ? 'posted' : 'drafted' } }),
  ]
  try { await run(db, statements) } catch (error) {
    if (await raced(db, t, day, options.retry)) return
    if (!(error instanceof Fault)) console.error('Recurring journal posting failed', error)
    await storeFailure(error instanceof Fault ? error.message : 'Journal posting failed; check the server log', error instanceof Fault && error.status === 409)
  }
}

/** A competing occurrence, edit or pause won. Its durable result is authoritative. */
async function raced(db: D1Database, t: Data, day: string, retry = false) {
  const fresh = await one(db, 'SELECT revision, status, runs FROM pt_recurring_journals WHERE id = ?', t.id)
  if (!fresh || fresh.revision !== t.revision || fresh.status !== t.status || fresh.runs !== t.runs) return true
  const existing = await all(db, 'SELECT status FROM pt_recurring_journal_runs WHERE recurring_id = ? AND occurrence = ?', t.id, day)
  return existing.length > 0 && (!retry || ['posted', 'drafted'].includes(existing[0].status))
}
