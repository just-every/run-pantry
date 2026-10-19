// Accountant review: move posted lines between accounts in bulk by linked
// correcting entries, see every change since your last review with who made
// it, and read the review notes left on entries.
import { useState } from 'react'
import { Action, Card, command, day, Field, Form, Loading, Table, accountOptions, usd, useShared, useView, type D } from './kit'

const when = (iso: string) => <>{day(iso.slice(0, 10))} {iso.slice(11, 16)} UTC</>
const ACTION: Record<string, string> = { 'journal.draft': 'Drafted entry', 'journal.edit': 'Edited draft', 'journal.post': 'Posted entry', 'journal.reverse': 'Reversed entry', 'journal.discard': 'Discarded draft', 'journal.reclassify': 'Reclassified lines', 'journal.review-note': 'Left a review note' }

function Reclassify({ onDone }: { onDone: () => Promise<void> }) {
  const { state } = useShared(), journal = useView<D>('journal')
  const [from, setFrom] = useState(''), [picked, setPicked] = useState<Set<string>>(new Set())
  if (!journal.data) return <Loading error={journal.error} what="the journal" />
  const ordinary = (a: D) => a.subtype === 'other'
  const movable = journal.data.entries.filter((e: D) => e.status === 'posted' && !e.reversed_by_id && e.source_kind !== 'reversal')
    .flatMap((e: D) => e.lines.filter((l: D) => l.account_id === from && !l.reclassified_by).map((l: D) => ({ ...l, entry: e })))
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  return <Card title="Reclassify in bulk">
    <p className="hint">Each chosen line moves by its own posted correcting entry, dated on the original’s date and linked to it; the original stays as posted. Lines in locked months are refused: ask for the month to be reopened first.</p>
    <Field label="From account" name="from" value={from} onChange={(e: any) => { setFrom(e.target.value); setPicked(new Set()) }} options={accountOptions(state.accounts, ordinary)} />
    {from && <Table heads={['', 'Date', 'Entry', 'Description', 'Amount']} figures={[4]} empty="No posted lines on this account can be reclassified." caption="Lines to reclassify">
      {movable.length > 0 && <tr><td><input type="checkbox" aria-label="Select all lines" checked={picked.size === movable.length} onChange={e => setPicked(e.target.checked ? new Set(movable.map((l: D) => l.id)) : new Set())} /></td><td colSpan={4}>Select all ({movable.length})</td></tr>}
      {movable.map((l: D) => <tr key={l.id}><td><input type="checkbox" aria-label={`Reclassify ${l.entry.memo}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} /></td>
        <td>{day(l.entry.entry_date)}</td><td>{l.entry.number}</td><td>{l.entry.memo}</td><td className="fig">{usd(l.debit_cents || -l.credit_cents)}</td></tr>)}
    </Table>}
    {picked.size > 0 && <Form label={`Reclassify ${picked.size} line${picked.size === 1 ? '' : 's'}`} submit={b => command('journal.reclassify', { ...b, lineIds: [...picked] })} onDone={async () => { setPicked(new Set()); await journal.reload(); await onDone() }} className="grid-form">
      <Field label="To account" name="toAccountId" required options={accountOptions(state.accounts, a => ordinary(a) && a.id !== from)} />
      <Field label="Reason" name="memo" wide />
    </Form>}
  </Card>
}

export function Review() {
  const { state } = useShared(), v = useView<D>('review')
  if (!v.data) return <Loading error={v.error} what="your review" />
  const r = v.data
  return <div className="split">
    <div>
      {state.actor.can.post && <Reclassify onDone={v.reload} />}
      <Card title="Reclassifications">
        <Table heads={['When', 'By', 'Lines', 'To', 'Amount']} figures={[2, 4]} empty="No reclassifications yet.">
          {r.reclassifications.map((b: D) => <tr key={b.batch_id}><td>{when(b.created_at)}</td><td>{b.created_by}</td><td className="fig">{b.lines}</td><td>{b.to_code} · {b.to_name}</td><td className="fig">{usd(b.amount_cents)}</td></tr>)}
        </Table>
      </Card>
    </div>
    <div>
      <Card title="Changed since your last review" actions={<Action tone="primary" run={async () => { await command('review.mark', {}); await v.reload() }}>Mark reviewed now</Action>}>
        <p className="hint">{r.reviewedAt ? <>You last marked your review on {when(r.reviewedAt)}.</> : 'You have not marked a review yet, so everything is listed.'}</p>
        <Table heads={['When', 'Who', 'Change', 'Record']} empty="Nothing has changed since your last review." caption="Changes since your last review">
          {r.changes.map((c: D) => <tr key={c.id}><td>{when(c.at)}</td><td>{c.actor_email}</td><td>{ACTION[c.action] ?? c.action}</td><td>{c.entry_memo ? `${c.entry_number ? `Entry ${c.entry_number}` : 'Draft'} — ${c.entry_memo}` : `${c.subject_kind} ${c.subject_id.slice(0, 8)}`}</td></tr>)}
        </Table>
      </Card>
      <Card title="Review notes">
        <Table heads={['When', 'By', 'Entry', 'Note']} empty="No review notes yet. Leave one from an entry in Journal entries.">
          {r.notes.map((n: D) => <tr key={n.id}><td>{when(n.created_at)}</td><td>{n.author}</td><td>{n.number ? `Entry ${n.number}` : 'Draft'} — {n.memo}</td><td>{n.note}</td></tr>)}
        </Table>
      </Card>
    </div>
  </div>
}

/** Review notes on one entry, with a note form for anyone who records. */
export function EntryNotes({ e, onChange }: { e: D; onChange: () => Promise<void> }) {
  const { state } = useShared()
  return <div className="entry-notes"><strong>Review notes</strong>
    {e.notes.length ? <ul>{e.notes.map((n: D) => <li key={n.id}>{n.note} <small className="sub">· {n.author}, {when(n.created_at)}</small></li>)}</ul> : <span className="hint"> None.</span>}
    {state.actor.can.record && <Form label="Add review note" submit={b => command('journal.review-note', { entryId: e.id, ...b })} onDone={onChange}><Field label="Review note" name="note" required wide /></Form>}
  </div>
}
