// Questions stay attached to the record or report figure they were asked about.
import { useState } from 'react'
import { command, day, Field, Form, Loading, useShared, useView, useWho, type D } from './kit'

function useRecipients() {
  const view = useView<D>('questions')
  return { recipients: view.data?.recipients, error: view.error }
}

function MentionField({ recipients, current }: { recipients: D[]; current?: string | null }) {
  return <Field label="Mention a person" name="assignee" required defaultValue={current ? `@${current}` : recipients.length === 1 ? `@${recipients[0].email}` : ''}
    options={recipients.map(a => ({ value: `@${a.email}`, label: `@${a.name || a.email} · ${a.email}` }))}
    hint="Notify one person who already has full access to the books. The question and answer stay on this record." />
}

function Composer({ subjectKind, subjectId, label, onClose, onSent }: { subjectKind: string; subjectId: string; label: string; onClose: () => void; onSent: () => Promise<void> }) {
  const { recipients, error } = useRecipients()
  if (!recipients) return <Loading error={error} what="people who can answer" />
  return <Form label="Send question" submit={body => command('question.ask', { ...body, subjectKind, subjectId })} onDone={onSent}
    secondary={<button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}>
    <p className="hint">About: {label}. The question and answer stay with this record.</p>
    <MentionField recipients={recipients} />
    <Field label="Your question" name="question" type="textarea" maxLength={2000} required />
  </Form>
}

export function AskAccountant({ subjectKind, subjectId, label }: { subjectKind: string; subjectId: string; label: string }) {
  const { state } = useShared(), [open, setOpen] = useState(false)
  return <div className="record-questions" onClick={e => e.stopPropagation()} onKeyDown={e => e.stopPropagation()}>
    <button type="button" className="btn btn-link" aria-expanded={open} onClick={() => setOpen(x => !x)}>{open ? 'Close questions' : state.actor.can.record ? 'Ask a person' : 'Questions & answers'}</button>
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

/** Notify another eligible person about an existing question. */
export function AssignAccountant({ q, onDone }: { q: D; onDone: () => Promise<void> }) {
  const [open, setOpen] = useState(false)
  return open ? <Assignment q={q} onDone={async () => { await onDone(); setOpen(false) }} onClose={() => setOpen(false)} />
    : <button type="button" className="btn btn-secondary btn-small" onClick={() => setOpen(true)}>{q.assignee ? 'Change recipient' : 'Mention a person'}</button>
}

function Assignment({ q, onDone, onClose }: { q: D; onDone: () => Promise<void>; onClose: () => void }) {
  const { recipients, error } = useRecipients()
  if (!recipients) return <Loading error={error} what="people who can answer" />
  return <Form label="Assign question" submit={body => command('question.assign', { id: q.id, ...body })} onDone={onDone}
    secondary={<button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>}>
    <MentionField recipients={recipients} current={q.assignee} />
  </Form>
}
