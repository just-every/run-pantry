// Sales tax by state and tax code for a period, INVOICE-010's early-payment
// columns when discounts were taken, and its tie to the ledger's sales tax
// liability accounts. Every amount opens to the lines behind it.
import { Link, useSearch } from '@tanstack/react-router'
import { AskAccountant } from './ask-accountant'
import { Chip, Table, usd, type D } from './kit'

const rate = (milli: number) => `${(milli / 1000).toFixed(3)}%`

export function SalesTax({ r }: { r: D }) {
  const ask = (line: string, label: string) => <AskAccountant subjectKind="report-line" subjectId={JSON.stringify({ report: 'sales-tax', line, from: r.from, to: r.to, basis: r.basis })} label={`${label} · ${r.from} to ${r.to}`} />
  const cash = r.basis === 'cash', search = useSearch({ from: '/app/reports' })
  const open = (line: unknown[], amount: number) => <Link to="/app/reports" search={{ ...search, line: JSON.stringify(line), record: undefined }} className="figure-link">{usd(amount)}</Link>
  const early = r.states.some((s: D) => s.early.kept || s.early.reduced || s.early.taxReduced)
  const heads = ['Tax code', 'Rate', cash ? 'Taxable sales paid' : 'Taxable sales', ...(cash ? [] : ['Tax charged']), 'Tax collected', 'Tax owed', ...(early ? r.earlyColumns : [])]
  const figures = (scope: string[], row: D) => [open([...scope, 'taxable'], row.taxable), ...(cash ? [] : [open([...scope, 'charged'], row.charged)]), open([...scope, 'collected'], row.collected), open([...scope, 'owed'], row.owed),
    ...(early ? [open([...scope, 'kept'], row.early.kept), open([...scope, 'reduced'], row.early.reduced), open([...scope, 'taxReduced'], row.early.taxReduced)] : [])]
  return <>
    <p className="hint">{cash ? 'Cash basis: sales and tax count when customers pay; tax owed is the tax collected.' : 'Accrual basis: sales and tax count when an invoice is issued, less credits issued; tax collected is what customers paid in the period.'} Rates are the ones your business entered; Pantry files no returns.</p>
    {r.states.length ? r.states.map((s: D) => <div key={s.state || 'none'} className="gl-account"><h3>{s.state || 'State not set'}</h3>
      <Table heads={heads} figures={heads.map((_, i) => i).slice(1)}>
        {[...s.codes.map((c: D) => <tr key={c.id}><td>{c.name}{ask(`code:${c.id}`, `${s.state} · ${c.name}`)}</td><td className="fig">{rate(c.rate)}</td>{figures(['code', c.id], c).map((f, i) => <td key={i} className="fig">{f}</td>)}</tr>),
          <tr key="total" className="total"><td>Total {s.state || 'without a state'}</td><td />{figures(['state', s.state], s).map((f, i) => <td key={i} className="fig">{f}</td>)}</tr>]}
      </Table></div>) : <p>No sales tax codes yet. Add them under Books › Sales tax.</p>}
    <Table heads={['', 'Amount']} figures={[1]}>
      <tr><td>Exempt sales {cash ? 'paid' : 'invoiced'} in the period{ask('exempt', 'Exempt sales')}</td><td className="fig">{open(['exempt', 'taxable'], r.exempt)}</td></tr>
      {r.earlyExempt !== 0 && <tr><td>Early-payment discounts on exempt sales (for information)</td><td className="fig">{open(['exempt', 'exempt'], r.earlyExempt)}</td></tr>}
      <tr className="total"><td>Tax owed for the period, all states{ask('total', 'Tax owed, all states')}</td><td className="fig">{open(['total', 'owed'], r.totals.owed)}</td></tr>
    </Table>
    <div className="gl-account"><h3>Tie to the ledger {r.ledger.ties ? <Chip tone="good">Ties</Chip> : <Chip tone="bad">Does not tie</Chip>}</h3>
      <Table heads={['Liability account', 'Opening', 'From invoices and credits', 'Paid to the state and other', 'Closing', 'Tax owed above']} figures={[1, 2, 3, 4, 5]}>
        {r.ledger.accounts.map((a: D) => <tr key={a.id}><td>{a.code} · {a.name}{ask(`account:${a.id}`, `${a.code} · ${a.name}`)}</td><td className="fig">{open(['account', a.id, 'opening'], a.opening)}</td><td className="fig">{open(['account', a.id, 'fromSales'], a.fromSales)}</td><td className="fig">{open(['account', a.id, 'other'], a.other)}</td><td className="fig">{open(['account', a.id, 'closing'], a.closing)}</td><td className="fig">{open(['account', a.id, 'owed'], a.owed)} {a.ties ? '' : '≠'}</td></tr>)}
      </Table></div>
  </>
}
