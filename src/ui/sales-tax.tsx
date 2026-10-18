// Sales tax by state and tax code for a period, and its tie to the ledger's
// sales tax liability accounts.
import { AskAccountant } from './ask-accountant'
import { Chip, Table, usd, type D } from './kit'

const rate = (milli: number) => `${(milli / 1000).toFixed(3)}%`

export function SalesTax({ r }: { r: D }) {
  const ask = (line: string, label: string) => <AskAccountant subjectKind="report-line" subjectId={JSON.stringify({ report: 'sales-tax', line, from: r.from, to: r.to, basis: r.basis })} label={`${label} · ${r.from} to ${r.to}`} />
  const cash = r.basis === 'cash'
  const heads = ['Tax code', 'Rate', cash ? 'Taxable sales paid' : 'Taxable sales', ...(cash ? [] : ['Tax charged']), 'Tax collected', 'Tax owed']
  const figures = (row: D) => [usd(row.taxable), ...(cash ? [] : [usd(row.charged)]), usd(row.collected), usd(row.owed)]
  return <>
    <p className="hint">{cash ? 'Cash basis: sales and tax count when customers pay; tax owed is the tax collected.' : 'Accrual basis: sales and tax count when an invoice is issued, less credits issued; tax collected is what customers paid in the period.'} Rates are the ones your business entered; Pantry files no returns.</p>
    {r.states.length ? r.states.map((s: D) => <div key={s.state || 'none'} className="gl-account"><h3>{s.state || 'State not set'}</h3>
      <Table heads={heads} figures={heads.map((_, i) => i).slice(1)}>
        {[...s.codes.map((c: D) => <tr key={c.id}><td>{c.name}{ask(`code:${c.id}`, `${s.state} · ${c.name}`)}</td><td className="fig">{rate(c.rate)}</td>{figures(c).map((f, i) => <td key={i} className="fig">{f}</td>)}</tr>),
          <tr key="total" className="total"><td>Total {s.state || 'without a state'}</td><td />{figures(s).map((f, i) => <td key={i} className="fig">{f}</td>)}</tr>]}
      </Table></div>) : <p>No sales tax codes yet. Add them under Books › Sales tax.</p>}
    <Table heads={['', 'Amount']} figures={[1]}>
      <tr><td>Exempt sales {cash ? 'paid' : 'invoiced'} in the period{ask('exempt', 'Exempt sales')}</td><td className="fig">{usd(r.exempt)}</td></tr>
      <tr className="total"><td>Tax owed for the period, all states{ask('total', 'Tax owed, all states')}</td><td className="fig">{usd(r.totals.owed)}</td></tr>
    </Table>
    <div className="gl-account"><h3>Tie to the ledger {r.ledger.ties ? <Chip tone="good">Ties</Chip> : <Chip tone="bad">Does not tie</Chip>}</h3>
      <Table heads={['Liability account', 'Opening', 'From invoices and credits', 'Paid to the state and other', 'Closing', 'Tax owed above']} figures={[1, 2, 3, 4, 5]}>
        {r.ledger.accounts.map((a: D) => <tr key={a.id}><td>{a.code} · {a.name}{ask(`account:${a.id}`, `${a.code} · ${a.name}`)}</td><td className="fig">{usd(a.opening)}</td><td className="fig">{usd(a.fromSales)}</td><td className="fig">{usd(a.other)}</td><td className="fig">{usd(a.closing)}</td><td className="fig">{usd(a.owed)} {a.ties ? '' : '≠'}</td></tr>)}
      </Table></div>
  </>
}
