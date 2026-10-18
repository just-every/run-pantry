// Questions stay attached to the record or report figure they were asked about.
import { useState } from 'react'
import { command, day, Field, Form, Loading, useShared, useView, useWho, type D } from './kit'

/** Owners already have People in shared state; other recorders read the question directory. */
function useAccountants(supplied?: D[]) {
  const { state } = useShared()
  const members = state.actor.can.owner ? state.settings.members : undefined
  const shared = supplied ?? (members ? members.filter((m: D) => m.active && m.role === 'accountant') : undefined)
  const view = useView<D>(shared ? null : 'questions')
  return { accountants: shared ?? view.data?.accountants, error: view.error }
}

function AccountantField({ accountants, current }: { accountants: D[]; current?: string | null }) {
  return <Field label="Accountant" name="assignee" required defaultValue={current ?? (accountants.length === 1 ? accountants[0].email : '')} options={accountants.map(a => ({ value: a.email, label: a.name ? `${a.name} · ${a.email}` : a.email }))} />
}

function NoAccountant() {
  const owner = useShared().state.actor.can.owner
  return <p className="hint">{owner ? <>Add your accountant in <a href="/app/settings">People &amp; settings</a> first.</> : 'Ask the owner to add an accountant in People & settings first.'}</p>
}

function Composer({ subjectKind, subjectId, label, onClose, onSent }: { subjectKind: string; subjectId: string; label: string; onClose: () => void; onSent: () => Promise<void> }) {
  const { accountants, error } = useAccountants()
  if (!accountants) return <Loading error={error} what="your accountants" />
  if (!accountants.length) return <><NoAccountant /><button type="button" className="btn btn-link" onClick={onClose}>Cancel</button></>
  return <Form label="Send question" submit={body => command('question.ask', { ...body, subjectKind, subjectId })} onDone={onSent}
    secondary={<button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}>
    <p className="hint">About: {label}. The question and answer stay with this record.</p>
    <AccountantField accountants={accountants} />
    <Field label="Question for your accountant" name="question" type="textarea" maxLength={2000} required />
  </Form>
}

export function AskAccountant({ subjectKind, subjectId, label }: { subjectKind: string; subjectId: string; label: string }) {
  const { state } = useShared(), [open, setOpen] = useState(false)
  return <div className="record-questions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <button type="button" className="btn btn-link" aria-expanded={open} onClick={() => setOpen(x => !x)}>{open ? 'Close questions' : state.actor.can.record ? 'Ask accountant' : 'Questions & answers'}</button>
    {open && <RecordQuestions key={`${subjectKind}:${subjectId}`} subjectKind={subjectKind} subjectId={subjectId} label={label} />}
  </div>
}

function RecordQuestions({ subjectKind, subjectId, label }: { subjectKind: string; subjectId: string; label: string }) {
  const { state, reload: refreshShared } = useShared(), who = useWho()
  const { data, error, reload } = useView<D>(`questions/record?kind=${encodeURIComponent(subjectKind)}&id=${encodeURIComponent(subjectId)}`)
  const [writing, setWriting] = useState(true), [sent, setSent] = useState(false)
  return <>
    {!data ? <Loading error={error} what="questions about this record" /> : data.questions.length ? <ul className="plain">{data.questions.map((q: D) => <li key={q.id}>
      <strong>{q.question}</strong>
      <p className="hint">For {q.assignee ? who(q.assignee) : 'the owner'} · {q.status === 'open' || q.status === 'confirm' ? 'Open' : 'Answered'} · <a href={`/app/questions?q=${encodeURIComponent(q.id)}`}>Open conversation</a></p>
      {q.answer && <p>“{q.answer}” <span className="hint">— {who(q.answered_by)}, {day(q.answered_at)}</span></p>}
    </li>)}</ul> : <p className="hint">No questions about this record yet.</p>}
    {sent && <p role="status" className="hint">Question saved with this record.</p>}
    {state.actor.can.record && (writing ? <Composer subjectKind={subjectKind} subjectId={subjectId} label={label} onClose={() => setWriting(false)} onSent={async () => { setWriting(false); setSent(true); await reload(); await refreshShared() }} />
      : <button type="button" className="btn btn-secondary btn-small" onClick={() => { setWriting(true); setSent(false) }}>Ask another question</button>)}
  </>
}

/** Route a question already raised by Pantry to a named accountant. */
export function AssignAccountant({ q, accountants: supplied, onDone }: { q: D; accountants?: D[]; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return open ? <Assignment q={q} accountants={supplied} onDone={async () => { await onDone(); setOpen(false) }} onClose={() => setOpen(false)} />
    : <button type="button" className="btn btn-secondary btn-small" onClick={() => setOpen(true)}>{q.assignee ? 'Change accountant' : 'Assign to accountant'}</button>
}

function Assignment({ q, accountants: supplied, onDone, onClose }: { q: D; accountants?: D[]; onDone: () => Promise<void>; onClose: () => void }) {
  const { accountants, error } = useAccountants(supplied)
  if (!accountants) return <Loading error={error} what="your accountants" />
  if (!accountants.length) return <><NoAccountant /><button type="button" className="btn btn-link" onClick={onClose}>Cancel</button></>
  return <Form label="Assign question" submit={body => command('question.assign', { id: q.id, ...body })} onDone={onDone}
    secondary={<button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}>
    <AccountantField accountants={accountants} current={q.assignee} />
  </Form>
}
