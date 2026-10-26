// Sending an issued invoice: the customer link, sent and viewed, the next
// reminder, online payments, and every delivery with the provider's answer.
import { LateFeeCharge } from './late-fees'
import { customerRecipients } from '../pantry/customer-profile'
import { Action, Chip, command, Form, Field, Table, day, usd, useShared, useWho, type D } from './kit'

type Tone = 'good' | 'warn' | 'bad' | 'info' | 'neutral'
const OUTCOME: Record<string, [string, Tone]> = {
  sending: ['Sending', 'info'], accepted: ['Accepted by the mail provider', 'good'], rejected: ['Rejected by the mail provider', 'bad'], rate_limited: ['Rate limited; send again later', 'warn'],
  uncertain: ['Outcome unknown', 'warn'], suppressed: ['Not sent: local run', 'neutral'], failed: ['Not sent', 'bad'],
}
export const DeliveryChip = ({ status }: { status: string }) => { const [label, tone] = OUTCOME[status] ?? [status, 'neutral']; return <Chip tone={tone}>{label}</Chip> }

export function messageLabel(d: D) {
  if (d.kind === 'invoice') return 'Invoice'
  return `Reminder · ${d.step < 0 ? `${-d.step} day${d.step === -1 ? '' : 's'} before due` : d.step === 0 ? 'due date' : `${d.step} day${d.step === 1 ? '' : 's'} after due`}`
}

const PAYMENT: Record<string, [string, Tone]> = { open: ['Started, not paid', 'neutral'], processing: ['Processing (ACH)', 'info'], succeeded: ['Paid', 'good'], failed: ['Failed', 'bad'], expired: ['Not completed', 'neutral'], returned: ['Returned (ACH)', 'warn'], disputed: ['Disputed', 'warn'], refunded: ['Refunded', 'neutral'] }

export function SendPanel({ i, data, onChange }: { i: D; data: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), who = useWho()
  const defaultTo = customerRecipients(state.contacts.find((c: D) => c.id === i.customer_id) ?? { email: i.customer_email }).join(',')
  const deliveries = (data.deliveries as D[]).filter(d => d.invoice_id === i.id)
  const online = (data.onlinePayments as D[]).filter(p => p.invoice_id === i.id)
  const plan = data.reminders as D, next = plan.plans[i.id]
  const reminder = i.open_cents === 0 ? 'None: the invoice is paid' : i.reminders_paused ? 'Paused for this invoice' : !i.sent_at ? 'After the invoice is sent' : !plan.on ? 'Reminders are off for the business' : next ? (next === plan.today ? 'Due now; it goes out with the next due-work run' : <>On {day(next)}</>) : 'None left in the schedule'
  return <div className="send-panel">
    <h3>Sending</h3>
    <dl className="facts">
      <div><dt>Sent</dt><dd>{i.sent_at ? day(i.sent_at) : 'Not sent yet'}</dd></div>
      <div><dt>Viewed</dt><dd>{i.viewed_at ? <>Opened by the customer {day(i.viewed_at)}</> : i.sent_at ? 'Not opened yet' : '—'}</dd></div>
      <div><dt>Next reminder</dt><dd>{reminder}</dd></div>
      {i.link_token && <div><dt>Customer page</dt><dd><a href={`/i/${i.link_token}`} target="_blank" rel="noreferrer">Open the customer's view</a></dd></div>}
    </dl>
    {state.actor.can.record && <>
      {i.link_token ? <Action tone="danger" run={async () => { await command('invoice.link-revoke', { id: i.id }); await onChange() }}>Revoke customer link</Action> : <p className="hint">There is no active customer link. Send the invoice to create a new link.</p>}
      <Form label="Save link expiry" submit={b => command('invoice.link-policy', { id: i.id, daysAfterPayment: b.daysAfterPayment })} onDone={onChange}>
        <Field label="Link expires after payment (days)" name="daysAfterPayment" type="number" min={0} max={3650} defaultValue={i.link_days_after_payment} required hint="0 expires as soon as the invoice is fully paid. A payment reversal restores access while money is owed." />
      </Form>
    </>}
    {i.open_cents > 0 && state.actor.can.record && <Form label={i.sent_at ? 'Send again' : 'Send invoice'} submit={b => command('invoice.send', { id: i.id, ...(b.to === defaultTo ? {} : { to: b.to }) })} onDone={onChange}>
      <Field label="Send to" name="to" type="email" multiple defaultValue={defaultTo} required hint="The PDF is attached and the email links to the customer page. Separate several addresses with commas." />
    </Form>}
    {i.open_cents > 0 && state.actor.can.record && <Action run={async () => { await command('invoice.reminders', { id: i.id, paused: !i.reminders_paused }); await onChange() }}>{i.reminders_paused ? 'Resume reminders' : 'Pause reminders'}</Action>}
    {i.open_cents > 0 && <LateFeeCharge invoice={i} onChange={onChange} />}
    {online.length > 0 && <><h3>Paid online</h3><ul className="send-log">
      {online.map(p => { const [label, tone] = PAYMENT[p.status]; return <li key={p.id}><span><strong>{usd(p.amount_cents)}</strong> {p.method === 'card' ? 'by card' : 'by ACH bank debit'}</span><Chip tone={tone}>{label}</Chip><small>Started {day(p.created_at)}{p.fee_cents === null ? '' : ` · Stripe fee ${usd(p.fee_cents)}`}</small></li> })}
    </ul></>}
    {deliveries.length > 0 && <><h3>Deliveries</h3><ul className="send-log">
      {deliveries.map(d => <li key={d.id}><span><strong>{messageLabel(d)}</strong> to {d.recipient}</span><DeliveryChip status={d.status} /><small>{day(d.at)} · by {who(d.sent_by)}{d.detail ? ` · ${d.detail}` : ''}</small></li>)}
    </ul></>}
  </div>
}

export function Deliveries({ data }: { data: D }) {
  const who = useWho()
  return <Table heads={['When', 'Invoice', 'Customer', 'Message', 'To', 'Sent by', 'Outcome']} empty="Nothing has been sent yet. Issue an invoice, then send it from its panel.">
    {(data.deliveries as D[]).map(d => <tr key={d.id}><td>{day(d.at)}</td><td className="nowrap">{d.number}</td><td>{d.customer_name}</td><td>{messageLabel(d)}</td><td>{d.recipient}</td><td>{who(d.sent_by)}</td><td><DeliveryChip status={d.status} />{d.detail && <small className="sub block">{d.detail}</small>}</td></tr>)}
  </Table>
}
