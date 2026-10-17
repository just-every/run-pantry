// Recurring invoices: templates with their schedule and next date, what each
// occurrence becomes, approval for templates that send on their own, and the
// runs so far (with the reason for any that failed).
import { useState } from 'react'
import { Action, Card, Chip, command, contactOptions, Field, Table, day, today, usd, useShared, useWho, type D } from './kit'
import { blank, lineTotals, ServiceLines, type Line } from './invoice-editor'

const SCHEDULES: Record<string, { label: string; every: number; unit: string }> = {
  weekly: { label: 'Every week', every: 1, unit: 'week' }, biweekly: { label: 'Every two weeks', every: 2, unit: 'week' },
  monthly: { label: 'Every month', every: 1, unit: 'month' }, quarterly: { label: 'Every three months', every: 3, unit: 'month' }, yearly: { label: 'Every year', every: 1, unit: 'year' },
}
const scheduleKey = (t: D) => Object.entries(SCHEDULES).find(([, s]) => s.every === t.every && s.unit === t.unit)?.[0]
export const scheduleLabel = (t: D) => SCHEDULES[scheduleKey(t) ?? '']?.label ?? `Every ${t.every} ${t.unit}s`

const STATUS: Record<string, [string, 'good' | 'warn' | 'info' | 'neutral']> = { active: ['Active', 'good'], 'awaiting-approval': ['Waiting for approval', 'warn'], paused: ['Paused', 'neutral'], ended: ['Ended', 'neutral'] }
const RUN: Record<string, [string, 'good' | 'warn' | 'bad' | 'info' | 'neutral']> = { drafted: ['Draft for approval', 'info'], issued: ['Issued', 'info'], sent: ['Issued and sent', 'good'], failed: ['Failed', 'bad'] }

function Editor({ t, onDone, onCancel }: { t?: D; onDone: (saved: D) => void; onCancel: () => void }) {
  const { state } = useShared(), income = state.accounts.filter((a: D) => a.type === 'income' && a.active)
  const [lines, setLines] = useState<Line[]>(t?.lines ?? [blank(income[0]?.id)]), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const { tax, subtotal } = lineTotals(lines, state.taxCodes)
  return <form className="invoice-editor" onSubmit={async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget)) as D, s = SCHEDULES[f.schedule]
    setBusy(true); setError('')
    try { onDone(await command('recurring.save', { ...f, every: s.every, unit: s.unit, id: t?.id, revision: t?.revision, lines })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="split split-wide-left">
      <div className="stack">
        <Card title={t ? `Edit ${t.number}` : 'New recurring invoice'}>
          <div className="grid-form">
            <Field label="Customer" name="customerId" defaultValue={t?.customer_id} required options={contactOptions(state.contacts, 'customer')} />
            <Field label="Repeats" name="schedule" defaultValue={t ? scheduleKey(t) : 'monthly'} required options={Object.entries(SCHEDULES).map(([value, s]) => ({ value, label: s.label }))} />
            <Field label="First invoice date" name="startDate" type="date" defaultValue={t?.start_date ?? today()} required hint="Later invoices fall on the same day of the period; a month-end date stays at month end" />
            <Field label="Last invoice date (optional)" name="endDate" type="date" defaultValue={t?.end_date ?? ''} hint="Blank repeats until you end it" />
            <Field label="Payment terms (days)" name="termsDays" type="number" min={0} max={365} defaultValue={t?.terms_days ?? ''} hint="Blank uses the customer's terms" />
            <Field label="Each invoice" name="mode" defaultValue={t?.mode ?? 'draft'} required options={[{ value: 'draft', label: 'Is created as a draft for approval' }, { value: 'send', label: 'Is issued and emailed automatically' }]} hint="Automatic sending starts once someone other than you, with the posting grant, approves this template" />
          </div>
        </Card>
        <ServiceLines lines={lines} setLines={setLines} />
        <Card title="Memo"><Field label="Memo on each invoice" name="memo" type="textarea" defaultValue={t?.memo} wide /></Card>
      </div>
      <Card title="Each invoice">
        <dl className="summary"><div><dt>Subtotal</dt><dd>{usd(subtotal)}</dd></div><div><dt>Sales tax</dt><dd>{usd(tax)}</dd></div><div className="total"><dt>Total</dt><dd>{usd(subtotal + tax)}</dd></div></dl>
        <div className="form-end column"><button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save recurring invoice'}</button><button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>{error && <p role="alert" className="error">{error}</p>}</div>
      </Card>
    </div>
  </form>
}

function Panel({ t, onChange, onEdit }: { t: D; onChange: () => Promise<void>; onEdit: () => void }) {
  const { state } = useShared(), who = useWho(), [label, tone] = STATUS[t.status]
  const mayApprove = state.actor.can.post && (state.actor.role === 'owner' || t.prepared_by !== state.actor.email)
  const status = (to: string) => async () => { await command('recurring.status', { id: t.id, status: to }); await onChange() }
  return <Card title={<>{t.customer_name} — {t.number}</>} actions={<Chip tone={tone}>{label}</Chip>}>
    <p>{scheduleLabel(t)} from {day(t.start_date)}{t.end_date ? <> until {day(t.end_date)}</> : ''}, {usd(t.total_cents)} each. {t.mode === 'send' ? 'Each invoice is issued and emailed automatically.' : 'Each invoice is created as a draft for approval.'}</p>
    <dl className="facts">
      <div><dt>Next invoice</dt><dd>{t.next_date && t.status !== 'ended' ? day(t.next_date) : '—'}</dd></div>
      <div><dt>Prepared by</dt><dd>{who(t.prepared_by)}</dd></div>
      {t.mode === 'send' && <div><dt>Approved by</dt><dd>{t.approved_by ? who(t.approved_by) : 'Not yet: the owner, or someone else with the posting grant'}</dd></div>}
    </dl>
    <div className="row-actions">
      {t.status === 'awaiting-approval' && (mayApprove ? <Action tone="primary" run={async () => { await command('recurring.approve', { id: t.id, revision: t.revision }); await onChange() }}>Approve automatic sending</Action> : <span className="hint">Approval needs the posting grant and a different person from the preparer.</span>)}
      {state.actor.can.record && t.status !== 'ended' && <>
        <button type="button" className="btn btn-secondary" onClick={onEdit}>Edit</button>
        {t.status === 'paused' ? <Action run={status('active')}>Resume</Action> : <Action run={status('paused')}>Pause</Action>}
        <Action tone="danger" run={status('ended')}>End</Action>
      </>}
    </div>
    <h3>Invoices so far</h3>
    <Table heads={['Date', 'Invoice', 'Result']} empty="None yet; the first is created on its date.">
      {t.runs_list.map((r: D) => { const [l, tn] = RUN[r.status]; return <tr key={r.occurrence}><td>{day(r.occurrence)}</td><td className="nowrap">{r.invoice_number ?? '—'}</td><td><Chip tone={tn}>{l}</Chip>{r.detail && <small className="sub block">{r.detail}</small>}</td></tr> })}
    </Table>
  </Card>
}

export function Recurring({ data, reload }: { data: D; reload: () => Promise<void> }) {
  const { state } = useShared(), [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ t?: D } | null>(null)
  const templates = data.recurring as D[], current = templates.find(t => t.id === selected)
  if (editing) return <Editor t={editing.t} onCancel={() => setEditing(null)} onDone={async saved => { setEditing(null); await reload(); setSelected(saved.id) }} />
  return <div className="split split-wide-left">
    <Card title="Recurring invoices" actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => setEditing({})}>New recurring invoice</button>}>
      <Table heads={['Customer', 'Number', 'Repeats', 'Amount', 'Next invoice', 'Status']} figures={[3]} empty="No recurring invoices yet. Set one up for a retainer or subscription.">
        {templates.map(t => { const [label, tone] = STATUS[t.status]; return <tr key={t.id} className={selected === t.id ? 'selected' : ''} tabIndex={0} onClick={() => setSelected(t.id)} onKeyDown={k => { if (k.key === 'Enter') setSelected(t.id) }}>
          <td>{t.customer_name}</td><td className="nowrap">{t.number}</td><td>{scheduleLabel(t)}</td><td className="fig">{usd(t.total_cents)}</td><td>{t.next_date && t.status !== 'ended' ? day(t.next_date) : '—'}</td><td><Chip tone={tone}>{label}</Chip></td></tr> })}
      </Table>
    </Card>
    {current ? <Panel key={current.id + current.revision + current.status} t={current} onChange={reload} onEdit={() => setEditing({ t: current })} /> : <Card title="Recurring invoice"><p>Choose a recurring invoice to see its schedule, approve it or pause it.</p></Card>}
  </div>
}
