import { authority, who } from './access'
import { date, optionalText, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, q, run } from './db'
import type { Command } from './context'

// Assignment coordinates work; it does not grant access or restrict who may record completion.
const PEOPLE = `SELECT lower(email) AS email, display_name AS name FROM oa_operators WHERE role = 'owner' AND status = 'active'
  UNION SELECT lower(email), name FROM pt_members WHERE active = 1`
export const closeAssignees = (db: D1Database) => all(db, `${PEOPLE} ORDER BY name, email`)
export function taskFields(body: Data) {
  const assignee = optionalText(body.assignee, 'Assignee', 254).toLowerCase() || null
  const dueDate = body.dueDate ? date(body.dueDate, 'Due date') : null
  return { assignee, dueDate }
}
export const assigneeGuard = (assignee: string | null) => guard(`? IS NULL OR EXISTS (SELECT 1 FROM (${PEOPLE}) WHERE email = ?)`, assignee, assignee)

export const saveCloseTask: Command = { need: 'record', async run(c, b) {
  const task = await one(c.db, 'SELECT * FROM pt_close_tasks WHERE id = ?', text(b.id, 'Task'))
  requireThat(task, 'Task not found', 404)
  if (task.judgment_kind) requireThat(c.actor.kind === 'person' && ['owner', 'accountant'].includes(c.actor.role), 'Only the owner or accountant edits close judgments', 403)
  const title = text(b.title, 'Task', 200), { assignee, dueDate } = taskFields(b)
  // An edited task needs a fresh completion; its previous audit remains immutable.
  await run(c.db, [authority(c.actor, 'record'), assigneeGuard(assignee),
    guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE id = ? AND status = 'locked')", task.period),
    q("UPDATE pt_close_tasks SET title = ?, assignee = ?, due_date = ?, status = 'open', note = '', done_by = NULL, done_at = NULL, revision = ? WHERE id = ? AND revision = ?",
      title, assignee, dueDate, uid(), task.id, text(b.revision, 'Task revision')), changed(),
    audit(who(c.actor), 'close.task-edited', 'close-task', task.id, { period: task.period })])
  return { id: task.id, period: task.period }
} }

/** A bounded, live summary. Task progress never claims the calculated checks passed. */
export async function closeBoard(db: D1Database, year: string) {
  requireThat(/^\d{4}$/.test(year) && Number(year) >= 1900 && Number(year) <= 9998, 'Board year must be between 1900 and 9998')
  const from = `${year}-01`, to = `${year}-12`
  const periods = await all(db, 'SELECT id, status, locked_by, locked_at FROM pt_periods WHERE id BETWEEN ? AND ?', from, to)
  const tasks = await all(db, `SELECT period, COUNT(*) AS total, SUM(status = 'done') AS done,
    MIN(CASE WHEN status <> 'done' THEN due_date END) AS next_due FROM pt_close_tasks WHERE period BETWEEN ? AND ? GROUP BY period`, from, to)
  const questions = await all(db, "SELECT period, COUNT(*) AS waiting FROM pt_questions WHERE period BETWEEN ? AND ? AND status IN ('open', 'confirm') GROUP BY period", from, to)
  return { year, months: Array.from({ length: 12 }, (_, i) => {
    const id = `${year}-${String(i + 1).padStart(2, '0')}`, p = periods.find(p => p.id === id), t = tasks.find(t => t.period === id)
    return { id, status: p?.status ?? 'open', lockedBy: p?.locked_by ?? null, lockedAt: p?.locked_at ?? null,
      total: Number(t?.total ?? 0), done: Number(t?.done ?? 0), nextDue: t?.next_due ?? null,
      waiting: Number(questions.find(q => q.period === id)?.waiting ?? 0) }
  }) }
}
