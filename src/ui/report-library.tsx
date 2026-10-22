import { Link, useSearch } from '@tanstack/react-router'
import { Loading, Table, usd, useView } from './kit'

export const LIBRARY_REPORTS = [
  ['Receivables summary', 'receivables-summary', false, true],
  ['Payables summary', 'payables-summary', false, true],
  ['Open invoices', 'open-invoices', false, true],
  ['Unpaid bills', 'unpaid-bills', false, true],
  ['Customer balances', 'customer-balances', false, true],
  ['Vendor balances', 'vendor-balances', false, true],
  ['Transactions', 'transactions', true, true],
  ['Journal', 'journal', true, true],
  ['Deposits', 'deposits', false, true],
  ['Check detail', 'check-detail', false, true],
  ['Reconciliation reports', 'reconciliations', false, true],
  ['Audit log', 'audit-log', false, true],
  ['1099 summary', 'contractor-summary', false, true],
] satisfies [string, string, boolean, boolean][]

export const isLibraryReport = (slug: string) => LIBRARY_REPORTS.some(r => r[1] === slug)
export const hasLibraryFilters = (slug: string) => slug === 'transactions' || slug === 'journal'

export function libraryBasisLabel(slug: string, basis: 'cash' | 'accrual') {
  if (hasLibraryFilters(slug)) return basis === 'cash' ? 'Cash basis' : 'Accrual basis'
  if (['deposits', 'check-detail', 'contractor-summary'].includes(slug)) return 'Payment basis'
  if (slug === 'reconciliations') return 'Statement reconciliation · accrual ledger'
  if (slug === 'audit-log') return 'Activity history'
  return 'Open items · accrual basis'
}

export function libraryQuery(slug: string, from: string, to: string, basis: 'cash' | 'accrual', account?: string, payee?: string, dimension?: string, dimensionValue?: string) {
  const query = new URLSearchParams({ from, to, basis })
  if (hasLibraryFilters(slug)) {
    if (account) query.set('account', account)
    if (payee) query.set('payee', payee)

  }
  if(dimension){query.set('dimension',dimension);query.set('dimensionValue',dimensionValue??'')}
  return query.toString()
}

type LibraryRow = { id: string; cells: (string | number)[]; record?: string; href?: string; details?: unknown }
type LibraryReport = {
  kind: string; title: string; basis: string; basisLabel: string; from: string; to: string; note: string
  columns: string[]; moneyColumns: number[]; rows: LibraryRow[]; totals: { label: string; amount: number }[]
}

/** The library shares one table contract; record links retain the complete report address. */
export function ReportLibrary({ slug, from, to, basis }: { slug: string; from: string; to: string; basis: 'cash' | 'accrual' }) {
  const search = useSearch({ from: '/app/reports' })
  const { data: report, error } = useView<LibraryReport>(`reports/${slug}?${libraryQuery(slug, from, to, basis, search.account, search.payee, search.dimension, search.dimensionValue)}`)
  if (!report) return <Loading error={error} what="the report" />
  // Money cells and totals open to the lines, payments, open items or statement behind them.
  const drill = slug !== 'audit-log'
  const figure = (id: string, index: number, amount: number) => drill ? <Link to="/app/reports" search={{ ...search, line: JSON.stringify([id, String(index)]), record: undefined }} className="figure-link">{usd(amount)}</Link> : usd(amount)
  const sources = report.rows.some(row => row.record || row.href), details = report.rows.some(row => row.details !== undefined && row.details !== null)
  return <>
    <p className="hint">{report.note}</p>
    <Table heads={[...report.columns, ...(sources ? ['Source'] : []), ...(details ? ['Details'] : [])]} figures={report.moneyColumns} caption={report.title} empty="No records in this range.">
      {report.rows.map(row => <tr key={row.id}>
        {row.cells.map((cell, index) => <td key={index} className={report.moneyColumns.includes(index) ? 'fig' : undefined}>{report.moneyColumns.includes(index) && typeof cell === 'number' ? figure(row.id, index, cell) : cell}</td>)}
        {sources && <td>{row.record ? <Link to="/app/reports" search={{ ...search, line: undefined, record: row.record }}>View record</Link> : row.href ? <a href={row.href}>View source</a> : '—'}</td>}
        {details && <td>{row.details !== undefined && row.details !== null && <details className="details"><summary>Details</summary><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(row.details, null, 2)}</pre></details>}</td>}
      </tr>)}
    </Table>
    {report.totals.length > 0 && <Table heads={['Total', 'Amount']} figures={[1]}>{report.totals.map((total, index) => <tr key={index} className="total"><td>{total.label}</td><td className="fig">{figure('total', index, total.amount)}</td></tr>)}</Table>}
  </>
}
