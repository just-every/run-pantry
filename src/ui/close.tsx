// Close: calculated checks, reviewed tasks, the lock, and reopening by request and approval.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Action, Card, Chip, command, Field, Form, Loading, PageHead, Table, day, monthName, thisMonth, usd, useShared, useView, useWho, type D } from './kit'
import { Icon } from './icons'
import { CaptureButtons } from './receipt-capture'
import { RecurringJournals } from './recurring-journals'
import { MonthQuestions } from './questions'

/** Every entry keeps its receipt: spending and bills without one, each with "add receipt" right here. */
function ReceiptsCard({ s, onChange }: { s: D; onChange: () => Promise<void> }) {
  const can = useShared().state.actor.can, [waiving, setWaiving] = useState<string | null>(null), open = s.status !== 'locked'
  const bills = s.checks.find((c: D) => c.key === 'evidence')?.items ?? []
  const count = s.receipts.missing.length + bills.length
  return <Card title={<><Icon name="receipt" /> Receipts</>} actions={count ? <Chip tone="warn">{count} without a receipt</Chip> : <Chip tone="good">Every entry has its receipt</Chip>}>
    <Table heads={['Date', 'Entry', 'Amount', '']} figures={[2]} empty={s.receipts.waived.length ? `Every entry in ${monthName(s.id)} has its receipt or a recorded reason.` : `Every entry in ${monthName(s.id)} has its receipt.`}>
      {s.receipts.missing.map((m: D) => <tr key={m.id}><td>{day(m.entry_date)}</td><td>{m.memo}{m.number ? <small className="sub"> · entry {m.number}</small> : null}</td><td className="fig">{usd(m.amount_cents)}</td>
        <td>{open && can.record && <div className="row-actions"><span className="hint">Add receipt</span><CaptureButtons compact target={{ kind: 'journal', id: m.id }} onDone={onChange} />
          {can.post && (waiving === m.id
            ? <Form label="Save reason" submit={b => command('receipt.not-needed', { entryId: m.id, ...b })} onDone={async () => { setWaiving(null); await onChange() }} className="inline-form"><Field label="Why no receipt" name="reason" required /></Form>
            : <button type="button" className="btn btn-link" onClick={() => setWaiving(m.id)}>No receipt needed</button>)}</div>}</td></tr>)}
      {bills.map((b: D) => <tr key={b.id}><td>{day(b.date)}</td><td>Bill {b.label}</td><td className="fig">{usd(b.amount_cents)}</td><td>{open && can.record && <div className="row-actions"><span className="hint">Add receipt</span><CaptureButtons compact target={{ kind: 'bill', id: b.id }} onDone={onChange} /></div>}</td></tr>)}
    </Table>
    {s.receipts.waived.length > 0 && <p className="hint">No receipt needed: {s.receipts.waived.map((w: D) => `${w.memo} (${w.reason})`).join('; ')}.</p>}
  </Card>
}

const LINK: Record<string, string> = { bank: '/app/bank', feeds: '/app/bank', drafts: '/app/books', evidence: '/app/sales', subledgers: '/app/reports', 'trial-balance': '/app/reports', proposals: '/app/agents', questions: '/app/questions' }

export function Close() {
  const shared = useShared(), who = useWho(), [period, setPeriod] = useState(() => new URLSearchParams(typeof window === 'undefined' ? '' : window.location.search).get('period') ?? shared.state.overview.closing ?? thisMonth())
  const { data: s, error, reload } = useView<D>(`close/${period}`)
  const can = shared.state.actor.can
  const refresh = async () => { await reload(); await shared.reload() }
  const pending = s?.requests.find((r: D) => r.status === 'pending')
  return <>
    <PageHead title={<>Close — {monthName(period)}</>} chip={s && (s.status === 'locked' ? <Chip tone="info"><Icon name="lock" /> Locked</Chip> : s.ready ? <Chip tone="good">Ready to lock</Chip> : <Chip tone="warn">In progress</Chip>)}
      lead="Every check must pass and every review task be done before the period locks. A lock stops all changes dated in the period, by people and agents alike."
      actions={<div className="field inline"><label htmlFor="close-period">Period</label><input id="close-period" type="month" value={period} onChange={e => e.target.value && setPeriod(e.target.value)} /></div>} />
    {!s ? <Loading error={error} what="the close" /> : <div className="split split-wide-left">
      <div className="stack">
        <Card title="Close checklist" actions={s.checks.every((c: D) => c.ok) ? <Chip tone="good">All checks passed</Chip> : <Chip tone="warn">{s.checks.filter((c: D) => !c.ok).length} to resolve</Chip>}>
          <Table heads={['Check', 'Status', 'Details']}>
            {s.checks.map((c: D) => <tr key={c.key}><td><strong>{c.title}</strong></td><td>{c.ok ? <Chip tone="good">Passed</Chip> : <Chip tone="bad">Not yet</Chip>}</td><td>{c.detail} {!c.ok && <Link to={LINK[c.key]}>Open</Link>}</td></tr>)}
          </Table>
        </Card>
        <RecurringJournals />
        <MonthQuestions questions={s.questions} month={monthName(period)} onDone={refresh} />
        <Card title="Review tasks" actions={s.status !== 'locked' && can.record && !s.tasks.length && <Action tone="primary" run={async () => { await command('close.tasks', { period }); await reload() }}>Add the standard review tasks</Action>}>
          <Table heads={['Task', 'Status', 'Completed by', '']} empty="No review tasks yet. Add the standard ones, or your own.">
            {s.tasks.map((t: D) => <tr key={t.id}><td>{t.title}{t.note && <small className="sub"> — {t.note}</small>}</td><td>{t.status === 'done' ? <Chip tone="good">Done</Chip> : <Chip tone="warn">Open</Chip>}</td><td>{t.done_by ? <>{who(t.done_by)}, {day(t.done_at)}</> : '—'}</td>
              <td>{s.status !== 'locked' && can.record && <Action run={async () => { await command('close.task', { id: t.id, revision: t.revision, done: t.status !== 'done' }); await reload() }}>{t.status === 'done' ? 'Reopen task' : 'Mark done'}</Action>}</td></tr>)}
          </Table>
          {s.status !== 'locked' && can.record && <Form label="Add task" submit={b => command('close.tasks', { period, ...b })} onDone={reload} className="inline-form"><Field label="New review task" name="title" required /></Form>}
        </Card>
        <ReceiptsCard s={s} onChange={async () => { await reload(); await shared.reload() }} />
        {s.notes.length > 0 && <Card title="Approved notes">{s.notes.map((n: D) => <div key={n.id} className="note"><strong>{n.kind === 'variance' ? 'Variance explanation' : 'Close packet'}</strong><p>{n.body || JSON.parse(n.evidence).join('; ')}</p><small>Approved by {who(n.approved_by)}, {day(n.approved_at)}</small></div>)}</Card>}
      </div>
      <div className="stack">
        <Card title={<><Icon name="lock" /> Period lock</>}>
          {s.status === 'locked' ? <>
            <div className="lock-note"><span className="lock-disc"><Icon name="lock" /></span><p><strong>Locked by {who(s.period.locked_by)} on {day(s.period.locked_at)}.</strong> Nothing dated {day(s.start)} to {day(s.end)} can change.</p></div>
            <p><a className="btn btn-secondary" href={`/api/pantry/package/${period}/accountant-package.zip`} download>Download the accountant package for {monthName(period)}</a></p>
            <p className="hint">A ZIP your accountant opens in any spreadsheet program: the trial balance, profit and loss, balance sheet, general ledger, agings, reconciliations and this checklist, each as a CSV, with a README.</p>
            {pending ? <div className="callout callout-warn"><strong>Reopening requested</strong><span>{who(pending.requested_by)}: “{pending.reason}”</span>
              {can.reopen && (shared.state.actor.role === 'owner' || pending.requested_by !== shared.state.actor.email) ? <div className="row-actions"><Action tone="primary" run={async () => { await command('period.decide-reopen', { id: pending.id, decision: 'approve' }); await refresh() }}>Approve reopening</Action><Action run={async () => { await command('period.decide-reopen', { id: pending.id, decision: 'reject' }); await refresh() }}>Decline</Action></div> : <span className="hint">Someone with the reopen grant, other than the requester, decides.</span>}</div>
              : can.record && <Form label="Request reopening" submit={b => command('period.request-reopen', { period, ...b })} onDone={refresh}><Field label="Why must this period change?" name="reason" type="textarea" required wide /></Form>}
          </> : <>
            <p>Locking prevents every change dated in {monthName(period)} until a reopening request is approved.</p>
            <Action tone="primary" disabled={!s.ready || !can.lock} run={async () => { await command('period.lock', { period }); await refresh() }}>{`Lock ${monthName(period)}`}</Action>
            {!can.lock && <p className="hint">Locking needs the lock grant.</p>}
          </>}
        </Card>
        <Card title="Approval history">
          {s.approvals.length ? <ol className="timeline">{s.approvals.map((a: D) => <li key={a.id}><strong>{a.action === 'lock' ? 'Locked' : a.decision === 'approved' ? 'Reopened' : 'Reopening declined'}</strong><span>{who(a.actor_email)}, {day(a.at)}</span>{a.note && <em>“{a.note}”</em>}</li>)}</ol> : <p>No locks or reopenings yet.</p>}
        </Card>
      </div>
    </div>}
  </>
}
