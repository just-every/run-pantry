import { useState } from 'react'
import { Action, Card, Field, Form, Loading, Table, command, useShared, useView, usd, type D } from './kit'
export function TaxReadiness() {
  const { state } = useShared(),
    [year, setYear] = useState(new Date().getFullYear()),
    { data, error, reload } = useView<D>(`tax-readiness?year=${year}`),
    [links, setLinks] = useState<Record<string, string>>({})
  if (!['owner', 'accountant'].includes(state.actor.role)) return null
  return (
    <Card title="Tax readiness all year">
      <Field
        label="Readiness year"
        name="readinessYear"
        type="number"
        value={year}
        onChange={(e: any) => setYear(Number(e.target.value))}
      />
      {!data ? (
        <Loading error={error} what="tax readiness" />
      ) : (
        <>
          <p>{data.note}</p>
          <Table heads={['Proposed request', 'Paid', 'Action']} empty="No W-9 requests needed.">
            {data.w9Proposals.map((v: D) => (
              <tr key={v.contactId}>
                <td>
                  {v.summary} · {v.status}
                </td>
                <td>{usd(v.paid)}</td>
                <td>
                  {state.actor.role === 'owner' && (
                    <Action
                      run={async () => {
                        const r = await command('w9.request', { contactId: v.contactId, contactRevision: v.contactRevision, consent: true })
                        setLinks((s) => ({ ...s, [v.contactId]: r.url }))
                        await reload()
                      }}
                    >
                      Approve private request
                    </Action>
                  )}
                  {links[v.contactId] && (
                    <a href={links[v.contactId]} rel="noreferrer" target="_blank">
                      Open W-9 request
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </Table>
          <h3>Nexus signals</h3>
          <ul>
            {data.nexus.map((s: D) => (
              <li key={s.state}>
                {s.state}: {(s.reached / 100).toFixed(0)}% of threshold · review with accountant
              </li>
            ))}
          </ul>
          <h3>Deadline reminders</h3>
          <Table heads={['Deadline', 'Due', 'Estimated amount', 'Reminder']} empty="No recorded deadlines.">
            {data.deadlines.map((d: D) => (
              <tr key={d.id}>
                <td>{d.label}</td>
                <td>{d.due_date}</td>
                <td>{d.amount_cents === null ? 'Not set' : `${usd(d.amount_cents)} · estimate`}</td>
                <td>
                  {d.completed_at
                    ? 'Complete'
                    : d.overdue
                      ? 'Overdue'
                      : d.reminder
                        ? 'Due within 30 days'
                        : 'Upcoming'}
                </td>
              </tr>
            ))}
          </Table>
          {data.canSetDeadlines && (
            <details>
              <summary>Record a tax deadline</summary>
              <Form label="Save deadline" submit={(b) => command('tax.deadline', b)} onDone={reload}>
                <Field label="Deadline description" name="label" required />
                <Field label="Due date" name="dueDate" type="date" required />
                <Field label="Estimated amount" name="amount" />
              </Form>
            </details>
          )}
          <p>
            <a
              className="btn btn-secondary"
              href={`/api/pantry/tax-readiness/${year}/package`}
              download={`tax-year-${year}.json`}
            >
              Download year-end tax package
            </a>
          </p>
        </>
      )}
    </Card>
  )
}
