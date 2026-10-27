import { AgentPermissions } from './agent-permissions'
import { LearnedRecognition } from './learned-recognition'
// Questions from Pantry: what doesn't add up in the books, asked one plain
// question at a time (by email first), each beside the exact record. A chosen
// answer shows what it changes before it files anything; words the owner
// writes are read into an answer that waits for their yes.
import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Action, Card, Chip, command, day, Field, Loading, PageHead, readFileBase64, useShared, useView, useWho, type D } from './kit'
import { Icon } from './icons'
import { AssignAccountant } from './ask-accountant'
import { QuestionApproval } from './proposals'

const STATUS: Record<string, [string, 'warn' | 'agent' | 'good' | 'neutral']> = {
  open: ['Open', 'warn'], confirm: ['Waiting for your yes', 'agent'], filed: ['Filed', 'good'], answered: ['Answered', 'good'], dismissed: ['Not a problem', 'neutral'], resolved: ['Settled itself', 'neutral'],
}
export const StatusChip = ({ status }: { status: string }) => <Chip tone={STATUS[status]?.[1] ?? 'neutral'}>{STATUS[status]?.[0] ?? status}</Chip>

const FILES = ['category', 'invoice', 'bill', 'transfer', 'posting']
const doLabel = (c: D) => FILES.includes(c.action.type) ? 'File it' : c.action.type === 'no-receipt' ? 'Save the reason' : 'Answer'

/** The conversation: Pantry's question and what it did, and the owner's answers in the app or by email. */
export function Thread({ messages }: { messages: D[] }) {
  const who = useWho()
  return <ol className="thread">{messages.map(m => <li key={m.id} className={`bubble${m.via === 'agent' ? '' : ' mine'}`}>
    <p>{m.body}</p><small>{m.via === 'agent' ? 'Pantry' : who(m.author)}{m.via === 'email' ? ' · by email' : ''} · {day(m.at)}</small>
  </li>)}</ol>
}

/** One question with its record and every way to answer it. */
export function QuestionCard({ q, onDone, focused = false, compact = false }: { q: D; onDone: () => Promise<void>; focused?: boolean; compact?: boolean }) {
  const { state } = useShared(), can = state.actor.can.record, who = useWho()
  const [pick, setPick] = useState<string>(''), [remember, setRemember] = useState(false), [note, setNote] = useState(''), [words, setWords] = useState(''), [other, setOther] = useState('')
  const choice = q.choices.find((c: D) => c.id === pick)
  const lineQuestion = q.subject_kind === 'bank-line' && (q.kind === 'unfiled' || q.kind === 'unmatched-deposit')
  const categories = state.accounts.filter((a: D) => a.active && !['bank', 'receivable', 'payable', 'retained'].includes(a.subtype))
  const facts = Object.entries(q.facts as Record<string, string>)
  const asked = q.email_status === 'sent' ? <>Emailed to {q.emailed_to}, {day(q.emailed_at)}</> : q.email_status === 'local' ? 'Asked here: this computer sends no email' : q.email_status === 'no-mail' ? 'Asked here: no mail provider is set up' : q.email_status === 'failed' ? <>Email failed: {q.email_detail}</> : <>Asked {day(q.asked_at)}</>
  const send = async (body: D) => { await command('question.answer', { id: q.id, ...body }); await onDone() }
  return <Card className={`question${focused ? ' focused' : ''}`} title={<><Icon name={q.kind === 'accountant' ? 'people' : 'agent'} /> {q.title}</>} actions={<StatusChip status={q.status} />}>
    {focused && <p className="hint"><Icon name="ok" /> Opened this conversation.</p>}
    <p className="ask"><strong>{q.question}</strong></p>
    <p>{q.why}</p>
    <dl className="facts record">{facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}</dl>
    <p className="hint">{asked}{q.recordLink && <> · <a href={q.recordLink}>Open the record</a></>}</p>
    <p className="hint">For {q.assignee ? who(q.assignee) : 'the owner'}{q.assignee && <> · {q.assignee}</>}</p>
    {can && (q.status === 'open' || q.status === 'confirm') && <AssignAccountant q={q} onDone={onDone} />}
    {q.status !== 'open' && q.status !== 'confirm' ? <div className="callout" role="status"><Icon name="ok" /><div>
      <strong>{q.answer ? <>Answered: “{q.answer}”</> : STATUS[q.status]?.[0]}</strong>
      <span>{q.answered_by ? <>{who(q.answered_by)}{q.answered_via === 'email' ? ' by email' : ' in Pantry'}, {day(q.answered_at)}. </> : null}{q.messages.filter((m: D) => m.via === 'agent').at(-1)?.body}</span>
    </div></div> : !can ? <p className="hint">The owner, bookkeeper or accountant answers.</p> : q.kind === 'accountant' ? <div className="own-words">
      <Field label="Your answer" name={`words-${q.id}`} type="textarea" value={words} maxLength={2000} onChange={(e: any) => setWords(e.target.value)} hint="Your answer is kept with this record and settles the question. It does not post an entry." />
      <Action tone="primary" disabled={!words.trim()} run={async () => { await send({ words }); setWords('') }}>Save answer</Action>
    </div> : q.status === 'confirm' ? <div className="callout" role="status"><Icon name="agent" /><div>
      <strong>You said: “{q.pending.read}”</strong><span>Pantry reads that as <b>{q.pending.label}</b>. {q.pending.effects ? 'Review the current report effects below.' : q.pending.effect}{q.pending.remember ? ' And from now on, the same for this payee (a bank rule).' : ''}</span>
      {q.pending.effects ? <QuestionApproval q={q} answer={{ choice: q.pending.choice, accountId: q.pending.accountId, remember: q.pending.remember, note: q.pending.note }} label="Yes, do it" onDone={onDone} /> : <Action tone="primary" run={async () => { await command('question.confirm', { id: q.id, yes: true }); await onDone() }}>Yes, do it</Action>}
      <Action run={async () => { await command('question.confirm', { id: q.id, yes: false }); await onDone() }}>Not that</Action>
    </div></div> : <>
      {q.choices.length > 0 && <fieldset className="choices"><legend>{q.kind === 'missing-receipt' ? 'If there is no receipt' : 'What was it?'}</legend>
        {q.choices.map((c: D, i: number) => <label key={c.id} className={`choice${pick === c.id ? ' picked' : ''}`}>
          <input type="radio" name={`q-${q.id}`} value={c.id} checked={pick === c.id} onChange={() => { setPick(c.id); setOther('') }} />
          <span><strong>{i + 1}. {c.label}</strong>{pick === c.id && <small>{FILES.includes(c.action.type) ? 'Review the current report effects below before filing.' : c.effect}</small>}</span>
        </label>)}
      </fieldset>}
      {lineQuestion && <Field label="Something else: file it to" name={`other-${q.id}`} value={other} onChange={(e: any) => { setOther(e.target.value); setPick('') }} empty="Choose a category…" options={categories.map((a: D) => ({ value: a.id, label: `${a.code} · ${a.name}` }))} />}
      {(choice || other) && <div className="change">
        {choice?.note && <Field label={choice.note} name={`note-${q.id}`} value={note} onChange={(e: any) => setNote(e.target.value)} required />}
        {(choice?.learn || other) && <label className="remember"><input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} /> Always file this payee the same way (Pantry makes a bank rule)</label>}
        {other || (choice && FILES.includes(choice.action.type)) ? <QuestionApproval q={q} answer={choice ? { choice: choice.id, remember, note } : { accountId: other, remember }} label={choice ? doLabel(choice) : 'File it'} onDone={onDone} /> : <div className="row-actions small"><Action tone="primary" run={() => send({ choice: choice.id, remember, note })}>{doLabel(choice)}</Action></div>}
        <span className="hint">Nothing changes until you choose this.</span>
      </div>}
      {q.kind === 'missing-receipt' && <ReceiptUpload q={q} onDone={onDone} />}
      {!compact && <div className="own-words">
        <Field label="Or tell Pantry in your own words" name={`words-${q.id}`} type="textarea" value={words} onChange={(e: any) => setWords(e.target.value)} placeholder="For example: that was my personal lunch, I'll pay it back" />
        <Action disabled={!words.trim()} run={async () => { await send({ words }); setWords('') }}>Send</Action>
      </div>}
    </>}
    {q.messages.length > 0 && <details className="details" open={!compact && q.messages.length > 1}><summary>Conversation ({q.messages.length})</summary><Thread messages={q.messages} /></details>}
  </Card>
}

function ReceiptUpload({ q, onDone }: { q: D; onDone: () => Promise<void> }) {
  const [file, setFile] = useState<HTMLInputElement | null>(null)
  return <div className="inline-form receipt-upload">
    <div className="field"><label htmlFor={`receipt-${q.id}`}>Upload the receipt</label><input id={`receipt-${q.id}`} ref={setFile} type="file" accept="application/pdf,image/*" /></div>
    <Action tone="primary" run={async () => { await command('question.receipt', { id: q.id, ...(await readFileBase64(file)) }); await onDone() }}>Attach it</Action>
  </div>
}

function AgentStatus({ agent, open, onRun }: { agent: D; open: number; onRun: () => Promise<void> }) {
  const can = useShared().state.actor.can.record, r = agent.lastRun
  const mail = agent.mail === 'ready' ? (agent.settings.emailOn ? `Emails new questions to ${agent.owner}, up to ${agent.settings.perDay} a day.` : 'Email is off; questions wait here.') : agent.mail === 'local' ? 'This computer sends no email, so questions wait here.' : 'No mail provider is set up, so questions wait here.'
  return <Card title="How Pantry checks">
    <ul className="plain">
      <li><strong>{r ? <>Last checked {day(r.at)}</> : 'Not checked yet'}</strong>{r && <span className="hint"> · {r.found} {r.found === 1 ? 'thing' : 'things'} to ask about; {open} open now</span>}</li>
      <li>{mail}</li>
      <li>{agent.model.line}</li>
      <li className="hint">Pantry never files anything without your answer.</li>
    </ul>
    {can && <div className="row-actions"><Action tone="primary" run={onRun}>Check the books now</Action></div>}
  </Card>
}

function AgentSettings({ agent, onSaved }: { agent: D; onSaved: () => Promise<void> }) {
  const s = agent.settings, [error, setError] = useState(''), [saved, setSaved] = useState(false)
  return <Card title="How Pantry asks">
    <form className="form" onSubmit={async e => {
      e.preventDefault(); setError(''); setSaved(false)
      const f = Object.fromEntries(new FormData(e.currentTarget))
      try { await command('books-agent.save', { ...f, emailOn: f.emailOn === 'on', revision: s.revision }); setSaved(true); await onSaved() } catch (err) { setError((err as Error).message) }
    }}><div className="grid-form">
      <label className="remember field-wide"><input type="checkbox" name="emailOn" defaultChecked={s.emailOn} /> Email me each new question</label>
      <Field label="Questions a day, at most" name="perDay" type="number" min={1} max={20} defaultValue={s.perDay} required />
      <Field label="Ask about a deposit after (days)" name="depositDays" type="number" min={0} max={90} defaultValue={s.depositDays} required />
      <Field label="Ask about an unfiled payment or missing receipt after (days)" name="fileDays" type="number" min={0} max={120} defaultValue={s.fileDays} required />
      <Field label="Ask for receipts from (amount)" name="receiptAmount" defaultValue={s.receiptAmount} required hint="Costs under this need no receipt question" />
      <p className="hint field-wide">{agent.replyTo ? <>Replies come back to your Pantry address, {agent.replyTo}: reply with a number, in your own words, or with the receipt attached.</>
        : agent.hosting === 'local' ? 'On this computer no email reaches Pantry; answer here, or send a saved reply (.eml) to your Pantry address in People & settings → Forward receipts by email to try it.'
        : agent.hosting === 'no-domain' ? 'RER Managed hosting has no domain of yours yet, so replies cannot reach Pantry; the emails link here to answer.'
        : <>To answer by replying, create your Pantry address in <a href="/app/settings#receipt-address">People & settings → Forward receipts by email</a>. Until then the emails link here to answer.</>}</p>
    </div><div className="form-end"><button className="btn btn-primary">Save</button>{saved && <span role="status" className="hint">Saved.</span>}{error && <p role="alert" className="error">{error}</p>}</div></form>
  </Card>
}

export function Questions({ focus }: { focus?: string }) {
  const { data, error, reload } = useView<D>(`questions${focus ? `?q=${encodeURIComponent(focus)}` : ''}`), shared = useShared(), who = useWho()
  const [picked, setPicked] = useState<string | null>(null)
  const refresh = async () => { await reload(); await shared.reload() }
  if (!data) return <Loading error={error} what="Pantry’s questions" />
  // One question at a time: the one the email opened, else the one chosen, else an answer waiting for your yes, else the oldest still open.
  const focused = focus && !picked ? [...data.open, ...data.settled].find((x: D) => x.id === focus) : null
  const current = focused ?? data.open.find((x: D) => x.id === picked) ?? data.open.find((x: D) => x.status === 'confirm') ?? data.open[0]
  const rest = data.open.filter((x: D) => x.id !== current?.id)
  return <>
    <PageHead title="Questions from Pantry" chip={data.open.length ? <Chip tone="warn">{data.open.length} open</Chip> : <Chip tone="good">All answered</Chip>}
      lead="Pantry checks your books for what doesn’t add up and asks you, by email first. Your answer files it." />
    <AgentPermissions/>
    <LearnedRecognition/>
    <div className="split split-wide-left">
      <div className="stack">
        {current && <QuestionCard key={current.id} q={current} onDone={refresh} focused={current === focused} />}
        {rest.length > 0 && <Card title={`Still to answer (${rest.length})`}>
          <ol className="answered">{rest.map((x: D) => <li key={x.id}>
            <div><strong>{x.title}</strong><span className="hint">{x.why}</span><span className="hint">For {x.assignee ? who(x.assignee) : 'the owner'}</span></div>
            <span className="answered-end"><StatusChip status={x.status} /><button type="button" className="btn btn-secondary btn-small" onClick={() => { setPicked(x.id); window.scrollTo({ top: 0 }) }}>Answer</button></span>
          </li>)}</ol>
        </Card>}
        {!data.open.length && !focused && <Card title="Nothing to ask" className="empty-card"><span className="empty-lines" aria-hidden="true" /><p>Every deposit is explained, every payment is filed, every payment of ${data.agent.settings.receiptAmount} or more has its receipt, and the bank and the books agree.</p></Card>}
        {data.settled.length > 0 && <Card title="Answered">
          <ol className="answered">{data.settled.filter((x: D) => x.id !== focused?.id).map((x: D) => <li key={x.id}>
            <div><strong>{x.title}</strong><span className="hint">{x.answer ? <>“{x.answer}” — {who(x.answered_by)}{x.answered_via === 'email' ? ' by email' : ''}, {day(x.answered_at)}</> : x.messages.at(-1)?.body}</span></div>
            <StatusChip status={x.status} />
          </li>)}</ol>
        </Card>}
      </div>
      <div className="stack">
        <AgentStatus agent={data.agent} open={data.open.length} onRun={async () => { await command('books-agent.run', {}); await refresh() }} />
        {shared.state.actor.can.owner && <AgentSettings agent={data.agent} onSaved={refresh} />}
      </div>
    </div>
  </>
}

/** At close: the month's questions as one thread to work through, the next open one first. */
export function MonthQuestions({ questions, month, onDone }: { questions: D[]; month: string; onDone: () => Promise<void> }) {
  const who = useWho(), open = questions.filter(x => x.status === 'open' || x.status === 'confirm'), next = open.find(x => x.status === 'confirm') ?? open[0]
  return <Card title={<><Icon name="agent" /> Pantry’s questions</>} actions={questions.length ? <span className="progress-count">{questions.length - open.length} of {questions.length} answered</span> : null}>
    {open.length > 0 && <p className="hint">{open.length} open question{open.length === 1 ? '' : 's'}. Answer every question before locking the month.</p>}
    {!questions.length ? <p>Pantry has asked nothing about {month}.</p> : <>
      {next && <QuestionCard key={next.id} q={next} onDone={onDone} compact />}
      <ol className="answered month-thread">{questions.filter(x => x !== next).map(x => <li key={x.id}>
        <div><strong>{x.title}</strong><span className="hint">{x.status === 'open' || x.status === 'confirm' ? x.question : x.answer ? <>“{x.answer}” — {who(x.answered_by)}{x.answered_via === 'email' ? ' by email' : ''}</> : x.messages.at(-1)?.body}</span><span className="hint">For {x.assignee ? who(x.assignee) : 'the owner'}</span></div>
        <span className="answered-end"><StatusChip status={x.status} />{(x.status === 'open' || x.status === 'confirm') && <Link to="/app/questions" search={{ q: x.id }}>Answer</Link>}</span>
      </li>)}</ol>
    </>}
  </Card>
}
