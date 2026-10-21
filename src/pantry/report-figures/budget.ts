// Budget versus actual: actuals open to their posted rows on the report's
// basis, budget figures to the plan's account/month cells with their prorated
// share, variance to actual rows less budget rows, and percentages to their
// operands and rule.
import { monthName, requireThat, type Data } from '../core'
import { all } from '../db'
import type { Basis } from '../basis'
import { reportSourceRows } from '../report-sources'
import { budget } from '../budgets/commands'
import { budgetReport, plannedShare } from '../budgets/report'
import { figureResult, less, parseLine, percentResult, tagged } from './result'

type Query = { line: string; from: string; to: string; basis: Basis; budget?: string }
const METRICS: Record<string, string> = { budget: 'budget', actual: 'actual', variance: 'variance', percent: 'variance %' }
const half = (amount: number, n: number, d: number) => Math.sign(amount) * Number((BigInt(Math.abs(amount)) * BigInt(n) * 2n + BigInt(d)) / (2n * BigInt(d)))

export async function budgetFigure(db: D1Database, q: Query) {
  requireThat(q.budget, 'Choose a budget', 404)
  const [accountId, metric] = parseLine(q.line, [2, 2], 'Choose a budget figure')
  const report = await budgetReport(db, q.budget, q.from, q.to, q.basis), plan = await budget(db, q.budget)
  const row: Data | undefined = accountId === 'net-income' ? { id: 'net-income', code: '', name: 'Net income', ...report.netIncome } : report.rows.find(r => r.id === accountId)
  requireThat(row && METRICS[metric], 'Choose a budget figure', 404)
  const accounts = new Map<string, Data>((await all(db, "SELECT id, code, name, type FROM pt_accounts WHERE type IN ('income', 'expense')")).map(a => [a.id, a]))
  const net = accountId === 'net-income'
  const label = `${row.code ? `${row.code} · ` : ''}${row.name} · ${METRICS[metric]}`
  const context = { budget: plan.id, budgetName: plan.name, revision: plan.revision, budgetBasis: plan.basis }
  const base = { report: 'budget-actual', line: q.line, label, basis: q.basis, from: q.from, to: q.to, context }
  const actual = async () => net ? reportSourceRows(db, { types: ['income', 'expense'], from: q.from, to: q.to, sign: -1 }, q.basis)
    : reportSourceRows(db, { accountId, types: [], from: q.from, to: q.to, sign: accounts.get(accountId)?.type === 'income' ? -1 : 1 }, q.basis)
  const planned = () => plan.cells.filter(c => net ? accounts.has(c.account_id) : c.account_id === accountId).flatMap(c => {
    const share = plannedShare(c, q.from, q.to), a = accounts.get(c.account_id)
    if (!share || !a) return []
    const sign = net && a.type === 'expense' ? -1 : 1, amount = sign * share.amount
    return [{ key: `${c.account_id}:${c.month}`, date: share.start, account: { id: a.id, code: a.code, name: a.name }, amount, debit: Math.max(amount, 0), credit: Math.max(-amount, 0),
      description: `Budget ${plan.name} · ${monthName(c.month)} · ${share.days} of ${share.monthDays} days of ${(c.amount_cents / 100).toFixed(2)}${sign < 0 ? ' (expense, less)' : ''}`,
      lineMemo: '', entry: null, settlement: null, documents: [], bank: [], record: { kind: 'budget', id: plan.id, label: `Budget ${plan.name}`, href: `/app/reports?report=budget-actual&from=${q.from}&to=${q.to}&basis=${q.basis}` } }]
  })
  if (metric === 'percent') return percentResult({ ...base, figure: row.percent, expression: 'Variance ÷ |Budget| × 100, rounded half away from zero to 2 decimal places; not comparable when Budget is zero',
    operands: [{ label: 'Variance', value: row.variance, line: JSON.stringify([accountId, 'variance']) }, { label: 'Budget', value: row.budget, line: JSON.stringify([accountId, 'budget']) }],
    recomputed: row.budget === 0 ? null : half(row.variance, 10000, Math.abs(row.budget)) / 100 })
  const rows = metric === 'actual' ? await actual() : metric === 'budget' ? planned() : [...tagged(await actual(), 'actual'), ...less(planned(), 'budget')]
  return figureResult({ ...base, figure: row[metric], rows, scopeNote: metric === 'budget' ? 'Plan cells prorated by inclusive calendar days, rounded to cents per account and month.' : metric === 'variance' ? 'Actual lines less budget cells.' : undefined })
}
