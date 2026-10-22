import { useState } from 'react'
import { Card, command, Field, Form, Table, today, usd, useShared, type D } from './kit'
import { mayRecordDeposits } from './estimate-economics'

export const invoiceHref = (id: string) => `/app/sales?invoice=${encodeURIComponent(id)}`

export function EstimateProgress({ estimate: e, deposits, onDone }: { estimate: D; deposits: D[]; onDone: () => Promise<void> }) {
  const { state } = useShared(), [mode, setMode] = useState('percent'), [depositId, setDepositId] = useState('')
  const [percent, setPercent] = useState(''), [amount, setAmount] = useState(''), [confirmed, setConfirmed] = useState(false)
  const [requestId] = useState(() => crypto.randomUUID())
  const available = deposits.filter(d => d.customer_id === e.customer_id && d.available_cents > 0)
  const chosen = available.find(d => d.id === depositId)
  const proposed = mode === 'full' || mode === 'balance' ? e.remaining_cents : mode === 'percent' ? Math.round(e.total_cents * Number(percent) / 100) : Math.round(Number(amount) * 100)
  return <Card title="Progress invoicing">
    <dl className="summary"><div><dt>Accepted estimate</dt><dd>{usd(e.total_cents)}</dd></div><div><dt>Previously billed / reserved in drafts</dt><dd>{usd(e.billed_cents)}</dd></div><div className="total"><dt>Remaining to invoice</dt><dd>{usd(e.remaining_cents)}</dd></div></dl>
    <Table heads={['Invoice', 'Billing method', 'Milestone', 'Amount', 'Status']} figures={[3]} empty="No invoices created from this estimate.">
      {e.conversions.map((c: D) => <tr key={c.invoice_id}><td><a href={invoiceHref(c.invoice_id)}>{c.number}</a></td><td>{c.mode}</td><td>{c.milestone || '—'}</td><td className="fig">{usd(c.amount_cents)}</td><td>{c.status}</td></tr>)}
    </Table>
    {e.status !== 'accepted' ? <p>The customer must accept this exact sent revision before it can be invoiced.</p> : !e.remaining_cents ? <p>This estimate has been fully invoiced.</p> : state.actor.can.record && <Form label="Create invoice draft" submit={b => {
      if (!confirmed) throw new Error('Review this estimate revision and confirm the invoice amount.')
      return command('estimate.convert', { id: e.id, revision: e.revision, requestId, mode, issueDate: b.issueDate, dueDate: b.dueDate, percent, amount, milestone: b.milestone,
        ...(depositId ? { depositId, depositAmount: b.depositAmount } : {}) })
    }} onDone={async result => { await onDone(); window.location.assign(invoiceHref(result.invoice.id)) }}>
      <div className="grid-form">
        <Field label="Invoice this estimate by" name="mode" required value={mode} onChange={(event: any) => { setMode(event.target.value); setConfirmed(false) }} options={[...(e.billed_cents === 0 ? [{ value: 'full', label: 'One invoice for the full estimate' }] : []), { value: 'percent', label: 'Percentage of accepted estimate' }, { value: 'milestone', label: 'Milestone amount' }, { value: 'balance', label: 'Remaining balance' }]} />
        {mode === 'percent' && <Field label="Percentage to invoice" name="percent" inputMode="decimal" value={percent} onChange={(event: any) => { setPercent(event.target.value); setConfirmed(false) }} required hint="For example, 30 then 40, followed by the remaining balance." />}
        {mode === 'milestone' && <><Field label="Milestone" name="milestone" required /><Field label="Milestone invoice amount" name="amount" inputMode="decimal" value={amount} onChange={(event: any) => { setAmount(event.target.value); setConfirmed(false) }} required /></>}
        <Field label="Invoice issue date" name="issueDate" type="date" defaultValue={today()} required />
        <Field label="Invoice due date" name="dueDate" type="date" hint="Leave blank to use customer or template terms." />
        {mayRecordDeposits(state) && available.length > 0 && <><Field label="Apply advance customer deposit" name="depositId" value={depositId} onChange={(event: any) => { setDepositId(event.target.value); setConfirmed(false) }} empty="No advance deposit" options={available.map(d => ({ value: d.id, label: `${d.reference || 'Deposit'} · ${usd(d.available_cents)} available` }))} />
          {chosen && <Field key={chosen.id} label="Advance deposit to apply at invoice issue" name="depositAmount" defaultValue={(Math.min(chosen.available_cents, Number.isFinite(proposed) ? proposed : chosen.available_cents) / 100).toFixed(2)} inputMode="decimal" required hint="Held as a liability until this invoice is issued. Does not record another bank receipt." />}</>}
      </div>
      <p>Invoice amount: <strong>{Number.isFinite(proposed) ? usd(proposed) : 'Enter an amount'}</strong>. Remaining after this draft: <strong>{Number.isFinite(proposed) ? usd(e.remaining_cents - proposed) : '—'}</strong>.</p>
      <p className="hint" style={{ overflowWrap: 'anywhere' }}>Accepted revision: {e.acceptance?.revision}. Created invoices use the normal invoice approval and issuing steps. Their draft amounts reserve this estimate's remaining value.</p>
      <label className="check"><input type="checkbox" checked={confirmed} onChange={event => setConfirmed(event.target.checked)} required /> I reviewed this accepted estimate revision and the amount to invoice.</label>
    </Form>}
  </Card>
}
