// Close's recurring-journal workspace uses the same journal lines and approval
// rules as Books. Template changes never approve their own future postings.
import { useState } from 'react'
import { Action, Card, Chip, Field, Form, Loading, Table, accountOptions, amountText, command, day, today, usd, useShared, useView, useWho, type D } from './kit'

const STATUS: Record<string, string> = { active: 'Active', 'awaiting-approval': 'Waiting for approval', paused: 'Paused', ended: 'Ended', drafted: 'Draft for approval', posted: 'Posted', blocked: 'Blocked', failed: 'Failed', missed: 'Missed' }
type InputLine = { accountId: string; debit: string; credit: string; memo: string; contactId?: string | null }
const blank = (): InputLine => ({ accountId: '', debit: '', credit: '', memo: '' })

function TemplateEditor({ template, onDone, cancel }: { template?: D; onDone: () => Promise<void>; cancel: () => void }) {
  const { state } = useShared()
  const [lines, setLines] = useState<InputLine[]>(template ? template.lines.map((l: D) => ({ ...l, debit: l.debit ? amountText(l.debit) : '', credit: l.credit ? amountText(l.credit) : '' })) : [blank(), blank()])
  const update = (i: number, change: Partial<InputLine>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...change } : l))
  return <Card title={template ? `Edit ${template.name}` : 'New recurring journal'}>
    <p className="hint">Automatic posting requires approval of the exact template revision. Every edit returns posting templates to approval. Draft schedules create entries for a person to review in Books.</p>
    <Form label="Save journal template" submit={b => command('recurring-journal.save', { ...b, id: template?.id, revision: template?.revision, lines })} onDone={onDone}
      secondary={<button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button>}>
      <div className="grid-form">
        <Field label="Template name" name="name" defaultValue={template?.name} required />
        <Field label="Entry description" name="memo" defaultValue={template?.memo} required />
        <Field label="Every (months)" name="every" type="number" min={1} max={12} defaultValue={template?.every ?? 1} required readOnly={!!template?.runs} />
        <Field label="First entry date" name="startDate" type="date" defaultValue={template?.start_date ?? today()} required readOnly={!!template?.runs} />
        <Field label="Last entry date (optional)" name="endDate" type="date" defaultValue={template?.end_date} />
        <Field label="Each occurrence" name="mode" defaultValue={template?.mode ?? 'draft'} required options={[{ value: 'draft', label: 'Create a draft for review' }, { value: 'post', label: 'Post under template approval' }]} />
      </div>
      <p className="hint">Dates stay anchored to the first day chosen: a 31st uses February's last day, then returns to the 31st. The last date is inclusive. Missed runs keep their original dates; locked dates remain exceptions.</p>
      {lines.map((l, i) => <div className="grid-form line" key={i}>
        <Field label={`Line ${i + 1} account`} name={`account${i}`} value={l.accountId} onChange={(e: any) => update(i, { accountId: e.target.value })} required options={accountOptions(state.accounts, a => !['receivable', 'payable'].includes(a.subtype))} />
        <Field label={`Line ${i + 1} memo`} name={`memo${i}`} value={l.memo} onChange={(e: any) => update(i, { memo: e.target.value })} />
        <Field label={`Line ${i + 1} debit`} name={`debit${i}`} inputMode="decimal" value={l.debit} onChange={(e: any) => update(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} />
        <Field label={`Line ${i + 1} credit`} name={`credit${i}`} inputMode="decimal" value={l.credit} onChange={(e: any) => update(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} />
        {lines.length > 2 && <button type="button" className="btn btn-link" onClick={() => setLines(ls => ls.filter((_, j) => i !== j))}>Remove line {i + 1}</button>}
      </div>)}
      <button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, blank()])}>Add journal line</button>
    </Form>
  </Card>
}

function Coding({ lines }: { lines: D[] }) {
  const { state } = useShared()
  return <Table heads={['Account', 'Memo', 'Debit', 'Credit']} figures={[2, 3]}>
    {lines.map((l: D, i: number) => { const a = state.accounts.find((a: D) => a.id === l.accountId)
      return <tr key={i}><td>{a?.code} · {a?.name}</td><td>{l.memo || '—'}</td><td className="fig">{l.debit ? usd(l.debit) : '—'}</td><td className="fig">{l.credit ? usd(l.credit) : '—'}</td></tr>
    })}
  </Table>
}

export function RecurringJournals() {
  const { data, error, reload } = useView<D>('recurring-journals'), { state, reload: reloadShared } = useShared(), who = useWho()
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ template?: D } | null>(null)
  const refresh = async () => { await Promise.all([reload(), reloadShared()]) }
  if (!data) return <Card title="Recurring journals"><Loading error={error} what="recurring journals" /></Card>
  const current = data.templates.find((t: D) => t.id === selected)
  const mayApprove = current && current.status === 'awaiting-approval' && state.actor.can.post && (state.actor.role === 'owner' || current.prepared_by !== state.actor.email)
  if (editing) return <TemplateEditor key={editing.template?.id ?? 'new'} template={editing.template} cancel={() => setEditing(null)} onDone={async () => { setEditing(null); await refresh() }} />
  return <div className="stack">
    <Card title="Recurring journals" actions={state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={() => setEditing({})}>New recurring journal</button>}>
      {error && <p role="alert" className="error">{error}</p>}
      <Table heads={['Template', 'Repeats', 'Next entry', 'Status']} empty="No recurring journals yet.">
        {data.templates.map((t: D) => <tr key={t.id}><td><button type="button" className="btn btn-link" onClick={() => setSelected(t.id)}>{t.name}</button></td><td>Every {t.every} month{t.every === 1 ? '' : 's'}</td><td>{day(t.next_date)}</td><td><Chip tone={t.status === 'awaiting-approval' ? 'warn' : 'neutral'}>{STATUS[t.status]}</Chip></td></tr>)}
      </Table>
    </Card>
    <Card title="Missed and failed journal runs">
      <Table heads={['Entry date', 'Template', 'Status', 'Reason', '']} empty="No missed or failed journal runs.">
        {data.exceptions.map((r: D) => { const t = data.templates.find((t: D) => t.id === r.recurring_id)
          return <tr key={`${r.recurring_id}:${r.occurrence}`}><td>{day(r.occurrence)}</td><td><button type="button" className="btn btn-link" onClick={() => setSelected(r.recurring_id)}>{r.name}</button></td><td><Chip tone="warn">{STATUS[r.status]}</Chip></td><td>{r.detail}{r.template_revision !== t.revision && <small className="sub">Earlier template revision retained; prepare a corrective journal.</small>}</td><td>{state.actor.can.record && r.status !== 'missed' && t.revision === r.template_revision && ['active', 'ended'].includes(t.status) && <Action run={async () => { await command('recurring-journal.retry', { id: t.id, revision: t.revision, occurrence: r.occurrence }); await refresh() }}>Retry this occurrence</Action>}</td></tr>
        })}
      </Table>
    </Card>
    {current && <Card title={current.name} actions={state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={() => setEditing({ template: current })}>Edit template</button>}>
      <p>{current.memo} · {current.mode === 'post' ? 'Post under exact template approval' : 'Create drafts for review'}.</p>
      <p>Prepared by {who(current.prepared_by)}; {current.approved_revision === current.revision ? `approved by ${who(current.approved_by)}` : current.mode === 'post' ? 'approval required' : 'each generated draft requires approval'}.</p>
      <Coding lines={current.lines} />
      <div className="row-actions">
        {mayApprove && <Action tone="primary" run={async () => { await command('recurring-journal.approve', { id: current.id, revision: current.revision }); await refresh() }}>Approve this template revision</Action>}
        {state.actor.can.record && current.status !== 'ended' && <Action run={async () => { await command('recurring-journal.status', { id: current.id, revision: current.revision, status: current.status === 'paused' ? 'active' : 'paused' }); await refresh() }}>{current.status === 'paused' ? 'Resume schedule' : 'Pause schedule'}</Action>}
        <a href="/app/books">Review generated drafts in Books</a>
      </div>
      <Table heads={['Entry date', 'Journal', 'Result', 'Approved version']} empty="No occurrences have run yet.">
        {current.runs_list.map((r: D) => { const snapshot = JSON.parse(r.template_snapshot)
          return <tr key={r.occurrence}><td>{day(r.occurrence)}{!!r.late && <small className="sub">Attempted after its scheduled date</small>}</td><td>{r.journal_id ? <a href={`/app/reports?record=${encodeURIComponent(`entry:${r.journal_id}`)}`}>{r.journal_number ? `Journal ${r.journal_number}` : 'Journal draft'}</a> : '—'}</td><td><Chip tone={r.status === 'blocked' || r.status === 'failed' ? 'warn' : 'neutral'}>{r.reversed_by_id ? 'Reversed' : r.status === 'drafted' && !r.journal_id ? 'Draft discarded' : r.journal_status === 'posted' ? 'Posted' : STATUS[r.status]}</Chip><small className="sub">{r.detail}</small></td><td><details className="details"><summary>Template at this occurrence</summary><p>{snapshot.memo}</p><Coding lines={snapshot.lines} /><p>{snapshot.approved_by ? `Template approved by ${who(snapshot.approved_by)}.` : 'Created as a draft for individual approval.'}</p><a href="/app/activity">Open activity log</a></details></td></tr>
        })}
      </Table>
    </Card>}
  </div>
}
