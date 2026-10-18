import { Link, useSearch } from '@tanstack/react-router'
import { Card, Chip, Field, Form, Loading, Table, command, day, usd, useShared, useView, type D } from './kit'

function Figure({ id, children }: { id: string; children: React.ReactNode }) {
  const search = useSearch({ from: '/app/reports' })
  return <Link className="figure-link" to="/app/reports" search={{ ...search, line: id, record: undefined }}>{children}</Link>
}

export function CashFlow({ from, to }: { from: string; to: string }) {
  const { data: r, error, reload } = useView<D>(`reports/cash-flow?from=${from}&to=${to}`), { state } = useShared()
  if (!r) return <Loading what="the cash-flow statement" error={error} />
  const sections: [string, D[], number, string][] = [['Operating activities', r.operating, r.totalOperating, 'operating'], ['Investing activities', r.investing, r.totalInvesting, 'investing'], ['Financing activities', r.financing, r.totalFinancing, 'financing']]
  return <>
    <p><Chip tone={r.ties ? 'good' : 'bad'}>{r.ties ? 'Ties to the balance sheet cash change' : 'Does not tie to the balance sheet'}</Chip></p>
    <p className="hint">Indirect method: accrual net income adjusted for working capital and noncash activity. Cash and cash equivalents: {r.cashAccounts.map((a: D) => a.name).join(', ') || 'none classified'}. Choose any figure to open its entries.</p>
    <p><a className="btn btn-secondary" download href={`/api/pantry/reports/cash-flow.csv?from=${from}&to=${to}`}>Cash-flow CSV</a></p>
    <Table heads={['Activity', 'Amount']} figures={[1]}>
      {[...sections.flatMap(([name, rows, total, id]) => [<tr className="section" key={id}><td colSpan={2}>{name}</td></tr>,
        ...rows.map(l => <tr key={l.id}><td><Figure id={l.id}>{l.name}</Figure></td><td className="fig"><Figure id={l.id}>{usd(l.amount)}</Figure></td></tr>),
        <tr className="total" key={`${id}-total`}><td><Figure id={id}>Net cash from {name.toLowerCase()}</Figure></td><td className="fig"><Figure id={id}>{usd(total)}</Figure></td></tr>]),
        ...[['Net change in cash', 'net-change', r.netChange], ['Opening cash', 'opening', r.opening], ['Closing cash', 'closing', r.closing]].map(([name, id, amount]) => <tr className="total" key={id}><td><Figure id={id}>{name}</Figure></td><td className="fig"><Figure id={id}>{usd(amount)}</Figure></td></tr>)]}
    </Table>
    {state.actor.can.record && <details className="details"><summary>Cash-flow account classes</summary><p>Defaults come from each account’s type and role. Changes apply to this report and future exports, including earlier periods. Income and expenses start in net income; a different class moves their cash activity to the chosen section.</p>
      {r.accounts.map((a: D) => <Form key={`${a.id}:${a.flowClass}`} label="Save class" submit={b => command('cash-flow.classify', { ...b, accountId: a.id })} onDone={reload}>
        <Field label={`${a.code} · ${a.name}`} name="class" defaultValue={a.flowClass} required options={['cash', 'operating', 'investing', 'financing'].filter(c => c !== 'cash' || a.type === 'asset').map(c => ({ value: c, label: c === 'cash' ? 'Cash and cash equivalents' : c[0].toUpperCase() + c.slice(1) }))} />
      </Form>)}
    </details>}
  </>
}

export function CashFlowDetail({ from, to, line }: { from: string; to: string; line: string }) {
  const search = useSearch({ from: '/app/reports' })
  const { data: r, error } = useView<D>(`reports/cash-flow/detail?from=${from}&to=${to}&line=${encodeURIComponent(line)}`)
  return <><nav className="crumbs"><Link to="/app/reports" search={{ ...search, line: undefined, record: undefined }}>Cash flow</Link>{r && <> / {r.label}</>}</nav>
    {!r ? <Loading what="the entries" error={error} /> : <Card title={r.label} actions={<strong>{usd(r.figure)}</strong>}>
      <p>{day(from)} to {day(to)} · Indirect method. These contributions add up to {usd(r.figure)}.</p>
      <Table heads={['Date', 'Entry', 'Account', 'Description', 'Contribution']} figures={[4]} empty="No posted entries contribute to this figure.">
        {r.rows.map((l: D) => <tr key={l.key}><td>{day(l.date)}</td><td><Link to="/app/reports" search={{ ...search, record: `entry:${l.entryId}` }}>Entry {l.number}</Link></td><td>{r.accounts.find((a: D) => a.id === l.accountId)?.name}</td><td>{l.description}</td><td className="fig">{usd(l.amount)}</td></tr>)}
      </Table>
    </Card>}
  </>
}
