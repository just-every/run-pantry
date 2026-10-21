import { useState } from 'react'
import { Action, Card, Chip, command, Field, Form, ROLE_LABEL, Table, today, usd, useShared, useView, type D } from './kit'

export function canSelfApprove(state: D, document: D) {
  const limit = state.settings.issuingLimits?.effective
  const amount = document.kind === 'credit' ? limit?.credit_cents : limit?.issuing_cents
  return state.actor.can.post && document.prepared_by === state.actor.email && amount > 0 && document.total_cents <= amount
}

export function IssuingLimits() {
  const { state, reload } = useShared(), rows = state.settings.issuingLimits.rows as D[]
  const [id, setId] = useState('role:bookkeeper'), [day, setDay] = useState(today()), [person, setPerson] = useState('')
  const current = rows.find(r => r.id === id)
  const { data, error } = useView<D>(`self-approved?day=${day}&person=${encodeURIComponent(person)}`)
  const people = state.settings.members as D[]
  return <Card title="Issuing limits">
    <p>A posting grant is still required. Limits cover the full USD total including tax, after discounts and delivery, before deposits or early-payment offers. A person setting overrides their role, including no limit. Blank or zero means a second person approves.</p>
    <Field label="Limit for" name="limitFor" value={id} onChange={(e: any) => setId(e.target.value)} options={[{ value: 'role:bookkeeper', label: 'Bookkeeper role' }, { value: 'role:accountant', label: 'Accountant role' }, ...people.map(p => ({ value: `person:${p.email}`, label: p.name + ' — ' + p.email }))]} />
    <Form key={id + current?.revision} label="Save issuing limits" submit={b => command('issuing-limit.save', { ...b, id, revision: current?.revision })} onDone={reload} className="grid-form">
      <Field label="Invoice issuing limit (USD)" name="issuing" inputMode="decimal" defaultValue={current ? (current.issuing_cents / 100).toFixed(2) : ''} />
      <Field label="Credit limit (USD)" name="credit" inputMode="decimal" defaultValue={current ? (current.credit_cents / 100).toFixed(2) : ''} />
    </Form>
    {id.startsWith('person:') && current && <Action run={async () => { await command('issuing-limit.save', { id, revision: current.revision, inherit: true }); await reload() }}>Use role limit</Action>}
    <Table heads={['Role or person', 'Issuing', 'Credit']} empty="No self-approval limits configured.">{rows.map(r => <tr key={r.id}><td>{r.id.startsWith('role:') ? ROLE_LABEL[r.id.slice(5)] + ' role' : people.find(p => p.email === r.id.slice(7))?.name ?? r.id.slice(7)}</td><td>{r.issuing_cents ? usd(r.issuing_cents) : 'No self-approval'}</td><td>{r.credit_cents ? usd(r.credit_cents) : 'No self-approval'}</td></tr>)}</Table>
    <h3>Self-approved documents</h3><p className="hint">Each document is checked separately. Review this daily list for split invoices. Dates use UTC.</p>
    <div className="grid-form"><Field label="Approval date" name="approvalDate" type="date" value={day} onChange={(e: any) => setDay(e.target.value)} /><Field label="Prepared by" name="approvalPerson" value={person} onChange={(e: any) => setPerson(e.target.value)} empty="Everyone" options={people.map(p => ({ value: p.email, label: p.name }))} /></div>
    {error && <p role="alert">{error}</p>}
    <Table heads={['Document', 'Person', 'Total', 'Approval']} empty="No self-approved documents for this date and person.">{data?.documents.map((d: D) => { const a = JSON.parse(d.self_approval); return <tr key={d.id}><td><a href="/app/sales">{d.number}</a></td><td>{d.prepared_by}</td><td>{usd(d.total_cents)}</td><td><Chip>Self-approved within limit</Chip><small className="sub">{usd(a.limit)} · {a.source}</small></td></tr> })}</Table>
  </Card>
}
