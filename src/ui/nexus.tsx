// Economic nexus watch: each state's sales and invoices over its measuring
// period against the versioned threshold table, the 80% and 100% alerts, and
// the accountant's recorded decision on the state's row.
import { Card, Chip, command, day, Field, Form, Loading, Table, usd, useShared, useView, type D } from './kit'

const DECISION: Record<string, string> = { register: 'Register to collect', 'not-required': 'Registration not required', monitor: 'Keep watching' }
const EMAILED: Record<string, string> = { accepted: 'emailed', development: 'not emailed: this computer sends no mail', 'in-app': 'not emailed: no mail provider is set up', failed: 'email failed', uncertain: 'email not confirmed by the mail provider', pending: 'email pending' }
const pct = (bp: number) => `${(bp / 100).toFixed(1)}%`

function threshold(s: D) {
  const sales = usd(s.thresholdSales)
  return s.test === 'sales' ? `${sales} sales` : `${sales} sales ${s.test} ${s.thresholdTransactions} invoices`
}

export function NexusWatch() {
  const { state } = useShared(), v = useView<D>('sales-tax/nexus')
  if (!v.data) return <Loading error={v.error} what="economic nexus watch" />
  const r = v.data, watched = r.states.filter((s: D) => s.sales || s.transactions || s.alerts.length || s.decision)
  const accountant = state.actor.role === 'accountant'
  return <Card title="Economic nexus watch">
    <p className="hint">Sales are invoice lines before sales tax, including exempt lines, less credits, by ship-to state (else the line’s tax code state). Alerts go to the owner and accountants at 80% and 100% of a threshold. {r.note} Table {r.version}.</p>
    {r.unassigned.documents > 0 && <p className="error">{r.unassigned.documents} invoice{r.unassigned.documents === 1 ? '' : 's'} ({usd(r.unassigned.sales)}) since last January have no destination state and are not counted.</p>}
    <Table heads={['State', 'Threshold', 'Period', 'Sales', 'Invoices', 'Reached', 'Accountant’s decision']} figures={[3, 4, 5]} empty="No sales by destination state yet." caption="Economic nexus by state">
      {watched.map((s: D) => <tr key={s.state}>
        <td>{s.state}{s.level ? <> <Chip tone={s.level === 100 ? 'bad' : 'warn'}>{s.level}% alert</Chip></> : null}</td>
        <td>{threshold(s)}<small className="sub"> · {s.rule} · <a href={s.source.split(' · ')[1]} target="_blank" rel="noreferrer">{s.source.split(' · ')[0]}</a></small></td>
        <td>{s.period}</td><td className="fig">{usd(s.sales)}</td><td className="fig">{s.transactions}</td><td className="fig">{pct(s.reached)}</td>
        <td>{s.decision ? <>{DECISION[s.decision.decision]}<small className="sub"> · {s.decision.note} · {s.decision.decided_by}, {day(s.decision.decided_at.slice(0, 10))}</small></> : '—'}</td>
      </tr>)}
    </Table>
    {watched.some((s: D) => s.alerts.length) && <><h3>Alerts</h3><ul>
      {watched.flatMap((s: D) => s.alerts.map((a: D) => <li key={a.id}>{s.state} reached {a.level}% · {a.period} · {usd(a.sales_cents)}, {a.transactions} invoices · {day(a.raised_at.slice(0, 10))}{a.resolved_at ? ' · since fell back' : ''} · {EMAILED[a.email_status] ?? a.email_status}</li>))}
    </ul></>}
    {accountant ? <Form label="Record decision" submit={b => command('nexus.decide', b)} onDone={v.reload} className="grid-form">
      <Field label="State" name="state" required options={r.states.map((s: D) => ({ value: s.state, label: `${s.state} · ${pct(s.reached)}` }))} />
      <Field label="Decision" name="decision" required options={Object.entries(DECISION).map(([value, label]) => ({ value, label }))} />
      <Field label="Reason" name="note" required wide />
    </Form> : <p className="hint">Whether to register in a state is your accountant’s decision; they record it here.</p>}
  </Card>
}
