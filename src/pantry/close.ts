import { assigneeGuard, closeAssignees, saveCloseTask, taskFields } from './close-workflow'
import { YEAR_END_TASKS, yearEndChecks } from './year-end-checks'
import { recognitionCloseGuards, recognitionTies } from './recognition'
import { feedCloseExceptions } from './feeds/health'
import { clearingState } from './stripe-clearing'
import { clearingCloseGuards } from './stripe-clearing-close'
// Period close: calculated checks plus reviewed tasks, then a lock that both
// people and agents' approved work must respect. Reopening is a separate
// request approved by someone holding the reopen grant.
import { authority, who, type Actor } from './access'
import { longDay, monthBounds, monthName, now, optionalText, requireThat, text, uid, usd, type Data } from './core'
import { all, approval, audit, changed, guard, one, q, run, type Sql } from './db'
import { ageing, trialBalance } from './reports'
import { requireEntity } from './settings'
import { missingReceipts } from './receipts/attachments'
import { openSummary, periodThread } from './questions/close'
import type { Command } from './context'

const DEFAULT_TASKS = ['Review the trial balance', 'Review receivables and payables aging', 'Review adjusting entries']

export async function closeState(db: D1Database, id: string): Promise<Data> {
  const { start, end } = monthBounds(id)
  const p = await one(db, 'SELECT * FROM pt_periods WHERE id = ?', id)
  const checks: { key: string; title: string; ok: boolean; detail: string; items?: Data[] }[] = []

  const banks = await all(db, 'SELECT * FROM pt_bank_accounts ORDER BY name')
  const unreconciled = []
  for (const bank of banks) {
    if (bank.opening_date >= end) continue
    const r = await one(db, 'SELECT MAX(end_date) AS through FROM pt_reconciliations WHERE bank_account_id = ?', bank.id)
    if (!r?.through || r.through < end) unreconciled.push({ id: bank.id, name: bank.name, through: r?.through ?? null })
  }
  checks.push({ key: 'bank', title: 'Bank accounts reconciled', ok: unreconciled.length === 0, items: unreconciled,
    detail: unreconciled.length ? unreconciled.map(b => `${b.name} ${b.through ? 'reconciled through ' + longDay(b.through) : 'not reconciled yet'}`).join('; ')
      : banks.length ? `${banks.length === 1 ? 'The account' : banks.length === 2 ? 'Both accounts' : `All ${banks.length} accounts`} reconciled through ${longDay(end)}` : 'No bank accounts' })

  const drafts = await all(db, "SELECT id, memo, entry_date, source_kind FROM pt_journal_entries WHERE status = 'draft' AND entry_date BETWEEN ? AND ?", start, end)
  const invoices = await all(db, "SELECT id, number, status FROM pt_invoices WHERE status IN ('draft', 'approved') AND issue_date BETWEEN ? AND ?", start, end)
  const bills = await all(db, "SELECT id, reference FROM pt_bills WHERE status = 'draft' AND bill_date BETWEEN ? AND ?", start, end)
  const unposted = drafts.length + invoices.length + bills.length
  checks.push({ key: 'drafts', title: 'No unposted drafts', ok: unposted === 0, items: [...drafts.map(d => ({ kind: 'journal', id: d.id, label: d.memo })), ...invoices.map(i => ({ kind: 'invoice', id: i.id, label: i.number })), ...bills.map(b => ({ kind: 'bill', id: b.id, label: b.reference }))],
    detail: unposted ? `${drafts.length} journal, ${invoices.length} invoice and ${bills.length} bill drafts dated in ${monthName(id)}` : 'Nothing waiting to post' })

  const missing = await all(db, "SELECT b.id, b.reference, b.bill_date, b.total_cents, c.name AS vendor FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.status = 'posted' AND b.bill_date BETWEEN ? AND ? AND b.evidence_waived IS NULL AND NOT EXISTS (SELECT 1 FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id)", start, end)
  const waived = Number((await one(db, "SELECT COUNT(*) AS n FROM pt_bills WHERE status = 'posted' AND bill_date BETWEEN ? AND ? AND evidence_waived IS NOT NULL", start, end))?.n ?? 0)
  checks.push({ key: 'evidence', title: 'Bills have source documents', ok: missing.length === 0, items: missing.map(m => ({ kind: 'bill', id: m.id, label: `${m.vendor} ${m.reference}`, date: m.bill_date, amount_cents: m.total_cents })),
    detail: missing.length ? `${missing.length} bill${missing.length === 1 ? '' : 's'} without a document or recorded reason` : waived ? `Every bill has a receipt or a recorded reason (${waived} waived)` : 'Every bill has a receipt' })

  const ar = await ageing(db, 'receivable', end), ap = await ageing(db, 'payable', end)
  checks.push({ key: 'subledgers', title: 'Receivables and payables agree to control accounts', ok: ar.agrees && ap.agrees,
    detail: `Receivables ${usd(ar.subledger)} vs ${ar.control ? usd(ar.control.balance) : 'no control account'}; payables ${usd(ap.subledger)} vs ${ap.control ? usd(ap.control.balance) : 'no control account'}` })

  // Money paid or received but left unapplied while the same customer or vendor has open invoices or bills: the bill still
  // reads as owed and the cash-basis profit misses it. A prepayment with nothing open is fine.
  const applied = (target: string) => `COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments ap ON a.source_kind = 'payment' AND ap.id = a.source_id
    WHERE a.target_kind = '${target}' AND a.target_id = t.id AND (a.source_kind = 'credit' OR ap.reversal_id IS NULL) AND a.voided_by IS NULL), 0)`
  const unapplied = await all(db, `SELECT p.id, p.direction, c.name, p.amount_cents - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a WHERE a.source_kind = 'payment' AND a.source_id = p.id), 0) AS left_cents
    FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id WHERE p.reversal_id IS NULL AND p.payment_date <= ?
      AND p.amount_cents > COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a WHERE a.source_kind = 'payment' AND a.source_id = p.id), 0)
      AND CASE p.direction WHEN 'paid' THEN EXISTS (SELECT 1 FROM pt_bills t WHERE t.vendor_id = p.contact_id AND (t.status = 'posted' OR t.opening = 1) AND t.status <> 'void' AND t.bill_date <= ? AND t.total_cents > ${applied('bill')})
        ELSE EXISTS (SELECT 1 FROM pt_invoices t WHERE t.customer_id = p.contact_id AND t.kind = 'invoice' AND t.status = 'issued' AND t.issue_date <= ? AND t.total_cents > ${applied('invoice')}) END
    ORDER BY p.payment_date, p.id`, end, end, end)
  checks.push({ key: 'unapplied', title: 'Payments applied to their invoices and bills', ok: unapplied.length === 0,
    items: unapplied.map(x => ({ kind: 'payment', id: x.id, label: `${usd(x.left_cents)} ${x.direction === 'paid' ? 'to' : 'from'} ${x.name}` })),
    detail: unapplied.length ? `${unapplied.map(x => `${usd(x.left_cents)} ${x.direction === 'paid' ? 'paid to' : 'received from'} ${x.name}`).join('; ')} not applied while they have open ${unapplied.every(x => x.direction === 'paid') ? 'bills' : unapplied.every(x => x.direction !== 'paid') ? 'invoices' : 'invoices or bills'}: apply ${unapplied.length === 1 ? 'it' : 'them'} under Sales & bills › Payments`
      : 'No payment is waiting to be applied' })

  const feedExceptions = await feedCloseExceptions(db, end)
  checks.push({ key: 'feeds', title: 'Bank feeds synced through month end', ok: feedExceptions.length === 0,
    items: feedExceptions.map(f => ({ kind: 'feed', id: f.id, label: f.label })),
    detail: feedExceptions.length ? feedExceptions.map(f => f.label).join('; ') : 'Every connected feed is synced through month end' })

  const clearing = await clearingState(db)
  if (clearing) checks.push({ key: 'stripe-clearing', title: 'Stripe clearing agrees to the provider', ok: clearing.ok,
    detail: `Latest provider comparison${clearing.observedAt ? ' at ' + clearing.observedAt : ''}: ledger ${usd(clearing.ledgerCents)}, Stripe ${clearing.providerCents === null ? 'not observed' : usd(clearing.providerCents)}, difference ${clearing.differenceCents === null ? 'not compared' : usd(clearing.differenceCents)}. ${clearing.reason || ''} ${clearing.items.filter((i: Data) => !['posted', 'adopted', 'legacy-covered', 'covered'].includes(i.status)).map((i: Data) => `${i.id} (${i.type}): ${i.reason}`).join('; ')}`,
    items: clearing.items.filter((i: Data) => !['posted', 'adopted', 'legacy-covered', 'covered'].includes(i.status)).map((i: Data) => ({ kind: 'stripe-clearing', id: i.id, label: `${i.id} · ${i.type} · ${i.reason}` })) })

  const tb = await trialBalance(db, end)
  checks.push({ key: 'trial-balance', title: 'Trial balance balances', ok: tb.balanced, detail: `Debits ${usd(tb.debit)}, credits ${usd(tb.credit)}` })

  const ties = await recognitionTies(db, end)
  checks.push({ key: 'recognition', title: 'Recognition schedules tie to the balance sheet', ok: ties.every(t => t.ties), items: ties,
    detail: ties.length ? ties.map(t => `${t.account_name}: expected ${usd(t.expected_cents)}, posted ${usd(t.actual_cents)}, difference ${usd(t.difference_cents)}${t.exceptions.length ? `; ${t.exceptions.length} missing or failed occurrences` : ''}`).join('; ') : 'No prepaid, accrual or deferred-revenue schedules' })

  const proposals = await all(db, "SELECT id, summary FROM pt_proposals WHERE status = 'proposed'")
  checks.push({ key: 'proposals', title: 'No agent proposals waiting', ok: proposals.length === 0, items: proposals.map(x => ({ kind: 'proposal', id: x.id, label: x.summary })), detail: proposals.length ? `${proposals.length} waiting for a person` : 'None waiting' })

  // The books agent's questions about this month: every one answered (or settled) before the lock.
  const questions = await periodThread(db, id), waiting = questions.filter(x => x.status === 'open' || x.status === 'confirm')
  checks.push({ key: 'questions', title: 'Pantry’s questions answered', ok: waiting.length === 0, items: waiting.map(x => ({ kind: 'question', id: x.id, label: x.title })),
    detail: waiting.length ? openSummary(waiting) : questions.length ? `All ${questions.length} answered or settled` : 'Pantry has asked nothing about this month' })

  const entity = await requireEntity(db)
  const yearEnd = Number(id.slice(5)) === (Number(entity.fiscal_year_start) + 10) % 12 + 1
  if (yearEnd) checks.push(...(await yearEndChecks(db, Number(id.slice(0, 4)), entity.fiscal_year_start)).checks)
  const tasks = await all(db, 'SELECT * FROM pt_close_tasks WHERE period = ? ORDER BY title, id', id)
  if (yearEnd) checks.push({ key: 'year-end-reviews', title: 'Year-end review tasks added', ok: YEAR_END_TASKS.every(title => tasks.some(t => t.title === title)), detail: 'Add the standard review tasks to include 1099 classification and payroll year-end review.' })
  const requests = await all(db, 'SELECT * FROM pt_reopen_requests WHERE period = ? ORDER BY requested_at DESC, id', id)
  const approvals = await all(db, "SELECT * FROM pt_approvals WHERE subject_kind = 'period' AND subject_id = ? ORDER BY at DESC, id", id)
  const notes = await all(db, 'SELECT * FROM pt_notes WHERE period = ? ORDER BY approved_at DESC, id', id)
  const ready = checks.every(x => x.ok) && tasks.length > 0 && tasks.every(t => t.status === 'done')
  // Every entry keeps its receipt: spending without one is listed here, to add one or say why none is needed.
  const receipts = { missing: await missingReceipts(db, start, end), waived: await all(db, 'SELECT w.*, e.memo, e.entry_date FROM pt_receipt_waivers w JOIN pt_journal_entries e ON e.id = w.entry_id WHERE e.entry_date BETWEEN ? AND ? ORDER BY e.entry_date', start, end) }
  return { id, start, end, status: p?.status ?? 'open', period: p, checks, tasks, requests, approvals, notes, ready, receipts, questions, assignees: await closeAssignees(db) }
}

const ensureTasks: Command = { need: 'record', async run(c, b) {
  const id = text(b.period, 'Period'); monthBounds(id)
  const existing = await all(c.db, 'SELECT title FROM pt_close_tasks WHERE period = ?', id)
  const entity = await requireEntity(c.db), isYearEnd = Number(id.slice(5)) === (Number(entity.fiscal_year_start) + 10) % 12 + 1
  const defaults = [...DEFAULT_TASKS, ...(isYearEnd ? YEAR_END_TASKS : [])]
  const { assignee, dueDate } = taskFields(b)
  const titles = b.title ? [text(b.title, 'Task', 200)] : existing.length ? (isYearEnd ? YEAR_END_TASKS.filter(title => !existing.some(t => t.title === title)) : []) : defaults
  const tasks = titles.map(title => ({ id: uid(), revision: uid(), title }))
  await run(c.db, [authority(c.actor, 'record'), assigneeGuard(assignee), guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE id = ? AND status = 'locked')", id),
    ...tasks.flatMap(t => [q("INSERT INTO pt_close_tasks (id, period, title, status, revision, assignee, due_date) VALUES (?, ?, ?, 'open', ?, ?, ?)", t.id, id, t.title, t.revision, assignee, dueDate),
      audit(who(c.actor), 'close.task-added', 'close-task', t.id, { period: id })]),
    audit(who(c.actor), 'close.tasks', 'period', id, { added: titles, tasks: tasks.map(t => t.id), assignee, dueDate })])
  return closeState(c.db, id)
} }

const completeTask: Command = { need: 'record', async run(c, b) {
  const task = await one(c.db, 'SELECT * FROM pt_close_tasks WHERE id = ?', text(b.id, 'Task'))
  requireThat(task, 'Task not found', 404)
  if (task.judgment_kind) requireThat(c.actor.kind === 'person' && ['owner', 'accountant'].includes(c.actor.role), 'Only the owner or accountant reviews close judgments', 403)
  const done = b.done !== false
  await run(c.db, [authority(c.actor, 'record'), guard("NOT EXISTS (SELECT 1 FROM pt_periods WHERE id = ? AND status = 'locked')", task.period),
    q('UPDATE pt_close_tasks SET status = ?, note = ?, done_by = ?, done_at = ?, revision = ? WHERE id = ? AND revision = ?', done ? 'done' : 'open', optionalText(b.note, 'Note', 1000), done ? c.actor.email : null, done ? now() : null, uid(), task.id, b.revision), changed(),
    audit(who(c.actor), done ? 'close.task-done' : 'close.task-reopened', 'close-task', task.id, { period: task.period })])
  return closeState(c.db, task.period)
} }

/** The batch that locks a period whose checks pass and whose tasks are done. */
export async function lockPlan(db: D1Database, actor: Actor, id: string, note: string): Promise<Sql[]> {
  await requireEntity(db)
  const state = await closeState(db, id)
  requireThat(state.status !== 'locked', 'Period is already locked', 409)
  const failing = state.checks.filter((x: Data) => !x.ok).map((x: Data) => x.title)
  requireThat(!failing.length, `Resolve before locking: ${failing.join('; ')}`, 409)
  requireThat(state.tasks.length && state.tasks.every((t: Data) => t.status === 'done'), 'Complete every review task before locking', 409)
  const revision = uid()
  return [
    ...await recognitionCloseGuards(db, state.end),
    ...await clearingCloseGuards(db),
    // The checked state must still hold: no task reopened, no draft or posting added in the period meanwhile.
    guard("(SELECT COUNT(*) FROM pt_close_tasks WHERE period = ? AND status <> 'done') = 0", id),
    guard("NOT EXISTS (SELECT 1 FROM pt_journal_entries WHERE status = 'draft' AND entry_date BETWEEN ? AND ?)", state.start, state.end),
    guard("NOT EXISTS (SELECT 1 FROM pt_feed_accounts f JOIN pt_feed_items i ON i.id = f.item_id JOIN pt_bank_accounts b ON b.id = f.bank_account_id WHERE i.status <> 'disconnected' AND b.opening_date < ? AND (f.last_synced_at IS NULL OR f.last_synced_at < ?))", state.end, `${state.end}T23:59:59.999Z`),
    guard("NOT EXISTS (SELECT 1 FROM pt_questions WHERE period = ? AND status IN ('open', 'confirm'))", id),
    state.period
      ? q("UPDATE pt_periods SET status = 'locked', locked_by = ?, locked_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'open'", actor.email, now(), revision, id, state.period.revision)
      : q("INSERT INTO pt_periods (id, start_date, end_date, status, locked_by, locked_at, revision) VALUES (?, ?, ?, 'locked', ?, ?, ?)", id, state.start, state.end, actor.email, now(), revision),
    changed(),
    approval(who(actor), 'period', id, state.period?.revision ?? 'new', 'lock', 'approved', note),
    audit(who(actor), 'period.lock', 'period', id)]
}

const lock: Command = { need: 'lock', async run(c, b) {
  const id = text(b.period, 'Period')
  await run(c.db, [authority(c.actor, 'lock'), ...await lockPlan(c.db, c.actor, id, optionalText(b.note, 'Note', 500))])
  return closeState(c.db, id)
} }

const requestReopen: Command = { need: 'record', async run(c, b) {
  const id = text(b.period, 'Period'), p = await one(c.db, 'SELECT * FROM pt_periods WHERE id = ?', id)
  requireThat(p && p.status === 'locked', 'Only a locked period is reopened', 409)
  requireThat(!(await one(c.db, "SELECT 1 FROM pt_reopen_requests WHERE period = ? AND status = 'pending'", id)), 'A reopening request is already waiting', 409)
  const reason = text(b.reason, 'Reason for reopening', 1000), rid = uid()
  await run(c.db, [authority(c.actor, 'record'), q("INSERT INTO pt_reopen_requests (id, period, reason, requested_by, requested_at, status, period_revision) VALUES (?, ?, ?, ?, ?, 'pending', ?)", rid, id, reason, c.actor.email, now(), p.revision),
    audit(who(c.actor), 'period.reopen-requested', 'period', id, { reason })])
  return closeState(c.db, id)
} }

const decideReopen: Command = { need: 'reopen', async run(c, b) {
  const r = await one(c.db, 'SELECT * FROM pt_reopen_requests WHERE id = ?', text(b.id, 'Request'))
  requireThat(r && r.status === 'pending', 'Request not found or already decided', 404)
  const p = (await one(c.db, 'SELECT * FROM pt_periods WHERE id = ?', r.period))!
  requireThat(p.revision === r.period_revision && p.status === 'locked', 'The period changed since this request; ask again', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || r.requested_by !== c.actor.email), 'Someone other than the requester approves reopening', 403)
  const approve = b.decision === 'approve', note = optionalText(b.note, 'Note', 500)
  await run(c.db, [authority(c.actor, 'reopen'),
    q("UPDATE pt_reopen_requests SET status = ?, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'", approve ? 'approved' : 'rejected', c.actor.email, now(), r.id), changed(),
    ...(approve ? [q("UPDATE pt_periods SET status = 'open', revision = ? WHERE id = ? AND revision = ? AND status = 'locked'", uid(), p.id, p.revision), changed()] : []),
    approval(who(c.actor), 'period', p.id, p.revision, 'reopen', approve ? 'approved' : 'rejected', note || r.reason),
    audit(who(c.actor), approve ? 'period.reopen' : 'period.reopen-declined', 'period', p.id, { request: r.id, reason: r.reason })])
  return closeState(c.db, p.id)
} }

export const closeCommands: Record<string, Command> = {
  'close.tasks': ensureTasks,
  'close.task-save': saveCloseTask,
  'close.task': completeTask,
  'period.lock': lock,
  'period.request-reopen': requestReopen,
  'period.decide-reopen': decideReopen,
}
