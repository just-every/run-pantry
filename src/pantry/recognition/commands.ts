import { authority, who } from '../access'
import { businessDay, sendingSettings } from '../delivery'
import { date, now, optionalText, requireThat, text, uid } from '../core'
import { approval, audit, changed, guard, one, q, run } from '../db'
import type { Command } from '../context'
import { accountFences, parsePlan, schedule, snapshot, sourceFence, validateAccounts, type Schedule } from './plan'
import { approvalFences, generateRecognition } from './runs'

const today = async (db: D1Database) => businessDay((await sendingSettings(db)).time_zone)

const save: Command = { need: 'record', async run(c, b) {
  const p = await parsePlan(c.db, b), before = b.id ? await schedule(c.db, text(b.id, 'Schedule')) : null
  if (before) {
    requireThat(before.revision === b.revision, 'Schedule changed; reload', 409)
    requireThat(!await one(c.db, "SELECT 1 FROM pt_recognition_runs WHERE schedule_id = ? AND status = 'posted'", before.id), 'A schedule with successful postings cannot change; create a separate correcting or new plan', 409)
  }
  const s: Schedule = { ...p, id: before?.id ?? uid(), revision: uid(), prepared_by: c.actor.email, status: 'awaiting-approval' }
  const fields = [s.kind, s.name, s.balance_account_id, s.recognition_account_id, s.amount_cents, s.start_date, s.months, JSON.stringify(s.plan), s.source_journal_id, s.source_line_id, s.source_date, s.prepared_by, s.revision, now()]
  await run(c.db, [authority(c.actor, 'record'), ...accountFences(s), ...sourceFence(s),
    ...(before ? [guard("NOT EXISTS (SELECT 1 FROM pt_recognition_runs WHERE schedule_id = ? AND status = 'posted')", s.id),
      q("UPDATE pt_recognition_schedules SET kind = ?, name = ?, balance_account_id = ?, recognition_account_id = ?, amount_cents = ?, start_date = ?, months = ?, plan = ?, source_journal_id = ?, source_line_id = ?, source_date = ?, prepared_by = ?, revision = ?, updated_at = ?, status = 'awaiting-approval', approved_by = NULL, approved_revision = NULL, approved_snapshot = NULL WHERE id = ? AND revision = ?", ...fields, s.id, b.revision), changed()]
      : [q("INSERT INTO pt_recognition_schedules (kind, name, balance_account_id, recognition_account_id, amount_cents, start_date, months, plan, source_journal_id, source_line_id, source_date, prepared_by, revision, updated_at, id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'awaiting-approval', ?)", ...fields, s.id, now())]),
    audit(who(c.actor), before ? 'recognition.edit' : 'recognition.create', 'recognition', s.id, { revision: s.revision, before, after: s })])
  return schedule(c.db, s.id)
} }

const approve: Command = { need: 'post', async run(c, b) {
  const s = await schedule(c.db, text(b.id, 'Schedule'))
  requireThat(s.revision === b.revision, 'Review the current schedule revision', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || c.actor.email !== s.prepared_by), 'Someone other than the preparer approves this schedule', 403)
  await validateAccounts(c.db, s)
  const value = snapshot(s)
  await run(c.db, [authority(c.actor, 'post'), ...accountFences(s), ...sourceFence(s),
    q("UPDATE pt_recognition_schedules SET status = CASE WHEN status = 'ended' THEN 'ended' ELSE 'active' END, approved_by = ?, approved_revision = revision, approved_snapshot = ?, updated_at = ? WHERE id = ? AND revision = ?", c.actor.email, value, now(), s.id, b.revision), changed(),
    approval(who(c.actor), 'recognition', s.id, s.revision, 'approve', 'approved', optionalText(b.note, 'Note', 500)),
    audit(who(c.actor), 'recognition.approve', 'recognition', s.id, { revision: s.revision, before: { status: s.status, approved_by: s.approved_by }, after: { approved_by: c.actor.email, approved_revision: s.revision, snapshot: JSON.parse(value) } })])
  return schedule(c.db, s.id)
} }

const retry: Command = { need: 'record', async run(c, b) {
  const s = await schedule(c.db, text(b.id, 'Schedule')), id = text(b.occurrence, 'Occurrence')
  requireThat(s.revision === b.revision && s.approved_revision === s.revision, 'Approve the current schedule revision before retrying', 409)
  const p = s.plan.find(p => p.id === id)
  const prior = await one(c.db, 'SELECT * FROM pt_recognition_runs WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, id)
  requireThat(p && prior && ['failed', 'blocked'].includes(prior.status) && !prior.journal_id, 'Only a failed or blocked occurrence in this revision can be retried', 409)
  await generateRecognition(c.db, s, p, await today(c.db), { retry: true, authority: authority(c.actor, 'record') })
  return schedule(c.db, s.id)
} }

const milestone: Command = { need: 'record', async run(c, b) {
  const s = await schedule(c.db, text(b.id, 'Schedule')), id = text(b.milestoneId ?? b.occurrence, 'Milestone')
  requireThat(s.revision === b.revision && s.approved_revision === s.revision && s.status === 'active', 'Approve this exact schedule revision before recording its milestone', 409)
  const p = s.plan.find(p => p.id === id && p.milestone)
  requireThat(p, 'Milestone not found in this schedule revision', 404)
  const day = await today(c.db), achieved = date(b.date ?? day, 'Achievement date')
  requireThat(achieved >= s.start_date && achieved <= day, 'Achievement date must be on or after schedule start and no later than today')
  requireThat(!await one(c.db, 'SELECT 1 FROM pt_recognition_milestones WHERE schedule_id = ? AND revision = ? AND occurrence = ?', s.id, s.revision, id), 'This milestone was already recorded; retry its failed posting instead', 409)
  await run(c.db, [authority(c.actor, 'record'), ...approvalFences(s),
    q('INSERT INTO pt_recognition_milestones (schedule_id, revision, occurrence, achieved_date, recorded_by, recorded_at) VALUES (?, ?, ?, ?, ?, ?)', s.id, s.revision, id, achieved, c.actor.email, now()),
    audit(who(c.actor), 'recognition.milestone', 'recognition', s.id, { revision: s.revision, before: null, after: { occurrence: id, achieved_date: achieved, recorded_by: c.actor.email } })])
  await generateRecognition(c.db, s, p, day, { authority: authority(c.actor, 'record') })
  return schedule(c.db, s.id)
} }

export const recognitionCommands: Record<string, Command> = {
  'recognition.save': save, 'recognition.approve': approve, 'recognition.retry': retry, 'recognition.milestone': milestone,
}
