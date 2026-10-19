// A fiscal year closes through its existing monthly checks and grants. One
// atomic batch locks all twelve months, with no closing journal or lock bypass.
import { authority, who } from './access'
import { all, audit, guard, one, run } from './db'
import { closeState, lockPlan } from './close'
import { requireEntity } from './settings'
import { balanceSheet } from './reports'
import { requireThat, sha256, type Data } from './core'
import { yearBounds, yearEndChecks } from './year-end-checks'
import type { Command } from './context'

export async function adjustingEntries(db: D1Database, year: number) {
  const entity = await requireEntity(db), bounds = yearBounds(year, entity.fiscal_year_start)
  const entries = await all(db, "SELECT * FROM pt_journal_entries WHERE adjusting = 1 AND status = 'posted' AND entry_date BETWEEN ? AND ? ORDER BY number, id", bounds.start, bounds.end)
  const lines = await all(db, `SELECT l.*, a.code, a.name FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id WHERE e.adjusting = 1 AND e.status = 'posted' AND e.entry_date BETWEEN ? AND ? ORDER BY e.number, l.line_no`, bounds.start, bounds.end)
  for (const e of entries) e.lines = lines.filter(l => l.entry_id === e.id)
  return { ...bounds, entries, debit: lines.reduce((s, l) => s + l.debit_cents, 0), credit: lines.reduce((s, l) => s + l.credit_cents, 0) }
}

export async function yearEndState(db: D1Database, year: number): Promise<Data> {
  const entity = await requireEntity(db), readiness = await yearEndChecks(db, year, entity.fiscal_year_start)
  const months = []
  for (const period of readiness.periods) {
    const close = await closeState(db, period)
    months.push({ id: period, status: close.status, ready: close.status === 'locked' || close.ready,
      checks: close.checks.filter((c: Data) => !c.ok), tasksOpen: close.tasks.filter((t: Data) => t.status !== 'done').length, hasTasks: close.tasks.length > 0 })
  }
  const auditCount = Number((await one(db, 'SELECT COUNT(*) AS n FROM pt_audit'))!.n)
  const after = `${Number(readiness.end.slice(0, 4)) + (readiness.end.slice(5) === '12-31' ? 1 : 0)}-${String(entity.fiscal_year_start).padStart(2, '0')}-01`
  return { ...readiness, months, adjusting: await adjustingEntries(db, year),
    closingBalanceSheet: await balanceSheet(db, readiness.end, entity.fiscal_year_start),
    openingBalanceSheet: await balanceSheet(db, after, entity.fiscal_year_start),
    locked: months.every(m => m.status === 'locked'), ready: months.every(m => m.ready) && readiness.checks.every(c => c.ok),
    revision: await sha256(new TextEncoder().encode(JSON.stringify([entity.revision, auditCount, readiness.payroll]))), auditCount, entityRevision: entity.revision }
}

const lockYear: Command = { need: 'lock', async run(c, b) {
  const year = Number(b.year), state = await yearEndState(c.db, year)
  requireThat(!state.locked, 'This fiscal year is already locked', 409)
  requireThat(state.revision === b.revision, 'Year-end changed; review it again', 409)
  requireThat(state.ready, 'Complete every monthly close and resolve year-end checks before locking the year', 409)
  const statements = [authority(c.actor, 'lock'), guard('(SELECT COUNT(*) FROM pt_audit) = ?', state.auditCount), guard('(SELECT revision FROM pt_entity WHERE id = 1) = ?', state.entityRevision)]
  statements.push(guard('(SELECT COUNT(*) FROM pt_gusto_payrolls WHERE check_date BETWEEN ? AND ?) = ?', state.start, state.end, state.payroll.length))
  for (const payroll of state.payroll) statements.push(guard('EXISTS (SELECT 1 FROM pt_gusto_payrolls WHERE uuid = ? AND read_at = ? AND status = ? AND gross_cents = ? AND employer_tax_cents = ? AND debit_cents = ?)', payroll.uuid, payroll.read_at, payroll.status, payroll.gross_cents, payroll.employer_tax_cents, payroll.debit_cents))
  for (const month of state.months) if (month.status !== 'locked') statements.push(...await lockPlan(c.db, c.actor, month.id, `Fiscal year ${year} close`))
  statements.push(audit(who(c.actor), 'year-end.lock', 'fiscal-year', String(year), { start: state.start, end: state.end, revision: state.revision, periods: state.months.map((m: Data) => m.id) }))
  await run(c.db, statements)
  return yearEndState(c.db, year)
} }

export const yearEndCommands: Record<string, Command> = { 'year-end.lock': lockYear }
