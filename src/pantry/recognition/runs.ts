import { standingAuthority, standingFence } from '../access-policy/banks'
import { Fault, now, requireThat, uid, type Data } from '../core'
import { all, approval, audit, changed, guard, one, periodOpen, q, run, type AuditActor, type Sql } from '../db'
import { entryStatements, parseLines, postStatements } from '../journal'
import { accountFences, inputLines, linesFor, schedule, snapshot, sourceFence, validateAccounts, type Installment, type Schedule } from './plan'

const actor: AuditActor = { email: 'pantry:recognition', kind: 'system' }
/** Approval is rechecked at preparation and in the final posting transaction. */
export function approvalFences(s: Schedule): Sql[] {
  return [guard("EXISTS (SELECT 1 FROM pt_recognition_schedules WHERE id = ? AND revision = ? AND approved_revision = ? AND approved_by = ? AND approved_snapshot = ? AND status IN ('active', 'ended'))", s.id, s.revision, s.revision, s.approved_by, snapshot(s)), standingFence(standingAuthority(s.approved_by ?? '', 'journal', [], [s.balance_account_id, s.recognition_account_id]))]
}

export async function generateRecognition(db: D1Database, s: Schedule, p: Installment, today: string, options: { retry?: boolean; authority?: Sql } = {}) {
  const previous = await one(db, 'SELECT * FROM pt_recognition_runs WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, p.id)
  if (previous && (!options.retry || previous.status === 'posted')) return
  const achieved = p.milestone ? await one(db, 'SELECT * FROM pt_recognition_milestones WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, p.id) : null
  if (p.milestone && !achieved) return
  const day = achieved?.achieved_date ?? p.date
  requireThat(day <= today, 'This occurrence is not due yet', 409)
  const provenance = { id: s.id, revision: s.revision, occurrence: p.id }
  const fence = () => [
    ...(options.authority ? [options.authority] : []),
    guard("EXISTS (SELECT 1 FROM pt_recognition_schedules WHERE id = ? AND revision = ? AND plan = ? AND status IN ('active', 'ended'))", s.id, s.revision, JSON.stringify(s.plan)),
    ...(achieved ? [guard('EXISTS (SELECT 1 FROM pt_recognition_milestones WHERE schedule_id = ? AND revision = ? AND occurrence = ? AND achieved_date = ?)', s.id, s.revision, p.id, day)] : []),
  ]
  const claim = (journalId: string | null, status: string, detail: string): Sql[] => options.retry
    ? [q("UPDATE pt_recognition_runs SET journal_id = ?, status = ?, detail = ?, at = ? WHERE schedule_id = ? AND revision = ? AND occurrence = ? AND status IN ('failed', 'blocked') AND journal_id IS NULL", journalId, status, detail, now(), s.id, s.revision, p.id), changed()]
    : [q('INSERT INTO pt_recognition_runs (schedule_id, revision, occurrence, scheduled_date, entry_date, snapshot, journal_id, status, detail, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', s.id, s.revision, p.id, p.date, day, snapshot(s), journalId, status, detail, now())]
  const raced = async () => {
    const fresh = await one(db, 'SELECT revision FROM pt_recognition_schedules WHERE id = ?', s.id)
    if (!fresh || fresh.revision !== s.revision) return true
    const r = await one(db, 'SELECT status FROM pt_recognition_runs WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, p.id)
    return !!r && (!options.retry || r.status === 'posted')
  }
  const fail = async (error: unknown) => {
    const blocked = error instanceof Fault && error.status === 409
    const detail = error instanceof Fault ? error.message : 'Recognition posting failed; check the server log, correct the cause and explicitly retry'
    if (!(error instanceof Fault)) console.error('Recognition posting failed', error)
    try {
      await run(db, [...fence(), ...claim(null, blocked ? 'blocked' : 'failed', detail), audit(actor, 'recognition.failed', 'recognition', s.id,
        { revision: s.revision, recognition: provenance, before: previous, after: { occurrence: p.id, date: day, status: blocked ? 'blocked' : 'failed', detail } })])
    } catch (failure) { if (!await raced()) throw failure }
  }
  let origin: Data | null = null
  let lines
  try {
    const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", day)
    requireThat(!locked, `${day} is in locked period ${locked?.id}; reopen it before retrying`, 409)
    requireThat(s.approved_revision === s.revision && s.approved_snapshot === snapshot(s), 'Approve this exact schedule revision before posting', 409)
    const approver = standingAuthority(s.approved_by ?? '', 'journal', [], [s.balance_account_id, s.recognition_account_id])
    requireThat(s.approved_by && await one(db, `SELECT 1 AS ok WHERE ${approver.sql}`, ...approver.params), 'The schedule approver no longer holds the posting grant; approve this revision again', 409)
    await validateAccounts(db, s)
    if (s.kind !== 'accrual') {
      const source = await one(db, "SELECT 1 AS ok FROM pt_journal_entries WHERE id = ? AND status = 'posted' AND reversed_by_id IS NULL", s.source_journal_id)
      requireThat(source, 'The original funding journal has been reversed; correct the funding before posting', 409)
    }
    if (p.phase === 'reverse') {
      origin = await one(db, `SELECT j.* FROM pt_recognition_runs r JOIN pt_journal_entries j ON j.id = r.journal_id
        WHERE r.schedule_id = ? AND r.revision = ? AND r.occurrence = ? AND r.status = 'posted' AND j.status = 'posted'`, s.id, s.revision, p.origin_id)
      requireThat(origin && !origin.reversed_by_id, 'The month-end accrual must be posted and not already reversed; resolve its original occurrence first', 409)
    }
    lines = await parseLines(db, inputLines(linesFor(s, p)))
  } catch (error) { return fail(error) }
  const id = uid(), revision = uid(), memo = `${s.name}: ${p.label}`
  const statements: Sql[] = [...fence(), ...approvalFences(s), ...accountFences(s), ...sourceFence(s), periodOpen(day),
    ...(origin ? [guard("EXISTS (SELECT 1 FROM pt_journal_entries WHERE id = ? AND status = 'posted' AND reversed_by_id IS NULL)", origin.id)] : []),
    ...entryStatements({ id, revision, date: day, memo, sourceKind: origin ? 'reversal' : 'manual', sourceId: origin?.id ?? s.id, preparedBy: s.prepared_by, preparedKind: 'person', lines }),
    ...(origin ? [q('UPDATE pt_journal_entries SET reverses_id = ? WHERE id = ?', origin.id, id), changed()] : []),
    ...postStatements(id, actor.email),
    ...(origin ? [q('UPDATE pt_journal_entries SET reversed_by_id = ? WHERE id = ? AND reversed_by_id IS NULL', id, origin.id), changed()] : []),
    approval({ email: s.approved_by, kind: 'person' }, 'journal', id, revision, 'post', 'approved', `Recognition schedule ${s.name}; approved revision ${s.revision}; occurrence ${p.id}`),
    ...claim(id, 'posted', 'Posted under this exact approved schedule revision'),
    q("UPDATE pt_recognition_schedules SET status = CASE WHEN (SELECT COUNT(*) FROM pt_recognition_runs WHERE schedule_id = ? AND revision = ? AND status = 'posted') = json_array_length(plan) THEN 'ended' ELSE 'active' END, updated_at = ? WHERE id = ? AND revision = ?", s.id, s.revision, now(), s.id, s.revision), changed(),
    audit(actor, 'journal.post', 'journal', id, { recognition: provenance, before: null, after: { date: day, memo, lines, status: 'posted', reverses_id: origin?.id ?? null } }),
    audit(actor, 'recognition.run', 'recognition', s.id, { revision: s.revision, recognition: provenance, before: previous, after: { occurrence: p.id, date: day, journal_id: id, status: 'posted' } }),
  ]
  try { await run(db, statements) } catch (error) { if (!await raced()) await fail(error) }
}

/** Failed attempts stay visible until an explicit retry. Catch-up keeps original dates. */
export async function runDueRecognition(db: D1Database, today: string) {
  const schedules = await all(db, "SELECT id FROM pt_recognition_schedules WHERE status = 'active' ORDER BY start_date, id")
  for (const { id } of schedules) {
    const s = await schedule(db, id)
    let attempted = 0
    for (const p of s.plan) {
      if (p.milestone) {
        const achieved = await one(db, 'SELECT achieved_date FROM pt_recognition_milestones WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, p.id)
        if (!achieved || achieved.achieved_date > today) continue
      } else if (p.date > today) continue
      if (await one(db, 'SELECT 1 FROM pt_recognition_runs WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, p.id)) continue
      await generateRecognition(db, s, p, today)
      if (++attempted >= 24) break
    }
  }
}
