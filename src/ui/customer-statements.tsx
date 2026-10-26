import { useRef, useState } from 'react'
import { DeliveryChip } from './invoice-delivery'
import { Card, command, Field, Form, Table, day, usd, useShared, type D } from './kit'

const MODES: Record<string, string> = { 'open-items': 'Open items', 'balance-forward': 'Balance forward', 'transaction-list': 'Transaction list' }

export function CustomerStatements({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared()
  const [mode, setMode] = useState('open-items'), requestKey = useRef(crypto.randomUUID())
  const statements = data.sections.statements.rows
  if (!data.sections.statements.available) return null
  return <Card title="Statements">
    <p>Email a dated statement to this customer's billing and copy contacts. The saved statement keeps the figures sent, even when the books later change.</p>
    {state.actor.can.record && <Form label="Email statement" submit={body => command('statement.send', { ...body, customerId: data.customer.id, idempotencyKey: requestKey.current })} onDone={async () => { await reload(); requestKey.current = crypto.randomUUID() }} className="grid-form">
      <Field label="Statement type" name="mode" value={mode} onChange={(e: any) => { setMode(e.target.value); requestKey.current = crypto.randomUUID() }} required options={Object.entries(MODES).map(([value, label]) => ({ value, label }))} />
      <Field label="Statement date" name="to" type="date" defaultValue={data.asOf} required onChange={() => { requestKey.current = crypto.randomUUID() }} />
      <Field label="Statement starts" name="from" type="date" defaultValue={`${data.asOf.slice(0, 4)}-01-01`} required hint={mode === 'open-items' ? 'Open items includes all unpaid invoices and unapplied payments and credits as of the statement date.' : 'Transactions from this date through the statement date.'} onChange={() => { requestKey.current = crypto.randomUUID() }} />
    </Form>}
    <Table heads={['Statement', 'Dates', 'Closing balance', 'Email outcome']} figures={[2]} empty="No statements emailed yet.">
      {statements.map((s: D) => <tr id={`statement-${s.id}`} key={s.id}>
        <td><a href={s.document_href}>{MODES[s.mode]} statement</a></td>
        <td>{s.mode !== 'open-items' && <>{day(s.from)} – </>}{day(s.to)}</td>
        <td>{usd(s.closing_balance_cents)}</td>
        <td>{s.deliveries.map((d: D) => <div key={d.id}><span>{d.recipient}</span> <DeliveryChip status={d.status} />{d.detail && <p>{d.detail}</p>}</div>)}</td>
      </tr>)}
    </Table>
  </Card>
}
