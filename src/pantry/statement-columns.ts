// Financial statement columns are independent reads of the same posted ledger.
import { addDays, daysBetween, monthName, requireThat, type Data } from './core'
import { all } from './db'
import { balanceSheet, fiscalYearStart, generalLedger, prevDay, profitAndLoss } from './reports'
import type { Basis } from './basis'

type Kind = 'profit-and-loss' | 'balance-sheet'
type Column = { id: string; label: string; from: string; to: string; unit: 'money' | 'percent' }
type Line = { id: string; code: string; name: string; section: string; amount: number }
type Snapshot = { rows: Line[]; totals: Line[] }
export type StatementColumns = { kind: Kind; mode: string; basis: Basis; from: string; to: string; columns: Column[]; rows: MatrixLine[]; totals: MatrixLine[] }
type MatrixLine = Omit<Line, 'amount'> & { values: (number | null)[] }

function monthAfter(day: string, months: number) {
  const [y, m] = day.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1 + months, 1)).toISOString().slice(0, 10)
}
function yearBefore(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  const last = new Date(Date.UTC(y - 1, m, 0)).getUTCDate()
  return `${y - 1}-${String(m).padStart(2, '0')}-${String(Math.min(d, last)).padStart(2, '0')}`
}
function changePercent(change: number, prior: number): number | null {
  if (prior === 0) return null
  const numerator = BigInt(Math.abs(change)) * 10000n, denominator = BigInt(Math.abs(prior))
  const rounded = (2n * numerator + denominator) / (2n * denominator)
  return Number(rounded) / 100 * Math.sign(change)
}
const line = (id: string, name: string, amount: number, section = ({ income: 'Income', expenses: 'Expenses', assets: 'Assets', liabilities: 'Liabilities', equity: 'Equity' } as Record<string, string>)[id] ?? ''): Line => ({ id, code: '', name, amount, section })
async function snapshot(db: D1Database, kind: Kind, from: string, to: string, startMonth: number, basis: Basis): Promise<Snapshot> {
  const r: Data = kind === 'profit-and-loss' ? await profitAndLoss(db, from, to, basis) : await balanceSheet(db, to, startMonth, basis)
  const sections: [string, string][] = kind === 'profit-and-loss' ? [['Income', 'income'], ['Expenses', 'expenses']] : [['Assets', 'assets'], ['Liabilities', 'liabilities'], ['Equity', 'equity']]
  return {
    rows: sections.flatMap(([section, key]) => r[key].map((l: Data) => ({ id: l.id, code: l.code, name: l.id === 'current-earnings' ? 'Current fiscal-year earnings (calculated)' : l.name, section, amount: l.amount }))),
    totals: kind === 'profit-and-loss' ? [line('income', 'Total income', r.totalIncome), line('expenses', 'Total expenses', r.totalExpenses), line('net-income', 'Net income', r.netIncome)] : [line('assets', 'Total assets', r.totalAssets), line('liabilities', 'Total liabilities', r.totalLiabilities), line('equity', 'Total equity', r.totalEquity), line('liabilities-and-equity', 'Liabilities and equity', r.totalLiabilities + r.totalEquity)],
  }
}
function matrix(snapshots: Snapshot[], key: 'rows' | 'totals'): MatrixLine[] {
  const lines = new Map<string, Line>()
  for (const s of snapshots) for (const l of s[key]) lines.set(l.id, l)
  return [...lines.values()].map(({ amount, ...l }) => ({ ...l, values: snapshots.map(s => s[key].find(x => x.id === l.id)?.amount ?? 0) }))
}

export async function statementColumns(db: D1Database, kind: Kind, mode: string, from: string, to: string, startMonth: number, basis: Basis): Promise<StatementColumns> {
  requireThat(from <= to, 'From must be on or before To')
  requireThat(['prior-period', 'prior-year', 'months', 'quarters', 'ytd', 'customer'].includes(mode), 'Choose comparison, months, quarters, year to date or customer columns')
  if (mode === 'customer') {
    requireThat(kind === 'profit-and-loss', 'Customer columns are for profit and loss')
    return customerColumns(db, from, to, basis)
  }
  const columns: Column[] = [], snapshots: Snapshot[] = []
  const add = async (id: string, label: string, a: string, b: string) => {
    columns.push({ id, label, from: a, to: b, unit: 'money' })
    snapshots.push(await snapshot(db, kind, a, b, startMonth, basis))
  }
  const fy = fiscalYearStart(to, startMonth)
  if (mode === 'months' || mode === 'quarters') {
    const step = mode === 'months' ? 1 : 3
    for (let i = 0; i < 12; i += step) {
      const a = monthAfter(fy, i), b = prevDay(monthAfter(fy, i + step))
      await add(a, step === 1 ? monthName(a.slice(0, 7)) : `Q${i / 3 + 1} · ${a} to ${b}`, a, b)
    }
  } else if (mode === 'ytd') await add('ytd', `Year to date · ${fy} to ${to}`, fy, to)
  else {
    await add('current', `Current · ${kind === 'balance-sheet' ? to : `${from} to ${to}`}`, from, to)
    const a = mode === 'prior-year' ? yearBefore(from) : addDays(from, -daysBetween(from, to) - 1)
    const b = mode === 'prior-year' ? yearBefore(to) : prevDay(from)
    await add('prior', `Prior · ${kind === 'balance-sheet' ? b : `${a} to ${b}`}`, a, b)
  }
  const rows = matrix(snapshots, 'rows'), totals = matrix(snapshots, 'totals')
  if (mode === 'prior-period' || mode === 'prior-year') {
    columns.push({ id: 'change', label: 'Change', from, to, unit: 'money' }, { id: 'percent', label: 'Change %', from, to, unit: 'percent' })
    for (const l of [...rows, ...totals]) {
      const [current, prior] = l.values as number[], change = current - prior
      l.values.push(change, changePercent(change, prior))
    }
  }
  return { kind, mode, basis, from, to, columns, rows, totals }
}

async function customerColumns(db: D1Database, from: string, to: string, basis: Basis): Promise<StatementColumns> {
  const contacts = new Map((await all(db, "SELECT id, name FROM pt_contacts WHERE kind = 'customer'")).map(c => [c.id, c.name]))
  const sources = new Map((await all(db, `SELECT e.id, i.customer_id FROM pt_journal_entries e JOIN pt_invoices i ON i.journal_id = COALESCE(e.reverses_id, e.id)`)).map(e => [e.id, e.customer_id]))
  const groups = new Map<string, { name: string; rows: Line[] }>()
  const ledger = await generalLedger(db, from, to, undefined, basis)
  for (const account of ledger.accounts.filter(a => a.type === 'income' || a.type === 'expense')) for (const l of account.rows) {
    const contactId = l.contact_id || sources.get(l.entry_id), id = contacts.has(contactId) ? contactId : 'unassigned'
    const group: { name: string; rows: Line[] } = groups.get(id) ?? { name: contacts.get(id) ?? 'Unassigned', rows: [] }
    let row = group.rows.find(r => r.id === account.id)
    if (!row) { row = { id: account.id, code: account.code, name: account.name, section: account.type === 'income' ? 'Income' : 'Expenses', amount: 0 }; group.rows.push(row) }
    row.amount += (l.debit_cents - l.credit_cents) * (account.type === 'income' ? -1 : 1)
    groups.set(id, group)
  }
  const entries = [...groups].sort((a, b) => a[1].name.localeCompare(b[1].name))
  const columns: Column[] = entries.map(([id, g]) => ({ id, label: g.name, from, to, unit: 'money' }))
  const snapshots: Snapshot[] = entries.map(([, g]) => {
    const income = g.rows.filter(l => l.section === 'Income').reduce((s, l) => s + l.amount, 0), expenses = g.rows.filter(l => l.section === 'Expenses').reduce((s, l) => s + l.amount, 0)
    return { rows: g.rows, totals: [line('income', 'Total income', income), line('expenses', 'Total expenses', expenses), line('net-income', 'Net income', income - expenses)] }
  })
  columns.push({ id: 'total', label: 'Total', from, to, unit: 'money' })
  snapshots.push(await snapshot(db, 'profit-and-loss', from, to, 1, basis))
  return { kind: 'profit-and-loss', mode: 'customer', basis, from, to, columns, rows: matrix(snapshots, 'rows'), totals: matrix(snapshots, 'totals') }
}
