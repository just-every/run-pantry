// Journal schedules share invoice month/week arithmetic, not a second
// ledger. Each edit revokes automatic posting until that version is approved.
import { authority, who } from './access'
import { addDays, date, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, approval, audit, changed, one, q, run } from './db'
import { parseLines, type Line } from './journal'
import { occurrence } from './recurring'
import { businessDay, sendingSettings } from './delivery'
import type { Command } from './context'
import { generateJournalOccurrence } from './recurring-journal-runs'

export const recurringJournalDate = (start: string, every: number, n: number, cadence: 'day' | 'week' | 'month') => cadence === 'day' ? addDays(start, every * n) : occurrence(start, cadence, every, n)
export const journalInputLines = (lines: Line[]) => lines.map(l => ({ ...l, debit: (l.debit / 100).toFixed(2), credit: (l.credit / 100).toFixed(2) }))

export async function recurringJournal(db: D1Database, id: string): Promise<Data & { lines: Line[] }> {
  const row = await one(db, 'SELECT * FROM pt_recurring_journals WHERE id = ?', id)
  requireThat(row, 'Recurring journal not found', 404)
  return { ...row, lines: JSON.parse(row.lines) as Line[] }
}

const save: Command = { need: 'record', async run(c, b) {
  const start = date(b.startDate, 'First entry date'), end = b.endDate ? date(b.endDate, 'Last entry date') : null
  requireThat(!end || end >= start, 'The last entry date is on or after the first')
  const cadence = b.cadence ?? 'month'
  requireThat(['day', 'week', 'month'].includes(cadence), 'Repeat by days, weeks or months')
  const every = Number(b.every ?? 1)
  requireThat(Number.isSafeInteger(every) && every >= 1, 'Repeat every positive whole number of days, weeks or months')
  const [year, month] = start.split('-').map(Number)
  const maxInterval = cadence === 'month' ? (9999 - year) * 12 + 12 - month : Math.floor((Date.UTC(9999, 11, 31) - Date.parse(start)) / (86400000 * (cadence === 'week' ? 7 : 1)))
  requireThat(every <= maxInterval, 'The interval must produce a calendar date through year 9999')
  const mode = text(b.mode, 'Each occurrence')
  requireThat(mode === 'draft' || mode === 'post', 'Create drafts or post under an approved template')
  const name = text(b.name, 'Template name', 200), memo = text(b.memo, 'Entry description', 500)
  const lines = await parseLines(c.db, b.lines), revision = uid(), at = now()
  const before = b.id ? await recurringJournal(c.db, text(b.id, 'Recurring journal')) : null
  if (before) {
    requireThat(before.revision === b.revision, 'Recurring journal changed; reload', 409)
    requireThat(!before.runs || (before.start_date === start && before.every === every && before.cadence === cadence), 'After the first occurrence, keep the schedule anchor and interval; create a new template for a new schedule', 409)
  }
  const id = before?.id ?? uid(), next = recurringJournalDate(start, every, before?.runs ?? 0, cadence)
  const nextDate = end && next > end ? null : next
  const status = !nextDate ? 'ended' : before?.status === 'paused' ? 'paused' : mode === 'post' ? 'awaiting-approval' : 'active'
  const after = { revision, name, memo, lines, every, cadence, start_date: start, end_date: end, next_date: nextDate, mode, status, prepared_by: c.actor.email }
  await run(c.db, [authority(c.actor, 'record'), ...(before ? [
    q('UPDATE pt_recurring_journals SET name = ?, memo = ?, lines = ?, every = ?, cadence = ?, start_date = ?, end_date = ?, next_date = ?, mode = ?, status = ?, prepared_by = ?, approved_by = NULL, approved_revision = NULL, approved_snapshot = NULL, revision = ?, updated_at = ? WHERE id = ? AND revision = ? AND runs = ? AND status = ?', name, memo, JSON.stringify(lines), every, cadence, start, end, nextDate, mode, status, c.actor.email, revision, at, id, b.revision, before.runs, before.status), changed(),
  ] : [q('INSERT INTO pt_recurring_journals (id, name, memo, lines, every, cadence, start_date, end_date, next_date, mode, status, prepared_by, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)', id, name, memo, JSON.stringify(lines), every, cadence, start, end, nextDate, mode, status, c.actor.email, revision, at, at)]),
    audit(who(c.actor), before ? 'recurring-journal.edit' : 'recurring-journal.create', 'recurring-journal', id, { revision, before, after })])
  return recurringJournal(c.db, id)
} }

const approve: Command = { need: 'post', async run(c, b) {
  const t = await recurringJournal(c.db, text(b.id, 'Recurring journal'))
  requireThat(t.mode === 'post' && t.status === 'awaiting-approval' && t.revision === b.revision, 'Review the current journal template revision waiting for approval', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || c.actor.email !== t.prepared_by), 'Someone other than the preparer approves this recurring journal', 403)
  const parsed = await parseLines(c.db, journalInputLines(t.lines))
  requireThat(JSON.stringify(parsed) === JSON.stringify(t.lines), 'Template coding or amounts changed; edit and review it again', 409)
  await run(c.db, [authority(c.actor, 'post'), approval(who(c.actor), 'recurring-journal', t.id, t.revision, 'approve', 'approved', optionalText(b.note, 'Note', 500)),
    q("UPDATE pt_recurring_journals SET status = 'active', approved_by = ?, approved_revision = revision, approved_snapshot = ?, updated_at = ? WHERE id = ? AND revision = ? AND status = 'awaiting-approval'", c.actor.email, JSON.stringify(parsed), now(), t.id, b.revision), changed(),
    audit(who(c.actor), 'recurring-journal.approve', 'recurring-journal', t.id, { revision: t.revision, before: { status: t.status }, after: { status: 'active', approved_by: c.actor.email, lines: parsed } })])
  return recurringJournal(c.db, t.id)
} }

const status: Command = { need: 'record', async run(c, b) {
  const t = await recurringJournal(c.db, text(b.id, 'Recurring journal')), requested = text(b.status, 'Status')
  requireThat(t.revision === b.revision && t.status !== 'ended', 'Template changed or its schedule ended; reload', 409)
  requireThat(requested === 'active' || requested === 'paused', 'Pause or resume this schedule')
  const next = requested === 'active' && t.mode === 'post' && t.approved_revision !== t.revision ? 'awaiting-approval' : requested
  await run(c.db, [authority(c.actor, 'record'), q('UPDATE pt_recurring_journals SET status = ?, updated_at = ? WHERE id = ? AND revision = ? AND status = ?', next, now(), t.id, b.revision, t.status), changed(),
    audit(who(c.actor), `recurring-journal.${requested === 'paused' ? 'pause' : 'resume'}`, 'recurring-journal', t.id, { revision: t.revision, before: { status: t.status }, after: { status: next } })])
  return recurringJournal(c.db, t.id)
} }

const retry: Command = { need: 'record', async run(c, b) {
  const t = await recurringJournal(c.db, text(b.id, 'Recurring journal')), day = date(b.occurrence, 'Occurrence')
  const previous = await one(c.db, 'SELECT * FROM pt_recurring_journal_runs WHERE recurring_id = ? AND occurrence = ?', t.id, day)
  requireThat(t.revision === b.revision && previous && ['blocked', 'failed'].includes(previous.status) && !previous.journal_id, 'Only a failed or blocked occurrence can be retried; reload', 409)
  requireThat(previous.template_revision === t.revision, 'This occurrence belongs to an earlier template revision; prepare a corrective journal with its retained evidence', 409)
  requireThat(['active', 'ended'].includes(t.status), 'Resume and approve the exact template revision before retrying', 409)
  await generateJournalOccurrence(c.db, t, day, day, { retry: true, authority: authority(c.actor, 'record') })
  return recurringJournal(c.db, t.id)
} }

export const recurringJournalCommands: Record<string, Command> = {
  'recurring-journal.save': save, 'recurring-journal.approve': approve, 'recurring-journal.status': status, 'recurring-journal.retry': retry,
}

/** Catch up original dates, up to twelve per template per trigger. Remaining
 * dates stay visible as missed; overlapping Cron/request runs share the key. */
export async function runDueRecurringJournals(db: D1Database, today: string) {
  const due = await all(db, "SELECT id FROM pt_recurring_journals WHERE status = 'active' AND next_date <= ? ORDER BY next_date, id", today)
  for (const { id } of due) for (let i = 0; i < 12; i++) {
    const t = await recurringJournal(db, id)
    if (t.status !== 'active' || !t.next_date || t.next_date > today) break
    await generateJournalOccurrence(db, t, t.next_date, today)
  }
}

export async function recurringJournalsView(db: D1Database, today?: string) {
  today ??= businessDay((await sendingSettings(db)).time_zone)
  const [templates, history] = await Promise.all([
    all(db, 'SELECT * FROM pt_recurring_journals ORDER BY name, id'),
    all(db, `SELECT r.*, j.number AS journal_number, j.status AS journal_status, j.reversed_by_id
      FROM pt_recurring_journal_runs r LEFT JOIN pt_journal_entries j ON j.id = r.journal_id ORDER BY occurrence DESC, at DESC`),
  ])
  const exceptions: Data[] = history.filter(r => r.status === 'failed' || r.status === 'blocked').map(r => ({ ...r, name: templates.find(t => t.id === r.recurring_id)?.name }))
  for (const t of templates) {
    t.lines = JSON.parse(t.lines)
    t.runs_list = history.filter(r => r.recurring_id === t.id)
    let n = t.runs, next = t.next_date
    while (next && next <= today && (!t.end_date || next <= t.end_date)) {
      exceptions.push({ recurring_id: t.id, name: t.name, occurrence: next, template_revision: t.revision, status: 'missed',
        detail: t.status === 'awaiting-approval' ? 'Waiting for approval of this template revision' : t.status === 'paused' ? 'Schedule is paused' : 'Due occurrence has not run yet; the next scheduled check catches up' })
      next = recurringJournalDate(t.start_date, t.every, ++n, t.cadence)
    }
  }
  exceptions.sort((a, b) => a.occurrence.localeCompare(b.occurrence) || a.name.localeCompare(b.name))
  return { templates, exceptions, today }
}
