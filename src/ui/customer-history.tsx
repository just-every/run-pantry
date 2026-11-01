import { CustomerAutopay } from './customer-autopay'
import { CustomerTextConsent } from './texting'
import { PaymentReceiptPreference } from './payment-notices'
import { Action, Chip, FileLink, Loading, Table, day, usd, useShared, useView, type D } from './kit'
import { CustomerStatements } from './customer-statements'
import { ExemptionCertificates } from './exemption-certificates'
import { invoiceHref } from './estimate-progress'
import { Fold, RecordLink } from './record-folds'

const KIND: Record<string, string> = { invoice: 'Invoice', credit: 'Credit', payment: 'Payment', refund: 'Refund', estimate: 'Estimate' }
const METHOD: Record<string, string> = { card: 'Card', us_bank_account: 'Bank account (ACH)', offline: 'Offline payment instructions' }

/** A customer's record: one status summary, then Records open and every other section folded. */
export function CustomerHistory({ customerId, onEdit }: { customerId: string; onEdit?: () => void }) {
  const { state } = useShared()
  const { data, error, reload } = useView<D>(`customers/${encodeURIComponent(customerId)}`)
  if (!data) return <section className="card record-summary"><Loading error={error} what="customer history" /></section>
  const c = data.customer, s = data.summary
  return <div className="stack record-card">
    <section className="card record-summary">
      <div className="record-head"><h2>{c.name} · customer history</h2><Chip>Customer</Chip><Action run={reload}>Refresh customer history</Action></div>
      {error && <p role="alert" className="error">{error}</p>}
      <div className="record-main">
        <div className="record-status">
          <p className="record-label">Open balance</p>
          <strong className="record-figure">{usd(s.open_balance_cents)}</strong>
          <p className="record-sub">Open invoices {usd(s.open_invoice_cents)} · Unapplied payments and credits {usd(s.unallocated_payment_cents + s.unallocated_credit_cents)}</p>
          <p className="hint">As of {day(data.asOf)}. Open balance uses the receivables aging: issued open invoices less unapplied posted payments and credits. Drafts and reversed records do not count.</p>
          <p><RecordLink href={`/app/reports?report=receivables&to=${data.asOf}`}>Reconcile with receivables aging</RecordLink></p>
        </div>
        <div className="record-side">
          <dl className="facts">
            <div><dt>Default terms</dt><dd>{c.terms_days} days</dd></div>
            <div><dt>Customer email and phone</dt><dd>{c.email || 'No email'}{c.phone ? ` · ${c.phone}` : ''}</dd></div>
          </dl>
          {state.actor.can.record && onEdit && <button type="button" className="btn btn-secondary" onClick={onEdit}>Edit contact details</button>}
        </div>
      </div>
    </section>
    <section className="card record-sections">
      <Fold title="Records" open>
        <Table heads={['Date', 'Record', 'Status', 'Total', 'Current balance', 'Details']} figures={[3, 4]} empty="No invoices, estimates, credits or payments for this customer yet.">
          {data.rows.map((r: D) => <tr key={`${r.kind}:${r.id}`}>
            <td>{day(r.date)}</td><td><RecordLink href={r.href}>{KIND[r.kind] ?? r.kind} {r.reference}</RecordLink></td><td><Chip>{r.status}</Chip></td><td className="fig">{usd(r.total_cents)}</td><td className="fig">{usd(r.balance_cents)}</td>
            <td><details className="details"><summary>{r.kind === 'estimate' ? 'Acceptance and invoices' : 'Allocations and documents'}</summary>
              {r.kind === 'estimate' && <><p><RecordLink href={r.href}>Open estimate {r.reference}</RecordLink></p>{r.acceptance ? <p style={{ overflowWrap: 'anywhere' }}>Accepted by {r.acceptance.name} · {day(r.acceptance.at)} · IP {r.acceptance.ip} · Revision {r.acceptance.revision}</p> : <p>Not accepted.</p>}{(r.conversions ?? []).map((c: D) => <p key={c.invoice_id}><RecordLink href={invoiceHref(c.invoice_id)}>{c.number}</RecordLink> · {c.milestone || c.mode} · {usd(c.amount_cents)} · {c.status}</p>)}</>}
              {(r.allocations ?? []).map((a: D) => <p key={a.id}><RecordLink href={r.kind === 'invoice' ? a.source_href : a.target_href}>{r.kind === 'invoice' ? a.source_reference || 'Applied record' : a.invoice_number || 'Applied record'}</RecordLink> · {usd(a.amount_cents)}</p>)}
              {r.kind !== 'estimate' && !r.allocations?.length && <p>No allocations.</p>}
              {(r.documents ?? []).map((d: D) => <p key={d.id}><FileLink id={d.id} name={d.name} mediaType={d.media_type} /></p>)}
            </details></td>
          </tr>)}
        </Table>
      </Fold>
      <Fold title="Details">
        <dl className="facts">
          <div><dt>Billing address</dt><dd>{c.billing_address || 'Not recorded'}</dd></div>
          <div><dt>Service address</dt><dd>{c.service_address || 'Not recorded'}</dd></div>
          <div><dt>Payment methods offered</dt><dd>{c.pay_methods === null ? 'All available methods' : c.pay_methods.length ? c.pay_methods.map((m: string) => METHOD[m]).join(', ') : 'No payment methods offered'}</dd></div>
          <div><dt>Internal notes</dt><dd>{c.internal_notes || 'No notes recorded'}</dd></div>
        </dl>
        <Table heads={['Contact', 'Email', 'Phone', 'Roles']} empty="No contact people recorded.">
          {c.contacts.map((p: D, i: number) => <tr key={i}><td>{p.name}</td><td>{p.email || '—'}</td><td>{p.phone || '—'}</td><td>{p.roles.join(', ') || 'No billing role'}</td></tr>)}
        </Table>
        {state.actor.role === 'owner' && <div className="fold-part"><h3>Payment receipt preference</h3><PaymentReceiptPreference enabled={!!c.payment_receipts_on} customerId={c.id} onChange={reload} /></div>}
      </Fold>
      {data.sections.estimates.available && <Fold title="Customer estimates">
        <Table heads={['Estimate', 'Date', 'Status', 'Total', 'Acceptance and progress invoices']} figures={[3]} empty="No estimates for this customer.">
          {data.sections.estimates.rows.map((e: D) => <tr key={e.id}><td><RecordLink href={e.href}>{e.reference}</RecordLink></td><td>{day(e.date)}</td><td><Chip>{e.status}</Chip></td><td className="fig">{usd(e.total_cents)}</td><td>{e.acceptance && <p>Accepted by {e.acceptance.name} · {day(e.acceptance.at)}</p>}{(e.conversions ?? []).map((c: D) => <p key={c.invoice_id}><RecordLink href={invoiceHref(c.invoice_id)}>{c.number}</RecordLink> · {usd(c.amount_cents)}</p>)}</td></tr>)}
        </Table>
      </Fold>}
      <CustomerAutopay customerId={customerId} />
      {state.actor.can.owner && <CustomerTextConsent customer={c} />}
      <CustomerStatements data={data} reload={reload} />
      <Fold title="Customer email history">
        <p className="hint">Accepted means the provider accepted the message. It does not confirm delivery or reading.</p>
        <Table heads={['When', 'Record', 'Recipient', 'Message', 'Outcome']} empty="No customer email recorded.">
          {data.deliveries.map((d: D) => <tr id={`delivery-${d.id}`} key={d.id}><td>{day(d.at)}</td><td><RecordLink href={d.kind === 'statement' ? d.href : d.kind === 'estimate' ? d.href || `/app/sales?tab=estimates&estimate=${encodeURIComponent(d.estimate_id)}` : `/app/reports?record=${encodeURIComponent(`invoice:${d.invoice_id}`)}`}>{d.number}</RecordLink></td><td>{d.recipient}</td><td><details className="details"><summary>{d.subject}</summary><p>{d.kind === 'autopay-failed' ? 'Automatic payment failure' : d.kind === 'statement' ? 'Statement' : d.kind === 'estimate' ? 'Estimate' : d.kind === 'reminder' ? 'Reminder' : d.kind === 'receipt' ? 'Payment receipt' : d.kind === 'processing' ? 'Bank payment processing' : d.kind === 'returned' ? 'Payment returned' : 'Invoice'} · {d.provider || 'No provider'}{d.provider_message_id ? ` · ${d.provider_message_id}` : ''}</p><p>{d.detail || 'No additional outcome detail.'}</p></details></td><td><Chip>{d.status}</Chip></td></tr>)}
        </Table>
      </Fold>
      {state.actor.role !== 'sales' && <ExemptionCertificates customerId={customerId} />}
    </section>
  </div>
}
