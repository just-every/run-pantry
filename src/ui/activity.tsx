import { useEffect, useState } from 'react'
import { Card, Chip, Field, Form, Loading, PageHead, Table, useView, useWho, type D } from './kit'
import { actionLabel, approvalLabel, detailFacts, recordLabel } from './activity-labels'

function Evidence({ event }: { event: D }) {
  const detail = JSON.parse(event.detail || '{}'), facts = detailFacts(event.detail)
  return <details><summary>Inspect history</summary>
    <>{detail.erasure?.notice && <p className="callout">{detail.erasure.notice}</p>}</><dl><dt>Record</dt><dd>{event.subject_kind} · {event.subject_id}</dd><dt>Revision</dt><dd>{event.subject_revision || 'Legacy event without a recorded revision'}{event.subject_revision === event.id ? ' (history snapshot)' : ''}</dd>
      <dt>Actor</dt><dd>{event.actor_email} · {event.origin_kind || event.actor_kind}</dd><dt>Time</dt><dd>{event.at}</dd>
      {event.authority_id && <><dt>Standing authority</dt><dd>{recordLabel(event.authority_kind)} · {event.authority_id} · revision {event.authority_revision || 'unversioned'}</dd></>}
      {event.approval && <><dt>Approval relied on</dt><dd>{event.approval.actor_email} · {event.approval.at} · {event.approval.subject_kind} {event.approval.subject_id} · revision {event.approval.subject_revision}{event.approval.note ? ` · ${event.approval.note}` : ''}</dd></>}
      {Object.entries(facts).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{value}</dd></div>)}
    </dl>
    {('before' in detail || 'after' in detail) && <div className="grid-form"><div><strong>Before</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail.before ?? null, null, 2)}</pre></div><div><strong>After</strong><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(detail.after ?? null, null, 2)}</pre></div></div>}
  </details>
}

export function Activity() {
  const [query, setQuery] = useState(''), [people, setPeople] = useState<string[]>([]), { data, error } = useView<D>(`activity${query ? `?${query}` : ''}`), who = useWho()
  useEffect(() => { if (data?.people) setPeople(data.people) }, [data?.people])
  return <>
    <PageHead title="Activity" lead="Who changed the books, the revision they changed, and the approval or standing authority they relied on." />
    <Card title="Find history"><Form label="Filter activity" className="grid-form" submit={async b => { setQuery(new URLSearchParams(Object.entries(b).filter(([, v]) => v !== '') as [string, string][]).toString()) }}>
      <Field label="Person or connection" name="person" options={people.map((email: string) => ({ value: email, label: who(email) }))} empty="Everyone" />
      <Field label="From date" name="from" type="date" /><Field label="Through date" name="to" type="date" />
      <Field label="Record reference" name="record" placeholder="Copy from Inspect history" />
    </Form></Card>
    {!data ? <Loading error={error} what="activity" /> : <>
      <Card title="Activity"><Table heads={['When', 'Who', 'Action', 'Record']} empty="No activity matches these filters.">
        {data.audit.map((e: D) => <tr key={e.id}><td>{new Date(e.at).toLocaleString()}</td><td><div>{who(e.actor_email)}</div><small className="sub">{({ person: 'Person', rule: 'Rule', agent: 'Books agent' } as Record<string, string>)[e.origin_kind || e.actor_kind] ?? 'Person'}</small></td><td>{actionLabel(e.action)}</td><td>{recordLabel(e.subject_kind, e.subject_id)}<Evidence event={e} /></td></tr>)}
      </Table></Card>
      <Card title="Approvals"><Table heads={['When', 'Who', 'What', 'Decision', 'History']} empty="No approvals match these filters.">
        {data.approvals.map((a: D) => <tr key={a.id}><td>{new Date(a.at).toLocaleString()}</td><td>{who(a.actor_email)}</td><td>{approvalLabel(a.subject_kind, a.action)}</td><td><Chip tone={a.decision === 'approved' ? 'good' : 'warn'}>{a.decision === 'approved' ? 'Approved' : 'Declined'}</Chip>{a.note && <small className="sub">{a.note}</small>}</td><td><details><summary>Inspect approval</summary><dl><dt>Record</dt><dd>{recordLabel(a.subject_kind, a.subject_id)} · {a.subject_id}</dd><dt>Revision</dt><dd>{a.subject_revision}</dd><dt>Action</dt><dd>{a.action}</dd></dl></details></td></tr>)}
      </Table></Card>
    </>}
  </>
}
