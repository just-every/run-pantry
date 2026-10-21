import { all, guard, one, type Sql } from '../db'
import { date, monthName, requireThat, sha256, type Data } from '../core'
import { projectedBooks } from './projection'
import { affectedLocks, correctionRange, reportFigures, type FiguresReader } from './reports'
import { affectedIssues } from './issues'

export type EffectsPlan = { statements: Sql[]; dates: string[]; lockDates?: string[] }

// Every native ledger, account, lock, tax, payment and issue write carries an
// immutable audit record. The commit repeats the count fence in its own batch.
export async function effectsFence(db: D1Database) {
  return Number((await one(db, 'SELECT COUNT(*) AS n FROM pt_audit'))!.n)
}
export const effectsGuard = (auditCount: number) => guard('(SELECT COUNT(*) FROM pt_audit) = ?', auditCount)

export async function previewEffects(db: D1Database, identity: Data, plan: EffectsPlan, chosenDate: string) {
  const day = date(chosenDate, 'Correction date'), auditCount = await effectsFence(db)
  const projected = await projectedBooks(db, plan.statements), range = correctionRange(day)
  const reports = new Map<string, ReturnType<FiguresReader>>()
  const figures: FiguresReader = (source, from, to, basis) => {
    const key = `${source === db ? 'before' : 'after'}:${from}:${to}:${basis}`
    if (!reports.has(key)) reports.set(key, reportFigures(source, from, to, basis))
    return reports.get(key)!
  }
  const earliest = [...plan.dates].sort()[0] ?? day
  const [beforeAccrual, afterAccrual, beforeCash, afterCash, locks, issued] = await Promise.all([
    figures(db, range.start, range.end, 'accrual'), figures(projected, range.start, range.end, 'accrual'),
    figures(db, range.start, range.end, 'cash'), figures(projected, range.start, range.end, 'cash'),
    affectedLocks(db, projected, earliest, figures), affectedIssues(db, projected, earliest, figures),
  ])
  for (const lockDate of plan.lockDates ?? []) {
    for (const lock of await all(db, "SELECT id, start_date, end_date, locked_by, locked_at, revision FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", lockDate)) {
      if (!locks.some(l => l.id === lock.id)) locks.push({ ...lock, reopenRequest: (await one(db, "SELECT id FROM pt_reopen_requests WHERE period = ? AND status = 'pending'", lock.id))?.id ?? null })
    }
  }
  requireThat(auditCount === await effectsFence(db), 'The books changed while computing effects; preview again', 409)
  return {
    date: day, period: day.slice(0, 7), auditCount,
    token: await sha256(JSON.stringify({ identity, day, auditCount })),
    netIncome: { before: beforeAccrual.profitAndLoss.netIncome, after: afterAccrual.profitAndLoss.netIncome },
    bases: { accrual: { before: beforeAccrual, after: afterAccrual }, cash: { before: beforeCash, after: afterCash } },
    locks: locks.map(l => ({ ...l, name: monthName(l.id) })), issued,
  }
}
