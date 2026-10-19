import { useState } from 'react'
import { Action, Card, Chip, Field, Form, Loading, Table, accountOptions, amountText, command, day, usd, useShared, useView, useWho, type D } from './kit'

type Kind = 'prepaid' | 'accrual' | 'deferred'
type Milestone = { id?: string; date: string; amount: string; label: string }
const KINDS: Record<Kind, string> = { prepaid: 'Prepaid expense', accrual: 'Accrued expense', deferred: 'Deferred revenue' }
const STATUS: Record<string, string> = { 'awaiting-approval': 'Waiting for approval', active: 'Active', ended: 'Ended', pending: 'Scheduled', missed: 'Missed', 'awaiting-milestone': 'Waiting for milestone', posted: 'Posted', failed: 'Failed', blocked: 'Blocked' }
const journalLink = (id: string) => `/app/reports?record=${encodeURIComponent(`entry:${id}`)}`

function ScheduleEditor({ schedule: s, sources, to, cancel, onDone }: { schedule?: D; sources: D[]; to: string; cancel: () => void; onDone: (saved: D) => Promise<void> }) {
  const { state } = useShared()
  const [kind, setKind] = useState<Kind>(s?.kind ?? 'prepaid'), [plan, setPlan] = useState(s?.kind === 'deferred' && s.months === null ? 'milestones' : 'monthly')
  const [balance, setBalance] = useState(s?.balance_account_id ?? ''), [recognition, setRecognition] = useState(s?.recognition_account_id ?? '')
  const [sourceLine, setSourceLine] = useState(s?.source_line_id ?? ''), [amount, setAmount] = useState(s ? amountText(s.amount_cents) : '')
  const [milestones, setMilestones] = useState<Milestone[]>(s?.months === null ? s.occurrences.map((o: D) => ({ id: o.id, date: o.date, amount: amountText(o.amount_cents), label: o.label })) : [{ date: to, amount: '', label: '' }])
  const funding = sources.filter(source => (!source.allocated_schedule_id || source.allocated_schedule_id === s?.id) && (!balance || source.account_id === balance) && (kind === 'prepaid' ? source.debit_cents > 0 : source.credit_cents > 0) && state.accounts.some((a: D) => a.id === source.account_id && a.active && !['receivable', 'payable'].includes(a.subtype) && a.type === (kind === 'prepaid' ? 'asset' : 'liability')))
  const source = sources.find(source => source.line_id === sourceLine)
  const updateMilestone = (i: number, patch: Partial<Milestone>) => setMilestones(rows => rows.map((row, j) => i === j ? { ...row, ...patch } : row))
  return <Card title={s ? `Edit ${s.name}` : 'New recognition schedule'}>
    <p className="hint">Approve the exact schedule revision before entries post. Editing clears approval. After an entry posts, keep its schedule and correct the books with a journal entry.</p>
    <Form label="Save recognition schedule" submit={body => command('recognition.save', {
      ...body, id: s?.id, revision: s?.revision, kind, balanceAccountId: balance, recognitionAccountId: recognition, amount,
      ...(kind === 'deferred' && plan === 'milestones' ? { milestones } : { months: Number(body.months) }),
      ...(kind !== 'accrual' ? { sourceJournalId: source?.journal_id } : {}),
    })} onDone={onDone} secondary={<button type="button" className="btn btn-secondary" onClick={cancel}>Cancel</button>}>
      <div className="grid-form">
        <Field label="Schedule name" name="name" defaultValue={s?.name} required />
        <Field label="Schedule type" name="kind" value={kind} onChange={(e: any) => { setKind(e.target.value); setBalance(''); setRecognition(''); setSourceLine(''); setPlan('monthly') }} required options={Object.entries(KINDS).map(([value, label]) => ({ value, label }))} />
        <Field label="Balance-sheet account" name="balanceAccountId" value={balance} onChange={(e: any) => { setBalance(e.target.value); setSourceLine('') }} required options={accountOptions(state.accounts, a => a.type === (kind === 'prepaid' ? 'asset' : 'liability') && !['receivable', 'payable'].includes(a.subtype))} />
        <Field label="Recognition account" name="recognitionAccountId" value={recognition} onChange={(e: any) => setRecognition(e.target.value)} required options={accountOptions(state.accounts, a => a.type === (kind === 'deferred' ? 'income' : 'expense'))} />
        {kind !== 'accrual' && <Field label="Original posted journal" name="sourceLine" value={sourceLine} onChange={(e: any) => {
          setSourceLine(e.target.value); const chosen = sources.find(source => source.line_id === e.target.value)
          if (chosen) { setBalance(chosen.account_id); setAmount(amountText(kind === 'prepaid' ? chosen.debit_cents : chosen.credit_cents)) }
        }} required options={funding.map(source => ({ value: source.line_id, label: `Journal ${source.journal_number} · ${source.entry_date} · ${source.account_name} · ${usd(kind === 'prepaid' ? source.debit_cents : source.credit_cents)}` }))} hint="Choose the entry that funded this balance. The full balance-sheet line is assigned to one schedule." />}
        <Field label={kind === 'accrual' ? 'Amount per month' : 'Total amount'} name="amount" inputMode="decimal" value={amount} onChange={(e: any) => setAmount(e.target.value)} required />
        {kind === 'deferred' && <Field label="Recognize by" name="plan" value={plan} onChange={(e: any) => setPlan(e.target.value)} required options={[{ value: 'monthly', label: 'Month' }, { value: 'milestones', label: 'Milestone' }]} />}
        <Field label={kind === 'accrual' ? 'First accrual month' : 'First recognition date'} name="startDate" type="date" defaultValue={s?.start_date ?? to} required />
        {(kind !== 'deferred' || plan === 'monthly') && <Field label="Number of months" name="months" type="number" min={1} step={1} defaultValue={s?.months ?? (kind === 'accrual' ? 1 : 12)} required />}
      </div>
      {source && kind !== 'accrual' && <p><a href={journalLink(source.journal_id)}>Review original journal {source.journal_number}</a></p>}
      <p className="hint">{kind === 'accrual' ? 'Each monthly amount posts at month end and reverses on the first day of the next month.' : kind === 'deferred' && plan === 'milestones' ? 'Milestone amounts must add up to the total. Mark each milestone achieved when the work is complete.' : 'The total is divided across the months, with remaining cents in the final month. A month-end start stays at month end.'}</p>
      {kind === 'deferred' && plan === 'milestones' && <>
        {milestones.map((milestone, i) => <div className="grid-form line" key={milestone.id ?? i}>
          <Field label={`Milestone ${i + 1} name`} name={`milestone-label-${i}`} value={milestone.label} onChange={(e: any) => updateMilestone(i, { label: e.target.value })} required />
          <Field label={`Milestone ${i + 1} date`} name={`milestone-date-${i}`} type="date" value={milestone.date} onChange={(e: any) => updateMilestone(i, { date: e.target.value })} required />
          <Field label={`Milestone ${i + 1} amount`} name={`milestone-amount-${i}`} inputMode="decimal" value={milestone.amount} onChange={(e: any) => updateMilestone(i, { amount: e.target.value })} required />
          {milestones.length > 1 && <button type="button" className="btn btn-link" onClick={() => setMilestones(rows => rows.filter((_, j) => j !== i))}>Remove milestone {i + 1}</button>}
        </div>)}
        <button type="button" className="btn btn-secondary" onClick={() => setMilestones(rows => [...rows, { date: to, amount: '', label: '' }])}>Add milestone</button>
      </>}
    </Form>
  </Card>
}

function ScheduleDetail({ schedule: s, asOf, businessToday, edit, refresh }: { schedule: D; asOf: string; businessToday: string; edit: () => void; refresh: () => Promise<void> }) {
  const { state } = useShared(), who = useWho(), can = state.actor.can
  const account = (id: string) => { const a = state.accounts.find((a: D) => a.id === id); return a ? `${a.code} · ${a.name}` : id }
  const approved = s.approved_revision === s.revision, editable = !s.runs_list.some((run: D) => run.status === 'posted')
  const mayApprove = can.post && (state.actor.role === 'owner' || s.prepared_by !== state.actor.email)
  return <Card title={s.name} actions={can.record && editable && <button type="button" className="btn btn-secondary" onClick={edit}>Edit schedule</button>}>
    <p>{KINDS[s.kind as Kind]} · {usd(s.amount_cents)}{s.kind === 'accrual' ? ' per month' : ' total'} · {s.months === null ? 'Milestone recognition' : `${s.months} month${s.months === 1 ? '' : 's'}`}.</p>
    <p>Balance-sheet account: {account(s.balance_account_id)}. Recognition account: {account(s.recognition_account_id)}.</p>
    <p>Remaining balance at {day(asOf)}: <strong>{usd(s.remaining_cents)}</strong>. Posted schedule balance: {usd(s.posted_remaining_cents)}.</p>
    <p>Prepared by {who(s.prepared_by)}; {approved ? `this revision approved by ${who(s.approved_by)}` : 'this revision needs approval'}.</p>
    {s.source_journal_id && <p><a href={journalLink(s.source_journal_id)}>Original posted funding journal</a> · {day(s.source_date)}</p>}
    {mayApprove && <p><Action tone="primary" run={async () => { await command('recognition.approve', { id: s.id, revision: s.revision }); await refresh() }}>{approved ? 'Renew schedule approval' : 'Approve this schedule revision'}</Action></p>}
    <Table heads={['Entry date', 'Occurrence', 'Amount', 'Status', 'Journal', 'Action']} figures={[2]} caption={`${s.name} scheduled postings`}>
      {s.occurrences.map((o: D) => <tr key={o.id}>
        <td>{day(o.entry_date ?? o.achieved_date ?? o.date)}{o.achieved_date && <small className="sub"> · Planned {day(o.date)}</small>}</td>
        <td>{o.phase === 'reverse' ? 'Automatic reversal' : o.phase === 'accrue' ? 'Month-end accrual' : o.label || 'Recognition'}</td>
        <td className="fig">{usd(o.amount_cents)}</td>
        <td><Chip tone={['failed', 'blocked', 'missed'].includes(o.status) || o.reversed_by_id ? 'warn' : o.status === 'posted' ? 'good' : 'neutral'}>{o.reversed_by_id ? (o.reversed_date > asOf ? 'Reversed after selected date' : 'Reversed') : o.journal_id && o.entry_date > asOf ? 'Posted after selected date' : STATUS[o.status]}</Chip>{o.detail && <small className="sub"> · {o.detail}</small>}</td>
        <td>{o.journal_id ? <a href={journalLink(o.journal_id)}>Journal {o.journal_number}</a> : '—'}{o.reversed_by_id && <small className="sub"> · <a href={journalLink(o.reversed_by_id)}>Open reversal</a></small>}</td>
        <td>{can.record && approved && !o.journal_id && ['blocked', 'failed'].includes(o.status) && <Action run={async () => { await command('recognition.retry', { id: s.id, revision: s.revision, occurrence: o.id }); await refresh() }}>Retry occurrence</Action>}
          {can.record && approved && !o.journal_id && s.kind === 'deferred' && s.months === null && !o.achieved_date && <Form label="Mark milestone achieved" submit={body => command('recognition.milestone', { id: s.id, revision: s.revision, milestoneId: o.id, date: body.date })} onDone={refresh}>
            <Field label={`Achieved date · ${o.label}`} name="date" type="date" defaultValue={businessToday} required />
          </Form>}</td>
      </tr>)}
    </Table>
  </Card>
}

export function RecognitionSchedules({ to, onChange }: { to: string; onChange?: () => Promise<void> }) {
  const { data, error, reload } = useView<D>(`recognition?to=${to}`), { state, reload: reloadShared } = useShared()
  const [selected, setSelected] = useState<string | null>(null), [editing, setEditing] = useState<{ schedule?: D } | null>(null)
  const refresh = async () => { await Promise.all([reload(), reloadShared()]); await onChange?.() }
  if (!data) return <Card title="Recognition schedules"><Loading error={error} what="recognition schedules" /></Card>
  const current = data.schedules.find((s: D) => s.id === selected)
  if (editing) return <ScheduleEditor key={editing.schedule?.id ?? 'new'} schedule={editing.schedule} sources={data.fundingSources} to={to} cancel={() => setEditing(null)} onDone={async saved => { setSelected(saved.id); setEditing(null); await refresh() }} />
  return <div className="stack">
    <Card title="Recognition schedules" actions={state.actor.can.record && <button type="button" className="btn btn-secondary" onClick={() => setEditing({})}>New recognition schedule</button>}>
      {error && <p role="alert" className="error">{error}</p>}
      <Table heads={['Schedule', 'Type', 'Remaining balance', 'Status']} figures={[2]} empty="No prepaid, accrual or deferred-revenue schedules yet.">
        {data.schedules.map((s: D) => <tr key={s.id}><td><button type="button" className="btn btn-link" onClick={() => setSelected(s.id)}>{s.name}</button></td><td>{KINDS[s.kind as Kind]}</td><td className="fig">{usd(s.remaining_cents)}</td><td><Chip tone={s.status === 'awaiting-approval' ? 'warn' : 'neutral'}>{STATUS[s.status]}</Chip></td></tr>)}
      </Table>
    </Card>
    <Card title="Recognition balance-sheet ties">
      <p className="hint">Expected balances combine the schedules assigned to each account at {day(data.asOf)}. Differences stay flagged until the posted ledger and schedules agree.</p>
      <Table heads={['Account', 'Expected balance', 'Posted balance', 'Difference', 'Status']} figures={[1, 2, 3]} empty="No recognition accounts to tie yet.">
        {data.ties.map((tie: D) => <tr key={tie.account_id}><td>{tie.account_code} · {tie.account_name}<small className="sub"> · {tie.schedules.map((s: D) => s.name).join(', ')}</small></td><td className="fig">{usd(tie.expected_cents)}</td><td className="fig">{usd(tie.actual_cents)}</td><td className="fig">{usd(tie.difference_cents)}</td><td><Chip tone={tie.ties ? 'good' : 'bad'}>{tie.ties ? 'Agrees' : 'Does not tie'}</Chip></td></tr>)}
      </Table>
    </Card>
    <Card title="Recognition exceptions">
      <Table heads={['Date', 'Schedule', 'Status', 'Reason']} empty="No missed, blocked or failed recognition occurrences.">
        {data.exceptions.map((exception: D) => <tr key={`${exception.schedule_id}:${exception.occurrence}:${exception.revision}`}><td>{day(exception.date)}</td><td><button type="button" className="btn btn-link" onClick={() => setSelected(exception.schedule_id)}>{exception.name}</button></td><td><Chip tone="warn">{STATUS[exception.status]}</Chip></td><td>{exception.detail}</td></tr>)}
      </Table>
    </Card>
    {current && <ScheduleDetail schedule={current} asOf={data.asOf} businessToday={data.today} edit={() => setEditing({ schedule: current })} refresh={refresh} />}
  </div>
}
