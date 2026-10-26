import { useState } from 'react'
import { Action, Chip, Field, Form, Table, today, usd, useShared, command, type D } from './kit'

export function RefundCustomerBalance({ sourceKind, source, data, onDone }: { sourceKind: 'payment' | 'credit'; source: D; data: D; onDone: () => Promise<void> }) {
  const { state } = useShared(), [method,setMethod] = useState('recorded')
  const available = sourceKind === 'payment' ? source.unallocated_cents : source.open_cents
  const rows = (data.refunds ?? []).filter((r: D) => r.source_kind === sourceKind && r.source_id === source.id)
  const customer = sourceKind === 'payment' ? source.contact_id : source.customer_id
  const payments = data.payments.filter((p: D) => p.direction === 'received' && !p.reversal_id && p.contact_id === customer)
  return <details className="details"><summary>Refund customer balance</summary>
    {available > 0 && state.actor.can.record && <Form label="Prepare refund" submit={b => command('customer-refund.prepare', { ...b,sourceKind,sourceId:source.id })} onDone={onDone}>
      <p>{usd(available)} available. Approve the exact refund before recording it or returning money through Stripe.</p>
      <Field label="Refund method" name="method" value={method} onChange={(e: any) => setMethod(e.target.value)} options={[{value:'recorded',label:'Record a refund made outside Pantry'},{value:'stripe',label:'Refund to the original Stripe payment'}]} />
      <Field label="Refund date" name="date" type="date" defaultValue={today()} required />
      <Field label="Refund amount" name="amount" defaultValue={(available/100).toFixed(2)} required />
      <Field label="Refund bank account" name="bankAccountId" required options={state.bankAccounts.map((b:D)=>({value:b.id,label:b.name}))} />
      {method === 'stripe' && sourceKind === 'credit' && <Field label="Original Stripe payment" name="paymentId" required options={payments.map((p:D)=>({value:p.id,label:`${p.reference || p.payment_date} · ${usd(p.amount_cents)}`}))} />}
      <Field label="Refund reason" name="reason" required />
    </Form>}
    <Table heads={['Date','Amount','Method','Outcome','Actions']} empty="No refunds for this balance.">
      {rows.map((r:D)=><tr key={r.id}><td>{r.refund_date}</td><td>{usd(r.amount_cents)}</td><td>{r.method}</td><td><Chip>{r.status}</Chip>{r.provider_id && <span className="sub block">{r.provider_id}</span>}{r.journal_id && <a href={`/app/reports?record=${encodeURIComponent(`entry:${r.journal_id}`)}`}>View refund entry</a>}</td><td>
        {r.status === 'draft' && state.actor.can.post && <Action run={async()=>{await command('customer-refund.approve',{id:r.id,revision:r.revision,limitRevision:state.settings.issuingLimits.effective?.revision});await onDone()}}>Approve refund</Action>}
        {['approved','pending'].includes(r.status) && state.actor.can.post && <Action run={async()=>{await command('customer-refund.post',{id:r.id});await onDone()}}>{r.status === 'pending' ? 'Check refund outcome' : r.method === 'stripe' ? 'Send Stripe refund' : 'Record refund'}</Action>}
        {['draft','approved'].includes(r.status) && state.actor.can.post && <Action run={async()=>{await command('customer-refund.cancel',{id:r.id,revision:r.revision});await onDone()}}>Cancel refund</Action>}
      </td></tr>)}
    </Table>
  </details>
}
