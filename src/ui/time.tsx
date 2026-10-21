import { useState } from 'react'
import { Card, Chip, command, Field, Form, Loading, PageHead, Table, today, useShared, useView, type D } from './kit'

export function Time() {
  const { state } = useShared(), { data, error, reload } = useView<D>('time')
  const [customer, setCustomer] = useState(''), [saved, setSaved] = useState(0)
  if (!data) return <Loading what="Time" error={error} />
  const choose = (rows: D[]) => rows.map(r => ({ value: r.id ?? r.email, label: r.name }))
  return <>
    <PageHead title="Time" lead="Record hours against a customer, project and service. Waiting hours join that customer's next invoice." />
    <Card title="Record time">
      <Form key={saved} label="Record hours" submit={b => command('time.save', b)} onDone={async () => { setSaved(n => n + 1); setCustomer(''); await reload() }} className="grid-form">
        <Field label="Person" name="personEmail" defaultValue={state.actor.email} options={choose(data.people)} required />
        <Field label="Work date" name="date" type="date" defaultValue={today()} required />
        <Field label="Customer" name="customerId" empty="Choose customer" options={choose(data.customers)} required onChange={(e: any) => setCustomer(e.target.value)} />
        <Field key={customer} label="Project" name="projectId" empty="Choose project" options={choose(data.projects.filter((p: D) => p.customer_id === customer))} required />
        <Field label="Service item" name="itemId" empty="Choose service" options={choose(data.services)} required />
        <Field label="Hours" name="hours" inputMode="decimal" required hint="Up to 24 hours per entry" />
        <Field label="Work notes" name="note" type="textarea" />
      </Form>
    </Card>
    {state.actor.role !== 'time-only' && state.actor.can.record && <Card title="Add project"><Form label="Add project" submit={b => command('time-project.save', b)} onDone={reload} className="grid-form"><Field label="Customer" name="customerId" empty="Choose customer" options={choose(data.customers)} required /><Field label="Project name" name="name" required /></Form></Card>}
    <Card title="Recorded hours"><Table heads={['Date', 'Person', 'Customer / project', 'Service', 'Hours', 'Status']} empty="No time recorded yet.">{data.entries.map((t: D) => <tr key={t.id}><td>{t.work_date}</td><td>{data.people.find((p: D) => p.email === t.person_email)?.name ?? t.person_email}</td><td>{t.customer}<small className="sub">{t.project}</small></td><td>{t.service}{t.note && <small className="sub">{t.note}</small>}</td><td>{(t.minutes / 60).toFixed(2)}</td><td><Chip>{t.invoiced ? 'On invoice' : 'Waiting for invoice'}</Chip></td></tr>)}</Table></Card>
  </>
}
