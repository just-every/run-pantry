import { useState } from 'react'
import { accountOptions, Card, command, contactOptions, Field, Form, Loading, Table, day, today, usd, useShared, useView, type D } from './kit'
import { mayRecordDeposits, paymentMethods } from './estimate-economics'
import { invoiceHref } from './estimate-progress'

function ApplyDeposit({ deposit: d, invoices, onDone }: { deposit: D; invoices: D[]; onDone: () => Promise<void> }) {
  const [requestId] = useState(() => crypto.randomUUID())
  const open = invoices.filter(i => i.kind === 'invoice' && i.customer_id === d.customer_id && i.status === 'issued' && i.open_cents > 0)
  return <Card title={`Apply deposit · ${d.customer_name}`}>
    <p>{usd(d.remaining_cents)} is held as a liability; {usd(d.available_cents)} is available after draft invoice reservations. Applying it reduces the liability and the invoice balance.</p>
    {open.length ? <Form label="Apply customer deposit" submit={b => command('customer-deposit.apply', { ...b, depositId: d.id, requestId })} onDone={onDone}>
      <Field label="Issued invoice" name="invoiceId" required options={open.map(i => ({ value: i.id, label: `${i.number} · ${usd(i.open_cents)} open` }))} />
      <Field label="Deposit amount to apply" name="amount" inputMode="decimal" required />
      <Field label="Application date" name="date" type="date" defaultValue={today()} required />
    </Form> : <p>No issued open invoices for this customer. Create and issue an invoice, then apply the deposit.</p>}
  </Card>
}

export function CustomerDeposits({ sales, onChange }: { sales: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), { data, error, reload } = useView<D>('customer-deposits')
  const [selected, setSelected] = useState(''), [formKey, setFormKey] = useState(0)
  if (!mayRecordDeposits(state)) return <Card title="Customer deposits"><p>Customer deposits require financial posting access.</p></Card>
  if (!data) return <Loading error={error} what="customer deposits" />
  const current = data.deposits.find((d: D) => d.id === selected && d.available_cents > 0)
  const refresh = async () => { await Promise.all([reload(), onChange()]) }
  return <div className="split split-wide-left"><div className="stack">
    <Card title="Customer deposits and retainers">
      <p>Record money received before work starts. It stays in the customer deposit liability account until applied to an issued invoice.</p>
      {error && <p role="alert" className="error">{error}</p>}
      <Table heads={['Date', 'Customer', 'Reference', 'Received', 'Held', 'Applications']} figures={[3, 4]} empty="No advance customer deposits recorded.">
        {data.deposits.map((d: D) => <tr key={d.id}><td>{day(d.date)}</td><td><a href={`/app/sales?tab=contacts&customer=${encodeURIComponent(d.customer_id)}`}>{d.customer_name}</a></td><td>{d.reference || '—'}</td><td className="fig">{usd(d.amount_cents)}</td><td className="fig">{usd(d.remaining_cents)}{d.reserved_cents > 0 && <small className="sub block">{usd(d.reserved_cents)} reserved for drafts</small>}{d.available_cents > 0 && <button type="button" className="btn btn-link" onClick={() => setSelected(d.id)}>Apply deposit</button>}</td><td>{d.applications.length ? d.applications.map((a: D, i: number) => <p key={i}><a href={invoiceHref(a.invoice_id)}>{a.number || 'Invoice'}</a> · {usd(a.amount_cents)} · {day(a.date)}</p>) : 'Not applied'}</td></tr>)}
      </Table>
    </Card>
    {current && <ApplyDeposit key={current.id + current.revision} deposit={current} invoices={sales.invoices} onDone={async () => { setSelected(''); await refresh() }} />}
  </div><Card title="Record an advance deposit">
    <Form key={formKey} label="Record customer deposit" submit={b => command('customer-deposit.record', b)} onDone={async () => { setFormKey(k => k + 1); await refresh() }}>
      <div className="grid-form">
        <Field label="Deposit customer" name="customerId" required options={contactOptions(state.contacts, 'customer')} />
        <Field label="Date received" name="date" type="date" defaultValue={today()} required />
        <Field label="Deposit received amount" name="amount" inputMode="decimal" required />
        <Field label="Bank account received into" name="bankAccountId" required options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} />
        <Field label="Customer deposit liability account" name="liabilityAccountId" required options={accountOptions(state.accounts, a => a.type === 'liability' && a.subtype === 'other')} />
        <Field label="How the deposit was paid" name="method" required options={paymentMethods} />
        <Field label="Deposit reference" name="reference" required />
        <Field label="Deposit memo" name="memo" type="textarea" wide />
      </div>
      {!state.bankAccounts.length && <p className="callout callout-warn">Add a bank account under Bank before recording money received.</p>}
    </Form>
  </Card></div>
}
