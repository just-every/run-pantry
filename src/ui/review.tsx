// Accountant review: move posted lines between accounts in bulk by linked
// correcting entries, write off small open balances in bulk, see every change since your last review with who made
// it, and read the review notes left on entries.
import { DimensionFormFields } from './dimensions'
import { useState } from 'react'
import { Action, Card, command, day, Field, Form, Loading, Table, accountOptions, today, usd, useShared, useView, type D } from './kit'

const when = (iso: string) => <>{day(iso.slice(0, 10))} {iso.slice(11, 16)} UTC</>
const ACTION: Record<string, string> = { 'journal.draft': 'Drafted entry', 'journal.edit': 'Edited draft', 'journal.post': 'Posted entry', 'journal.reverse': 'Reversed entry', 'journal.discard': 'Discarded draft', 'journal.reclassify': 'Reclassified lines', 'journal.review-note': 'Left a review note', 'write-off.bulk': 'Wrote off small balances', 'credit.issue': 'Issued credit' }

function Reclassify({ onDone }: { onDone: () => Promise<void> }) {
  const { state } = useShared(), journal = useView<D>('journal')
  const [mode,setMode]=useState('account')
  const [from, setFrom] = useState(''), [picked, setPicked] = useState<Set<string>>(new Set())
  if (!journal.data) return <Loading error={journal.error} what="the journal" />
  const ordinary = (a: D) => a.subtype === 'other'
  const movable = journal.data.entries.filter((e: D) => e.status === 'posted' && !e.reversed_by_id && e.source_kind !== 'reversal')
    .flatMap((e: D) => e.lines.filter((l: D) => l.account_id === from && !l.reclassified_by && (!l.document_correction_root || mode!=='account'&&l.line_no===1)).map((l: D) => ({ ...l, entry: e })))
  const toggle = (id: string) => setPicked(p => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  return <Card title="Reclassify in bulk">
    <p className="hint">Each chosen line moves by its own posted correcting entry, dated on the original’s date and linked to it; the original stays as posted. Lines in locked months are refused: ask for the month to be reopened first. Invoice, credit and bill dimension corrections also require every affected settlement month to be open. Recode the destination line of a document correction to change it again.</p>
    <Field label="Reclassify by" name="reclassifyMode" value={mode} onChange={(e:any)=>setMode(e.target.value)} options={[{value:'account',label:'Account'},...[['class','classes_enabled'],['location','locations_enabled'],['project','projects_enabled']].filter(([,flag])=>state.dimensions?.settings[flag]).map(([value])=>({value,label:value[0].toUpperCase()+value.slice(1)}))]} />
    <Field label="From account" name="from" value={from} onChange={(e: any) => { setFrom(e.target.value); setPicked(new Set()) }} options={accountOptions(state.accounts, ordinary)} />
    {from && <Table heads={['', 'Date', 'Entry', 'Description', 'Amount']} figures={[4]} empty="No posted lines on this account can be reclassified." caption="Lines to reclassify">
      {movable.length > 0 && <tr><td><input type="checkbox" aria-label="Select all lines" checked={picked.size === movable.length} onChange={e => setPicked(e.target.checked ? new Set(movable.map((l: D) => l.id)) : new Set())} /></td><td colSpan={4}>Select all ({movable.length})</td></tr>}
      {movable.map((l: D) => <tr key={l.id}><td><input type="checkbox" aria-label={`Reclassify ${l.entry.memo}`} checked={picked.has(l.id)} onChange={() => toggle(l.id)} /></td>
        <td>{day(l.entry.entry_date)}</td><td>{l.entry.number}</td><td>{l.entry.memo}<small className="sub block">{[l.class_name,l.location_name,l.project_name].filter(Boolean).join(' · ')}</small></td><td className="fig">{usd(l.debit_cents || -l.credit_cents)}</td></tr>)}
    </Table>}
    {picked.size > 0 && <Form label={`Reclassify ${picked.size} line${picked.size === 1 ? '' : 's'}`} submit={b => command('journal.reclassify', { ...b,...(mode==='account'?{}:{dimensionKind:mode}), lineIds: [...picked] })} onDone={async () => { setPicked(new Set()); await journal.reload(); await onDone() }} className="grid-form">
      {mode==='account'?<Field label="To account" name="toAccountId" required options={accountOptions(state.accounts, a => ordinary(a) && a.id !== from)} />:<Field label={`To ${mode}`} name="toDimensionName" required options={state.dimensions.values.filter((v:D)=>v.kind===mode&&v.active).map((v:D)=>({value:v.name,label:v.name}))} />}
      <Field label="Reason" name="memo" wide />
    </Form>}
  </Card>
}

function WriteOff({ limit, onDone }: { limit: number; onDone: () => Promise<void> }) {
  const { state } = useShared(), [kind, setKind] = useState('invoice'), [ceiling, setCeiling] = useState('5.00')
  const v = useView<D>(/^\d+(\.\d{1,2})?$/.test(ceiling) ? `write-offs/candidates?kind=${kind}&ceiling=${ceiling}` : null), [done, setDone] = useState<D | null>(null)
  const items: D[] = v.data?.items ?? []
  return <Card title="Write off small balances">
    <p className="hint">Each open {kind === 'invoice' ? 'invoice' : 'bill'} with a balance above zero and at most the amount below is settled by its own posted {kind === 'invoice' ? 'credit note' : 'vendor credit'} on the account you choose, all in one batch. Write-offs are bad debts, not returns: sales tax and the nexus watch keep the sale. The owner’s limit is {usd(limit)} per item.</p>
    <div className="grid-form">
      <Field label="Balances of" name="kind" value={kind} onChange={(e: any) => { setKind(e.target.value); setDone(null) }} options={[{ value: 'invoice', label: 'Customers (receivables)' }, { value: 'bill', label: 'Vendors (payables)' }]} />
      <Field label="Up to ($)" name="ceiling" value={ceiling} onChange={(e: any) => { setCeiling(e.target.value); setDone(null) }} inputMode="decimal" />
    </div>
    {done && <p className="tone-good">Wrote off {done.items.length} balance{done.items.length === 1 ? '' : 's'} to {done.account.code} · {done.account.name}.</p>}
    <Table heads={[kind === 'invoice' ? 'Invoice' : 'Bill', kind === 'invoice' ? 'Customer' : 'Vendor', 'Date', 'Open balance']} figures={[3]} empty="Nothing open at or under this amount." caption="Balances to write off">
      {items.map((i: D) => <tr key={i.id}><td>{i.reference}</td><td>{i.name}</td><td>{day(i.day)}</td><td className="fig">{usd(i.open)}</td></tr>)}
    </Table>
    {items.length > 0 && <Form label={`Write off ${items.length} balance${items.length === 1 ? '' : 's'}`} submit={b => command('write-off.bulk', { ...b, kind, ceiling })} onDone={async r => { setDone(r); await v.reload(); await onDone() }} className="grid-form">
      <Field label="Write-off account" name="accountId" required options={accountOptions(state.accounts, a => a.subtype === 'other' && ['income', 'expense'].includes(a.type))} />
      <DimensionFormFields label="Write-off" />
      <Field label="Write-off date" name="date" type="date" defaultValue={today()} required />
    </Form>}
  </Card>
}

export function Review() {
  const { state } = useShared(), v = useView<D>('review')
  if (!v.data) return <Loading error={v.error} what="your review" />
  const r = v.data
  return <div className="split">
    <div>
      {state.actor.can.post && <><Reclassify onDone={v.reload} /><WriteOff limit={r.writeOffLimit} onDone={v.reload} /></>}
      <Card title="Write-offs">
        <Table heads={['When', 'By', 'Balances', 'Items', 'Account', 'Total']} figures={[3, 5]} empty="No write-offs yet.">
          {r.writeOffs.map((w: D) => <tr key={w.id}><td>{when(w.at)}</td><td>{w.by}</td><td>{w.kind === 'invoice' ? 'Customers' : 'Vendors'}</td><td className="fig">{w.count}</td><td>{w.account}</td><td className="fig">{usd(w.total)}</td></tr>)}
        </Table>
        {state.actor.role === 'owner' && <Form label="Set limit" submit={b => command('write-off.limit', b)} onDone={v.reload} className="grid-form">
          <Field label="Write-off limit per item ($)" name="limit" defaultValue={(r.writeOffLimit / 100).toFixed(2)} required inputMode="decimal" />
        </Form>}
      </Card>
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
