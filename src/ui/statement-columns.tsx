import { Table, day, usd } from './kit'

export const COLUMN_MODES = [
  ['single', 'Single period'], ['prior-period', 'Prior period'], ['prior-year', 'Prior year'],
  ['months', 'Months'], ['quarters', 'Quarters'], ['ytd', 'Year to date'], ['customer', 'Customer'],
] as const
export type ColumnMode = typeof COLUMN_MODES[number][0]
type Section = 'Income' | 'Expenses' | 'Assets' | 'Liabilities' | 'Equity'
type Column = { id: string; label: string; from: string; to: string; unit: 'money' | 'percent' }
type Row = { id: string; code?: string; name: string; section: Section; values: (number | null)[] }
export type ColumnStatement = {
  kind: string; mode: ColumnMode; basis: string; from: string; to: string
  columns: Column[]; rows: Row[]; totals: Row[]
}

export function columnMode(value: string | undefined, kind: string): ColumnMode {
  return COLUMN_MODES.find(([id]) => id === value && (id !== 'customer' || kind === 'profit-and-loss'))?.[0] ?? 'single'
}

export function ColumnPicker({ mode, kind, onChange }: { mode: ColumnMode; kind: string; onChange: (mode: ColumnMode) => void }) {
  return <div className="field inline"><label htmlFor="r-columns">Columns</label>
    <select id="r-columns" value={mode} onChange={e => onChange(e.target.value as ColumnMode)}>
      {COLUMN_MODES.filter(([id]) => id !== 'customer' || kind === 'profit-and-loss').map(([id, label]) => <option key={id} value={id}>{label}</option>)}
    </select>
  </div>
}

const percent = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
const value = (n: number | null, column: Column) => n === null ? '—' : column.unit === 'percent' ? `${percent.format(n)}%` : usd(n)
const grand = (row: Row) => ['net-income', 'liabilities-and-equity'].includes(row.id)

export function StatementColumns({ report: r }: { report: ColumnStatement }) {
  const sections: Section[] = r.kind === 'profit-and-loss' ? ['Income', 'Expenses'] : ['Assets', 'Liabilities', 'Equity']
  const period = ['months', 'quarters', 'ytd'].includes(r.mode) ? [r.columns[0].from, r.columns[r.columns.length - 1].to] : [r.from, r.to]
  const render = (row: Row, total = false) => <tr role="row" key={row.id} className={total ? `total${grand(row) ? ' grand' : ''}` : undefined}>
    <td role="rowheader" aria-label={row.name}>{row.code ? `${row.code} · ` : ''}{row.name}</td>
    {r.columns.map((column, i) => <td key={column.id} className="fig" title={row.values[i] === null ? 'Percentage change is undefined when the prior value is zero' : undefined}>{value(row.values[i], column)}</td>)}
  </tr>
  return <>
    <p className="hint">{day(period[0])} to {day(period[1])} · {COLUMN_MODES.find(([id]) => id === r.mode)?.[1]}{r.columns.some(c => c.unit === 'percent') && ' · — means the prior value is zero.'}</p>
    <Table heads={['Account', ...r.columns.map(c => c.label)]} figures={r.columns.map((_, i) => i + 1)} caption={`${r.kind === 'profit-and-loss' ? 'Profit and loss' : 'Balance sheet'} · ${r.mode} · ${r.basis} basis`}>
      {[...sections.flatMap(section => [
        <tr role="row" key={section} className="section"><td colSpan={r.columns.length + 1}>{section}</td></tr>,
        ...r.rows.filter(row => row.section === section).map(row => render(row)),
        ...r.totals.filter(row => row.section === section && !grand(row)).map(row => render(row, true)),
      ]), ...r.totals.filter(grand).map(row => render(row, true))]}
    </Table>
  </>
}
