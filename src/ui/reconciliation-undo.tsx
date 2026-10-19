import { Card, Field, Form, day, usd, useShared, type D } from './kit'
import { command } from './kit'

export function ReconciliationUndo({ info, history, statementId, onDone }: { info: D | null; history: D[]; statementId: string; onDone: () => Promise<void> }) {
  const { state } = useShared()
  return <>
    {info && state.actor.can.reopen && <Card title="Undo reconciliation">
      <p>These reconciliations will be undone in this order. Their proofs and statements stay in history, matches become editable, and every posting stays as it is.</p>
      <ol>{info.reconciliations.map((r: D) => <li key={r.id}>{day(r.end_date)} · {r.source_name} · closing {usd(r.closing_cents)}</li>)}</ol>
      {info.locked.length ? <div role="status"><p>Reopen the locked months before undoing:</p>{info.locked.map((p: D) => <p key={p.id}><a href={`/app/close?period=${p.id}`}>Request reopening of {p.id}</a></p>)}</div>
        : <Form label={`Confirm undo of ${info.reconciliations.length} reconciliation${info.reconciliations.length === 1 ? '' : 's'}`} submit={b => command('reconciliation.undo', { ...b, statementId, reconciliationIds: info.reconciliations.map((r: D) => r.id) })} onDone={onDone}>
          <Field label="Reason for undoing reconciliation" name="reason" required />
        </Form>}
    </Card>}
    {history.length > 0 && <Card title="Voided reconciliation history">{history.map((h: D) => <details key={h.id}>
      <summary>{day(h.end_date)} · undone by {h.undone_by} · {day(h.undone_at)}</summary>
      <p>{h.reason}</p><p>Undo {h.undo_id} · step {h.sequence + 1} · original proof {h.id}</p>
      <p><a href={`/api/pantry/documents/${h.snapshot.statement.document_id}`}>Original statement: {h.snapshot.statement.source_name}</a></p>
      <p>Statement opening {usd(h.snapshot.statement.opening_cents)}; closing {usd(h.snapshot.statement.closing_cents)}.</p>
      <details><summary>Retained proof and statement details</summary><pre>{JSON.stringify(h.snapshot, null, 2)}</pre></details>
    </details>)}</Card>}
  </>
}
