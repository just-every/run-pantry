// Every figure on the profit and loss and the balance sheet opens to the lines
// behind it: the posting (or, on the cash basis, the settled share of an
// invoice, credit or bill), the record it came from, what settled it, its
// documents and the bank statement lines it was matched to. The rows are read
// separately from the report and must add up to the report's own figure.
import { longDay, requireThat } from './core'
import { all } from './db'
import type { Basis } from './basis'
import { balanceSheet, prevDay, profitAndLoss } from './reports'
import { reportSourceRows } from './report-sources'
import { ledgerFigureDetail } from './ledger-drill'

type Scope = { label: string; types: string[]; accountId?: string; from: string; to: string; sign: 1 | -1; figure: number }

const START = '0000-01-01'

async function scope(db: D1Database, report: string, line: string, from: string, to: string, basis: Basis, startMonth: number): Promise<Scope> {
  const accounts = new Map((await all(db, 'SELECT id, code, name, type FROM pt_accounts')).map(a => [a.id, a]))
  const account = accounts.get(line)
  const natural = (type: string): 1 | -1 => type === 'asset' || type === 'expense' ? 1 : -1
  if (report === 'profit-and-loss') {
    const pl = await profitAndLoss(db, from, to, basis)
    if (account) {
      requireThat(account.type === 'income' || account.type === 'expense', 'That account is not on the profit and loss')
      const row = [...pl.income, ...pl.expenses].find(r => r.id === line)
      return { label: `${account.code} · ${account.name}`, types: [], accountId: line, from, to, sign: natural(account.type), figure: row?.amount ?? 0 }
    }
    if (line === 'income') return { label: 'Total income', types: ['income'], from, to, sign: -1, figure: pl.totalIncome }
    if (line === 'expenses') return { label: 'Total expenses', types: ['expense'], from, to, sign: 1, figure: pl.totalExpenses }
    if (line === 'net-income') return { label: 'Net income', types: ['income', 'expense'], from, to, sign: -1, figure: pl.netIncome }
  }
  if (report === 'balance-sheet') {
    const bs = await balanceSheet(db, to, startMonth, basis)
    if (account) {
      requireThat(['asset', 'liability', 'equity'].includes(account.type), 'That account is not on the balance sheet')
      const row = [...bs.assets, ...bs.liabilities, ...bs.equity].find(r => r.id === line)
      return { label: `${account.code} · ${account.name}`, types: [], accountId: line, from: START, to, sign: natural(account.type), figure: row?.amount ?? 0 }
    }
    const earnings = (id: string) => bs.equity.find(r => r.id === id)?.amount ?? 0
    if (line === 'assets') return { label: 'Total assets', types: ['asset'], from: START, to, sign: 1, figure: bs.totalAssets }
    if (line === 'liabilities') return { label: 'Total liabilities', types: ['liability'], from: START, to, sign: -1, figure: bs.totalLiabilities }
    // Equity includes the calculated earnings lines, so it opens to every income and expense line too.
    if (line === 'equity') return { label: 'Total equity', types: ['equity', 'income', 'expense'], from: START, to, sign: -1, figure: bs.totalEquity }
    if (line === 'liabilities-and-equity') return { label: 'Liabilities and equity', types: ['liability', 'equity', 'income', 'expense'], from: START, to, sign: -1, figure: bs.totalLiabilities + bs.totalEquity }
    if (line === 'current-earnings') return { label: `Net income since ${longDay(bs.fyStart)} (calculated)`, types: ['income', 'expense'], from: bs.fyStart, to, sign: -1, figure: earnings('current-earnings') }
    if (line === 'prior-earnings') return { label: "Prior years' earnings (calculated)", types: ['income', 'expense'], from: START, to: prevDay(bs.fyStart), sign: -1, figure: earnings('prior-earnings') }
  }
  requireThat(false, 'Choose a figure on the profit and loss or the balance sheet', 404)
  throw new Error('unreachable')
}

export async function figureDetail(db: D1Database, q: { report: string; line: string; from: string; to: string; basis: Basis; account?: string }, startMonth: number) {
  requireThat(q.from <= q.to, 'The end date is on or after the start date')
  if (q.report === 'trial-balance' || q.report === 'general-ledger') return ledgerFigureDetail(db, q)
  const s = await scope(db, q.report, q.line, q.from, q.to, q.basis, startMonth)
  const rows = await reportSourceRows(db, s, q.basis)
  const total = rows.reduce((t, r) => t + r.amount, 0)
  return { basis: q.basis, report: q.report, line: q.line, label: s.label, from: s.from === START ? null : s.from, to: s.to, figure: s.figure, rows, total, ties: total === s.figure }
}
