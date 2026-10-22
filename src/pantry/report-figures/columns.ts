// Statement comparison, period and customer columns, and the cash-basis bridge:
// each money cell opens to the native statement figure for its column's own
// range; change cells to the current rows less the prior rows; percentages to
// their operands and rule.
import { requireThat, type Data } from '../core'
import { all } from '../db'
import { sameOnCash, type Basis } from '../basis'
import { figureDetail } from '../drilldown'
import { profitAndLoss } from '../reports'
import { reportSourceRows } from '../report-sources'
import { changePercent, customerGrouping, statementColumns } from '../statement-columns'
import { groupedRows } from './groups'
import { figureResult, less, percentResult, tagged } from './result'

type Query = { report: string; line: string; from: string; to: string; basis: Basis; columns?: string; column?: string }
const TOTALS: Record<string, [string[], 1 | -1]> = { income: [['income'], -1], expenses: [['expense'], 1], 'net-income': [['income', 'expense'], -1] }

export async function columnFigure(db: D1Database, q: Query, startMonth: number) {
  const kind = q.report as 'profit-and-loss' | 'balance-sheet'
  const r = await statementColumns(db, kind, q.columns!, q.from, q.to, startMonth, q.basis)
  const index = r.columns.findIndex(c => c.id === q.column), row = [...r.rows, ...r.totals].find(x => x.id === q.line)
  requireThat(index >= 0 && row, 'Choose a figure on this statement', 404)
  const column = r.columns[index], figure = row.values[index]
  const label = `${row.code ? `${row.code} · ` : ''}${row.name} · ${column.label}`
  const context = { columns: r.mode, column: column.id, columnLabel: column.label, columnFrom: column.from, columnTo: column.to }
  const base = { report: kind, line: q.line, label, basis: q.basis, to: column.to, context }
  const native = async (id: string) => {
    const c = r.columns.find(x => x.id === id)!
    if(['class','location','project'].includes(r.mode)&&id!=='total'){
      const rows=(await figureDetail(db,{report:kind,line:q.line,from:c.from,to:c.to,basis:q.basis},startMonth)).rows
      return rows.filter(row=>(row[`${r.mode}_name`]||'unassigned')===id)
    }
    if (r.mode !== 'customer' || id === 'total') return (await figureDetail(db, { report: kind, line: q.line, from: c.from, to: c.to, basis: q.basis }, startMonth)).rows
    const grouping = await customerGrouping(db), accounts = new Map((await all(db, 'SELECT id, type FROM pt_accounts')).map(a => [a.id, a.type]))
    const [types, sign] = TOTALS[q.line] ?? [[], accounts.get(q.line) === 'income' ? -1 : 1]
    return groupedRows(db, { types, accountId: TOTALS[q.line] ? undefined : q.line, of: grouping.of, selected: id, from: c.from, to: c.to, basis: q.basis, sign })
  }
  if (column.id === 'percent') {
    const [current, prior] = row.values as number[], change = current - prior
    return percentResult({ ...base, from: q.from, figure, expression: 'Change ÷ |Prior| × 100, rounded half away from zero to 2 decimal places; undefined (—) when Prior is zero',
      operands: [{ label: 'Change', value: change, line: q.line, column: 'change' }, { label: 'Prior', value: prior, line: q.line, column: 'prior' }], recomputed: changePercent(change, prior) })
  }
  const rows = column.id === 'change' ? [...tagged(await native('current'), 'current'), ...less(await native('prior'), 'prior')] : await native(column.id)
  const ranged = kind === 'profit-and-loss' || column.id === 'change'
  return figureResult({ ...base, from: ranged ? column.id === 'change' ? q.from : column.from : null, figure: figure as number, rows,
    scopeNote: column.id === 'change' ? 'Current-column lines less prior-column lines.' : `${column.label}${kind === 'balance-sheet' ? ` · all posted activity through ${column.to}` : ''}` })
}

const BRIDGE: Record<string, string> = { accrual: 'Net income on the accrual basis', recorded: 'Less invoices, credits and bills recorded in this period', settled: 'Plus the shares of them paid or credited in this period', cash: 'Net income on the cash basis' }

/** The four bridge figures from accrual to cash net income, each from native rows. */
export async function bridgeFigure(db: D1Database, q: Query, startMonth: number) {
  const metric = q.line.slice('bridge:'.length)
  requireThat(BRIDGE[metric] && q.basis === 'cash', 'Choose a figure on the accrual-to-cash bridge', 404)
  const b = (await profitAndLoss(db, q.from, q.to, 'cash') as Data).bridge
  const base = { report: 'profit-and-loss', line: q.line, label: BRIDGE[metric], from: q.from, to: q.to }
  if (metric === 'accrual' || metric === 'cash')
    return figureResult({ ...base, basis: metric, figure: metric === 'cash' ? b.cashNetIncome : b.accrualNetIncome, rows: (await figureDetail(db, { report: 'profit-and-loss', line: 'net-income', from: q.from, to: q.to, basis: metric }, startMonth)).rows })
  if (metric === 'recorded') {
    const documents = new Set((await all(db, `SELECT e.id FROM pt_journal_entries e WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND NOT ${sameOnCash()}`, q.from, q.to)).map(e => e.id))
    const rows = (await reportSourceRows(db, { types: ['income', 'expense'], from: q.from, to: q.to, sign: 1 }, 'accrual')).filter(r => documents.has(r.entry.id))
    return figureResult({ ...base, basis: 'accrual', basisLabel: 'Accrual basis · documents recorded in the range', figure: -b.recordedInRange, rows, scopeNote: 'Income and expense lines of invoices, credits and bills recorded in the range, as debits less credits.' })
  }
  const rows = (await reportSourceRows(db, { types: ['income', 'expense'], from: q.from, to: q.to, sign: -1 }, 'cash')).filter(r => String(r.key).startsWith('cash-'))
  return figureResult({ ...base, basis: 'cash', basisLabel: 'Cash basis · settled shares in the range', figure: b.settledInRange, rows, scopeNote: 'Shares of invoices, credits and bills paid or credited in the range.' })
}
