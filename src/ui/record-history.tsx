import { actionLabel } from './activity-labels'
import { Card, Details, Table, day, type D } from './kit'

export function RecordHistory({ record }: { record: D }) {
  return <>
    <Card title="Approvals">
      {record.approvals.length ? <Table heads={['When', 'Who', 'Action', 'Revision', 'Decision']} empty="No recorded approval.">
        {record.approvals.map((a: D) => <tr key={a.id}><td>{day(a.at)}</td><td>{a.actor_email}</td><td>{actionLabel(a.action)}</td><td>{a.subject_revision ?? 'Not recorded'}</td><td>{a.decision}{a.note && <small className="sub"> · {a.note}</small>}</td></tr>)}
      </Table> : <p>No approval is recorded for this transaction or its journal entries.</p>}
    </Card>
    <Card title="Audit history">
      {record.audit.length ? record.audit.map((e: D) => <div key={e.id}>
        <p>{day(e.at)} · {e.actor_email} · {actionLabel(e.action)}</p>
        <Details facts={{ 'Record revision': e.subject_revision, 'Origin': e.origin_kind, 'Authority': e.authority_kind, 'Approval': e.approval_id, 'Decision': e.approval?.decision, 'Recorded detail': e.detail }} code={['Recorded detail']} />
      </div>) : <p>No audit event is recorded for this transaction.</p>}
    </Card>
    <Card title="Provider events">
      {record.providerEvents.length ? record.providerEvents.map((e: D) => <div key={`${e.provider}:${e.kind}:${e.id}`}>
        <p>{e.provider} · {e.kind}</p>
        <Details facts={{ 'Provider record': e.id, 'Retained evidence': JSON.stringify(e.evidence, null, 2) }} code={['Provider record', 'Retained evidence']} />
      </div>) : <p>No provider event is linked to this transaction.</p>}
    </Card>
  </>
}
