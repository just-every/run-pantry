import { Action, Card, Chip, FileLink, Loading, Metrics, Table, day, usd, useView, type D } from './kit'
import { ExemptionCertificates } from './exemption-certificates'

const KIND: Record<string, string> = { invoice: 'Invoice', credit: 'Credit', payment: 'Payment' }
const METHOD: Record<string, string> = { card: 'Card', us_bank_account: 'Bank account (ACH)', offline: 'Offline payment instructions' }

export function CustomerHistory({ customerId }: { customerId: string }) {
  const { data, error, reload } = useView<D>(`customers/${encodeURIComponent(customerId)}`)
  if (!data) return <Card title="Customer history"><Loading error={error} what="customer history" /></Card>
  const c = data.customer, s = data.summary
  return <div className="stack">
    <Card title={`${c.name} · customer history`} actions={<Action run={reload}>Refresh customer history</Action>}>
      {error && <p role="alert" className="error">{error}</p>}
      <Metrics items={[{ label: 'Open invoices', value: usd(s.open_invoice_cents) }, { label: 'Unapplied payments and credits', value: usd(s.unallocated_payment_cents + s.unallocated_credit_cents) }, { label: 'Open balance', value: usd(s.open_balance_cents) }]} />
      <p className="hint">As of {day(data.asOf)}. Open balance uses the receivables aging: issued open invoices less unapplied posted payments and credits. Drafts and reversed records do not count.</p>
      <p><a href={`/app/reports?report=receivables&to=${data.asOf}`}>Reconcile with receivables aging</a></p>
      <dl>
        <div><dt>Default terms</dt><dd>{c.terms_days} days</dd></div>
        <div><dt>Customer email and phone</dt><dd>{c.email || 'No email'}{c.phone ? ` · ${c.phone}` : ''}</dd></div>
        <div><dt>Billing address</dt><dd>{c.billing_address || 'Not recorded'}</dd></div>
        <div><dt>Service address</dt><dd>{c.service_address || 'Not recorded'}</dd></div>
        <div><dt>Payment methods offered</dt><dd>{c.pay_methods === null ? 'All available methods' : c.pay_methods.length ? c.pay_methods.map((m: string) => METHOD[m]).join(', ') : 'No payment methods offered'}</dd></div>
        <div><dt>Internal notes</dt><dd>{c.internal_notes || 'No notes recorded'}</dd></div>
      </dl>
      <Table heads={['Contact', 'Email', 'Phone', 'Roles']} empty="No contact people recorded.">
        {c.contacts.map((p: D, i: number) => <tr key={i}><td>{p.name}</td><td>{p.email || '—'}</td><td>{p.phone || '—'}</td><td>{p.roles.join(', ') || 'No billing role'}</td></tr>)}
      </Table>
      <Table heads={['Date', 'Record', 'Status', 'Total', 'Current balance', 'Details']} figures={[3, 4]} empty="No invoices, credits or payments for this customer yet.">
        {data.rows.map((r: D) => <tr key={`${r.kind}:${r.id}`}>
          <td>{day(r.date)}</td><td><a href={r.href}>{KIND[r.kind] ?? r.kind} {r.reference}</a></td><td><Chip>{r.status}</Chip></td><td className="fig">{usd(r.total_cents)}</td><td className="fig">{usd(r.balance_cents)}</td>
          <td><details className="details"><summary>Allocations and documents</summary>
            {r.allocations.map((a: D) => <p key={a.id}><a href={r.kind === 'invoice' ? a.source_href : a.target_href}>{r.kind === 'invoice' ? a.source_reference || 'Applied record' : a.invoice_number || 'Applied record'}</a> · {usd(a.amount_cents)}</p>)}
            {!r.allocations.length && <p>No allocations.</p>}
            {r.documents.map((d: D) => <p key={d.id}><FileLink id={d.id} name={d.name} mediaType={d.media_type} /></p>)}
          </details></td>
        </tr>)}
      </Table>
    </Card>
    <Card title="Estimates and statements"><p>Estimates and statements are not available yet.</p></Card>
    <Card title="Customer email history">
      <p className="hint">Accepted means the provider accepted the message. It does not confirm delivery or reading. Local messages are suppressed.</p>
      <Table heads={['When', 'Invoice', 'Recipient', 'Message', 'Outcome']} empty="No customer email recorded.">
        {data.deliveries.map((d: D) => <tr id={`delivery-${d.id}`} key={d.id}><td>{day(d.at)}</td><td><a href={`/app/reports?record=${encodeURIComponent(`invoice:${d.invoice_id}`)}`}>{d.number}</a></td><td>{d.recipient}</td><td><details className="details"><summary>{d.subject}</summary><p>{d.kind === 'reminder' ? 'Reminder' : 'Invoice'} · {d.provider || 'No provider'}{d.provider_message_id ? ` · ${d.provider_message_id}` : ''}</p><p>{d.detail || 'No additional outcome detail.'}</p></details></td><td><Chip>{d.status}</Chip></td></tr>)}
      </Table>
    </Card>
    <ExemptionCertificates customerId={customerId} />
  </div>
}
