import { CustomerAutopay } from './customer-autopay'
import { CustomerTextConsent } from './texting'
import { PaymentReceiptPreference } from './payment-notices'
import { Action, Card, Chip, FileLink, Loading, Metrics, Table, day, usd, useShared, useView, type D } from './kit'
import { CustomerStatements } from './customer-statements'
import { ExemptionCertificates } from './exemption-certificates'
import { invoiceHref } from './estimate-progress'

const KIND: Record<string, string> = { invoice: 'Invoice', credit: 'Credit', payment: 'Payment', refund: 'Refund', estimate: 'Estimate' }
const METHOD: Record<string, string> = { card: 'Card', us_bank_account: 'Bank account (ACH)', offline: 'Offline payment instructions' }

export function CustomerHistory({ customerId }: { customerId: string }) {
  const { state } = useShared()
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
      {state.actor.role === 'owner' && <details className="details"><summary>Payment receipt preference</summary><PaymentReceiptPreference enabled={!!c.payment_receipts_on} customerId={c.id} onChange={reload} /></details>}
      <Table heads={['Contact', 'Email', 'Phone', 'Roles']} empty="No contact people recorded.">
        {c.contacts.map((p: D, i: number) => <tr key={i}><td>{p.name}</td><td>{p.email || '—'}</td><td>{p.phone || '—'}</td><td>{p.roles.join(', ') || 'No billing role'}</td></tr>)}
      </Table>
      <Table heads={['Date', 'Record', 'Status', 'Total', 'Current balance', 'Details']} figures={[3, 4]} empty="No invoices, estimates, credits or payments for this customer yet.">
        {data.rows.map((r: D) => <tr key={`${r.kind}:${r.id}`}>
          <td>{day(r.date)}</td><td><a href={r.href}>{KIND[r.kind] ?? r.kind} {r.reference}</a></td><td><Chip>{r.status}</Chip></td><td className="fig">{usd(r.total_cents)}</td><td className="fig">{usd(r.balance_cents)}</td>
          <td><details className="details"><summary>{r.kind === 'estimate' ? 'Acceptance and invoices' : 'Allocations and documents'}</summary>
            {r.kind === 'estimate' && <><p><a href={r.href}>Open estimate {r.reference}</a></p>{r.acceptance ? <p style={{ overflowWrap: 'anywhere' }}>Accepted by {r.acceptance.name} · {day(r.acceptance.at)} · IP {r.acceptance.ip} · Revision {r.acceptance.revision}</p> : <p>Not accepted.</p>}{(r.conversions ?? []).map((c: D) => <p key={c.invoice_id}><a href={invoiceHref(c.invoice_id)}>{c.number}</a> · {c.milestone || c.mode} · {usd(c.amount_cents)} · {c.status}</p>)}</>}
            {(r.allocations ?? []).map((a: D) => <p key={a.id}><a href={r.kind === 'invoice' ? a.source_href : a.target_href}>{r.kind === 'invoice' ? a.source_reference || 'Applied record' : a.invoice_number || 'Applied record'}</a> · {usd(a.amount_cents)}</p>)}
            {r.kind !== 'estimate' && !r.allocations?.length && <p>No allocations.</p>}
            {(r.documents ?? []).map((d: D) => <p key={d.id}><FileLink id={d.id} name={d.name} mediaType={d.media_type} /></p>)}
          </details></td>
        </tr>)}
      </Table>
    </Card>
    {data.sections.estimates.available && <Card title="Customer estimates">
      <Table heads={['Estimate', 'Date', 'Status', 'Total', 'Acceptance and progress invoices']} figures={[3]} empty="No estimates for this customer.">
        {data.sections.estimates.rows.map((e: D) => <tr key={e.id}><td><a href={e.href}>{e.reference}</a></td><td>{day(e.date)}</td><td><Chip>{e.status}</Chip></td><td className="fig">{usd(e.total_cents)}</td><td>{e.acceptance && <p>Accepted by {e.acceptance.name} · {day(e.acceptance.at)}</p>}{(e.conversions ?? []).map((c: D) => <p key={c.invoice_id}><a href={invoiceHref(c.invoice_id)}>{c.number}</a> · {usd(c.amount_cents)}</p>)}</td></tr>)}
      </Table>
    </Card>}
    <CustomerAutopay customerId={customerId} />
    {state.actor.can.owner && <CustomerTextConsent customer={c} />}
    <CustomerStatements data={data} reload={reload} />
    <Card title="Customer email history">
      <p className="hint">Accepted means the provider accepted the message. It does not confirm delivery or reading.</p>
      <Table heads={['When', 'Record', 'Recipient', 'Message', 'Outcome']} empty="No customer email recorded.">
        {data.deliveries.map((d: D) => <tr id={`delivery-${d.id}`} key={d.id}><td>{day(d.at)}</td><td><a href={d.kind === 'statement' ? d.href : d.kind === 'estimate' ? d.href || `/app/sales?tab=estimates&estimate=${encodeURIComponent(d.estimate_id)}` : `/app/reports?record=${encodeURIComponent(`invoice:${d.invoice_id}`)}`}>{d.number}</a></td><td>{d.recipient}</td><td><details className="details"><summary>{d.subject}</summary><p>{d.kind === 'autopay-failed' ? 'Automatic payment failure' : d.kind === 'statement' ? 'Statement' : d.kind === 'estimate' ? 'Estimate' : d.kind === 'reminder' ? 'Reminder' : d.kind === 'receipt' ? 'Payment receipt' : d.kind === 'processing' ? 'Bank payment processing' : d.kind === 'returned' ? 'Payment returned' : 'Invoice'} · {d.provider || 'No provider'}{d.provider_message_id ? ` · ${d.provider_message_id}` : ''}</p><p>{d.detail || 'No additional outcome detail.'}</p></details></td><td><Chip>{d.status}</Chip></td></tr>)}
      </Table>
    </Card>
    {state.actor.role !== 'sales' && <ExemptionCertificates customerId={customerId} />}
  </div>
}
