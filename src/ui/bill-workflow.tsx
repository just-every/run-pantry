import { DimensionFormFields } from './dimensions'
import { useState } from 'react'
import { Action, Card, Chip, command, contactOptions, Field, Form, Table, accountOptions, day, today, usd, useShared, type D } from './kit'

export function nextBillStep(actor: string) {
  return ({ Preparer: 'Prepare bill', 'Payment recorder': 'Record payment', Reconciler: 'Reconcile payment', 'Posting grant holder': 'Post bill', 'Owner or another posting grant holder': 'Approve bill', Owner: 'Owner approval', None: 'Complete', 'None — settled by credit': 'Complete' } as Record<string, string>)[actor] ?? actor
}

export function CapturedBills({ documents }: { documents: D[] }) {
  if (!documents.length) return null
  return <Card title="Captured documents awaiting bill preparation"><p className="hint">Captured documents have not posted to payables. Confirm the vendor and prepare a bill in Receipts.</p>
    <Table heads={['Vendor / document', 'Reference', 'Amount', 'Due', 'State', 'Next step']} figures={[2]}>{documents.map(d => <tr key={d.id}><td><a href={`/app/receipts#receipt-${d.id}`}>{d.vendor} · {d.name}</a></td><td>{d.reference}</td><td className="fig">{d.total_cents == null ? 'Not read' : usd(d.total_cents)}</td><td>{d.due_date ? day(d.due_date) : 'Needs preparation'}</td><td><Chip>Captured</Chip></td><td>Prepare bill</td></tr>)}</Table>
  </Card>
}

export function BillWorkflow({ bill: b, reload }: { bill: D; reload: () => Promise<void> }) {
  const { state } = useShared(), flow = b.lifecycle
  return <>
    <p><strong>{flow.stage}</strong> · Next step: {nextBillStep(flow.nextActor)}</p>
    {flow.stage === 'Draft' && state.actor.can.record && <Action run={async () => { await command('bill.submit', { id: b.id, revision: b.revision, captureRevision: flow.captureRevision }); await reload() }}>Submit bill for approval</Action>}
    {b.status === 'posted' && b.open_cents > 0 && state.actor.can.record && <Form label="Save payment plan" submit={v => command('bill.schedule', { id: b.id, revision: b.revision, ...v })} onDone={reload}>
      <p className="hint">A plan to pay outside Pantry. Saving this date sends no payment instruction and moves no money.</p>
      <Field label="Planned payment date" name="date" type="date" defaultValue={b.scheduled_date ?? ''} hint="Clear the date to cancel the plan" />
      <Field label="Payment plan note" name="note" defaultValue={b.scheduled_note} />
    </Form>}
    {b.scheduled_date && <p>Planned for {day(b.scheduled_date)}{b.scheduled_note ? ` · ${b.scheduled_note}` : ''}. Record the actual payment after it happens.</p>}
  </>
}

export function RecurringBills({ templates, reload }: { templates: D[]; reload: () => Promise<void> }) {
  const { state } = useShared(), [editing, setEditing] = useState<D | null>(null)
  const t = editing, expenses = accountOptions(state.accounts, a => a.active && !['bank', 'receivable', 'payable'].includes(a.subtype) && ['expense', 'asset'].includes(a.type))
  return <Card title="Recurring bills">
    <p className="hint">Each due occurrence creates one draft bill with its original date. Review and post each draft through the usual bill approval rules; no money moves.</p>
    <Table heads={['Template / vendor', 'Next bill', 'Status', 'History', 'Actions']} empty="No recurring bills yet.">{templates.map(r => <tr key={r.id}><td>{r.name} · {r.vendor_name}</td><td>{r.next_date ? day(r.next_date) : 'Ended'}</td><td>{r.status}</td><td><details><summary>{r.history.length} occurrences</summary>{r.history.map((h: D) => <p key={h.occurrence}>{day(h.occurrence)} · {h.bill_id ? <a href={`/app/sales?tab=bills&bill=${h.bill_id}`}>{h.reference}</a> : 'Blocked'} · {h.detail}</p>)}</details></td><td>{state.actor.can.record && <div className="row-actions"><button className="btn btn-secondary" onClick={() => setEditing(r)}>Edit template</button>{r.status !== 'ended' && <Action run={async () => { await command('recurring-bill.status', { id: r.id, revision: r.revision, status: r.status === 'paused' ? 'active' : 'paused' }); await reload() }}>{r.status === 'paused' ? 'Resume' : 'Pause'}</Action>}</div>}</td></tr>)}</Table>
    {state.actor.can.record && <>
      <Action run={async () => { await command('recurring-bill.generate', { through: today() }); await reload() }}>Generate due bills</Action>
      <Form key={t?.revision ?? 'new'} label={t ? 'Save recurring bill template' : 'Create recurring bill template'} submit={v => command('recurring-bill.save', { ...v, id: t?.id, revision: t?.revision, lines: [{ description: v.description, amount: v.amount, accountId: v.accountId,className:v.className,locationName:v.locationName,projectName:v.projectName }] })} onDone={async () => { setEditing(null); await reload() }}>
        <div className="grid-form">
          <Field label="Bill template name" name="name" required defaultValue={t?.name} />
          <Field label="Recurring bill vendor" name="vendorId" required defaultValue={t?.vendor_id} options={contactOptions(state.contacts, 'vendor')} />
          <Field label="Recurring bill description" name="description" required defaultValue={t?.lines[0]?.description} />
          <Field label="Recurring bill account" name="accountId" required defaultValue={t?.lines[0]?.accountId} options={expenses} />
          <DimensionFormFields label="Recurring bill" defaults={t?.lines[0]} />
          <Field label="Recurring bill amount" name="amount" required inputMode="decimal" defaultValue={t?.lines[0]?.amount} />
          <Field label="First bill date" name="startDate" type="date" required defaultValue={t?.start_date ?? today()} />
          <Field label="Last bill date" name="endDate" type="date" defaultValue={t?.end_date ?? ''} />
          <Field label="Repeat interval" name="every" type="number" required defaultValue={t?.every ?? 1} min={1} max={12} />
          <Field label="Repeat unit" name="unit" defaultValue={t?.unit ?? 'month'} options={[{ value: 'week', label: 'Weeks' }, { value: 'month', label: 'Months' }, { value: 'year', label: 'Years' }]} />
          <Field label="Recurring bill terms (days)" name="termsDays" type="number" defaultValue={t?.terms_days ?? ''} min={0} max={365} hint="Blank uses vendor terms" />
          <Field label="Recurring bill memo" name="memo" defaultValue={t?.memo} />
        </div>
        {t && <button type="button" className="btn btn-secondary" onClick={() => setEditing(null)}>Cancel template edit</button>}
      </Form>
    </>}
  </Card>
}
