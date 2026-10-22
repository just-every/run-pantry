// Download the same calculated report as the screen, with an explicit basis.
import { dimensionScope } from './dimensions/scope'
import { xlsxResponse } from './xlsx'
import { Fault, requireThat, type Data } from './core'
import { one } from './db'
import { BASIS_LABEL, type Basis } from './basis'
import { balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports'
import { salesTax } from './sales-tax'
import { contactTotals } from './contact-totals'
import { salesByItem } from './items/report'
import { statementColumns } from './statement-columns'
import { statementExport } from './statement-export'
import { reportPdf } from './report-pdf'

type Row = { description: string; amount: number }
const money = (n: number) => (n / 100).toFixed(2)
const cell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`

export async function reportExport(db: D1Database, kind: string, from: string, to: string, basis: Basis, format: string, columns?: string, account?: string,dimension?:string,dimensionValue?:string) {
  requireThat(!dimension||['general-ledger','trial-balance'].includes(kind),'This report does not yet support a dimension filter',409)
  const scope=await dimensionScope(db,dimension,dimensionValue)
  const entity = await one(db, 'SELECT * FROM pt_entity WHERE id = 1')
  if (columns && columns !== 'single' && (kind === 'profit-and-loss' || kind === 'balance-sheet')) return statementExport(await statementColumns(db, kind, columns, from, to, Number(entity?.fiscal_year_start ?? 1), basis), entity?.legal_name ?? 'Pantry', format)
  let title: string, rows: Row[] = [], totals: Row[] = []
  const row = (description: string, amount: number) => ({ description, amount })
  const statement = (section: string, lines: Data[]) => lines.map(l => row(`${section} · ${l.code ? l.code + ' · ' : ''}${l.name}`, l.amount))
  if (kind === 'profit-and-loss') {
    title = 'Profit and loss'
    const r = await profitAndLoss(db, from, to, basis)
    rows = [...statement('Income', r.income), ...statement('Expenses', r.expenses)]
    totals = [row('Total income', r.totalIncome), row('Total expenses', r.totalExpenses), row('Net income', r.netIncome)]
  } else if (kind === 'balance-sheet') {
    title = 'Balance sheet'
    const r = await balanceSheet(db, to, Number(entity?.fiscal_year_start ?? 1), basis)
    rows = [...statement('Assets', r.assets), ...statement('Liabilities', r.liabilities), ...statement('Equity', r.equity)]
    totals = [row('Total assets', r.totalAssets), row('Total liabilities', r.totalLiabilities), row('Total equity', r.totalEquity), row('Liabilities and equity', r.totalLiabilities + r.totalEquity)]
  } else if (kind === 'trial-balance') {
    title = 'Trial balance'
    const r = await trialBalance(db, to, basis,scope)
    rows = r.rows.map(l => row(`${l.code} · ${l.name} · debit positive / credit negative`, l.net))
    totals = [row('Total debits', r.debit), row('Total credits', r.credit)]
  } else if (kind === 'general-ledger') {
    title = 'General ledger'
    const r = await generalLedger(db, from, to, account || undefined, basis,scope)
    rows = r.accounts.flatMap(a => [row(`${a.code} · ${a.name} · opening`, a.opening), ...a.rows.map((l: Data) => row(`${a.code} · ${l.entry_date} · ${l.entry_memo} · ${l.memo}`, l.debit_cents - l.credit_cents)), row(`${a.code} · closing`, a.closing)])
  } else if (kind === 'sales-by-customer' || kind === 'expenses-by-vendor') {
    title = kind === 'sales-by-customer' ? 'Sales by customer' : 'Expenses by vendor'
    const r = await contactTotals(db, kind === 'sales-by-customer' ? 'customer' : 'vendor', from, to, basis)
    rows = r.rows.map(l => row(l.name, l.amount)); totals = [row('Total', r.total)]
  } else if (kind === 'sales-by-item') {
    title = 'Sales by item'
    const r = await salesByItem(db, from, to, basis)
    rows = r.rows.map(l => row(l.sku ? `${l.name} · ${l.sku}` : l.name, l.amount)); totals = [row('Total', r.total)]
  } else if (kind === 'sales-tax') {
    title = 'Sales tax by state'
    const r = await salesTax(db, from, to, basis)
    rows = r.states.flatMap(s => s.codes.flatMap((c: Data) => [row(`${s.state} · ${c.name} · taxable sales`, c.taxable), row(`${s.state} · ${c.name} · tax owed`, c.owed)]))
    totals = [row('Tax owed', r.totals.owed)]
  } else throw new Fault(404, 'Choose a financial report to export')
  if(scope)title+=` · ${scope.label}`
  const range = ['trial-balance', 'balance-sheet'].includes(kind) ? `As of ${to}` : `${from} to ${to}`
  const name = `${kind}-${to}-${basis}.${format}`
  const headers = { 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'no-store', 'x-pantry-basis': BASIS_LABEL[basis] }
  if (format === 'xlsx') return xlsxResponse([[entity?.legal_name ?? 'Pantry', title, range, BASIS_LABEL[basis]], ['Description', 'Amount (USD)', 'Basis'], ...[...rows, ...totals].map(l => [l.description, l.amount / 100, BASIS_LABEL[basis]])], `${kind}-${to}-${basis}`, { 'x-pantry-basis': BASIS_LABEL[basis] })
  if (format === 'pdf') return new Response(reportPdf({ business: entity?.legal_name ?? 'Pantry', title, basis: BASIS_LABEL[basis], range, rows, totals }), { headers: { ...headers, 'content-type': 'application/pdf' } })
  if (format === 'csv') return new Response([[title, range, 'Amount (USD)', 'Basis'], ...[...rows, ...totals].map(l => [l.description, '', money(l.amount), BASIS_LABEL[basis]])].map(r => r.map(cell).join(',')).join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' } })
  throw new Fault(400, 'Export format is pdf, csv or xlsx')
}
