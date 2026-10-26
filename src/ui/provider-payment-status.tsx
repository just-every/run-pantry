import { Card, Action, Table, Loading, usd, useView, useShared, command, type D } from './kit'

export function ProviderPaymentStatus({ payments }: { payments: D[] }) {
  if(!payments.length)return null
  return <details className="details"><summary>Provider payment status</summary>
    {payments.map(p=><p key={p.id}>
      {p.method === 'card' ? 'Card' : 'Bank account'} · {p.status} · {usd(p.amount_cents)}
      {p.refunded_cents>0 ? ` · ${usd(p.refunded_cents)} refunded` : ''}
      {p.disputed_cents>0 ? ` · ${usd(p.disputed_cents)} disputed` : ''}
      {p.evidence_due_by ? ` · Evidence due ${new Date(p.evidence_due_by*1000).toISOString().slice(0,10)}` : ''}
      {p.return_code ? ` · ${p.return_code}: ${p.return_reason}` : ''}
      {p.return_entry_id && <> · <a href={`/app/reports?record=${encodeURIComponent(`entry:${p.return_entry_id}`)}`}>View payment reversal</a></>}
    </p>)}
  </details>
}

export function PaymentComparison() {
  const {data,error,reload}=useView<D>('stripe/events'),{state}=useShared()
  if(!data)return <Card title="Payment comparison"><Loading error={error} what="provider comparison" /></Card>
  return <Card title="Payment comparison">
    {state.actor.can.owner && <Action run={async()=>{await command('stripe.events-compare',{});await reload()}}>Compare Stripe payment events</Action>}
    <Table heads={['Started','Outcome','Checked','Missing events','Needs attention']} empty="No comparison has run yet.">
      {data.runs.map((r:D)=><tr key={r.id}><td>{r.started_at.slice(0,10)}</td><td>{r.status}</td><td>{r.checked}</td><td>{r.missing_found}</td><td>{r.reason || 'None'}</td></tr>)}
    </Table>
    {data.held.map((e:D)=><p key={e.id}>{e.type} · {e.reason}</p>)}
    {data.disputes.map((d:D)=><p key={d.id}><a href={`/app/sales?invoice=${encodeURIComponent(d.invoice_id)}`}>Open disputed invoice</a> · {usd(d.amount_cents)} · {d.status}{d.evidence_due_by ? ` · Evidence due ${new Date(d.evidence_due_by*1000).toISOString().slice(0,10)}` : ''}</p>)}
  </Card>
}
