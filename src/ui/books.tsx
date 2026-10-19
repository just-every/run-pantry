// Books: the chart of accounts with current balances, the journal, entry
// review (post by a second person), reversal of posted entries, and the
// accountant's review: bulk reclassification, notes and changes since review.
import { useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Form, PageHead, Table, Tabs, Loading, accountOptions, day, today, usd, useShared, useView, useWho, type D } from './kit'
import { JournalEditor } from './journal-editor'
import { Icon } from './icons'
import { CaptureButtons } from './receipt-capture'
import { AskAccountant } from './ask-accountant'
import { NexusWatch } from './nexus'
import { EntryNotes, Review } from './review'

const TYPE: Record<string, string> = { asset: 'Asset', liability: 'Liability', equity: 'Equity', income: 'Income', expense: 'Expense' }
const ROLE: Record<string, string> = { bank: 'Bank or card', receivable: 'Receivables control', payable: 'Payables control', tax: 'Sales tax', retained: 'Retained earnings', other: '' }
// Balances show in each account's natural sign: debit-normal accounts as debits, credit-normal accounts as credits.
const CREDIT_NORMAL = new Set(['liability', 'equity', 'income'])
const SOURCE: Record<string, string> = { manual: 'Journal', opening: 'Opening balances', invoice: 'Invoice', credit: 'Credit', bill: 'Bill', payment: 'Payment', bank: 'Bank item', reversal: 'Reversal' }

function Chart({ balances, onPick }: { balances: Map<string, number>; onPick?: (a: D) => void }) {
  const { state, reload } = useShared()
  if (!state.accounts.length) return <Card title="Chart of accounts">
    <p>No accounts yet. Start from a small service-business chart you can edit, add accounts one by one, or move in from QuickBooks Online or Xero.</p>
    {state.actor.can.record && <Action tone="primary" run={async () => { await command('chart.start', {}); await reload() }}>Start with a service-business chart</Action>}
  </Card>
  return <Card title="Chart of accounts">
    <Table heads={['Code', 'Account name', 'Type', 'Balance']} figures={[3]}>
      {state.accounts.map((a: D) => <tr key={a.id} className={a.active ? '' : 'muted'} onClick={() => onPick?.(a)}><td>{a.code}</td><td><span>{a.name}{ROLE[a.subtype] && <small className="sub"> · {ROLE[a.subtype]}</small>}</span></td><td>{TYPE[a.type]}</td><td className="fig">{usd((CREDIT_NORMAL.has(a.type) ? -1 : 1) * (balances.get(a.id) ?? 0))}</td></tr>)}
    </Table>
  </Card>
}

function NewAccount() {
  const { reload } = useShared()
  return <Card title="Add an account"><Form label="Add account" submit={b => command('account.save', b)} onDone={reload} className="grid-form">
    <Field label="Code" name="code" required /><Field label="Name" name="name" required />
    <Field label="Type" name="type" required options={Object.entries(TYPE).map(([value, label]) => ({ value, label }))} />
    <Field label="Role" name="subtype" defaultValue="other" options={Object.entries(ROLE).map(([value, label]) => ({ value, label: label || 'Ordinary account' }))} />
  </Form></Card>
}

function TaxCodes() {
  const { state, reload } = useShared(), states = state.settings.choices.states.map((s: string) => ({ value: s, label: s }))
  return <Card title="Sales tax codes">
    <p className="hint">Invoices need a tax code or “Exempt” on every line before approval. Rates are those your accountant confirms; each code belongs to the state it is collected for, which the sales tax report groups by.</p>
    <Table heads={['Code', 'State', 'Rate', 'Liability account']} figures={[2]} empty="No sales tax codes. Lines can still be marked exempt.">
      {state.taxCodes.map((t: D) => <tr key={t.id}><td>{t.name}</td>
        <td>{state.actor.can.post ? <select aria-label={`State for ${t.name}`} value={t.state} onChange={async e => { await command('tax-code.save', { id: t.id, revision: t.revision, name: t.name, state: e.target.value }); await reload() }}>{!t.state && <option value="">Choose…</option>}{states.map((s: D) => <option key={s.value} value={s.value}>{s.label}</option>)}</select> : t.state || '—'}</td>
        <td className="fig">{(t.rate_milli_percent / 1000).toFixed(3)}%</td><td>{state.accounts.find((a: D) => a.id === t.account_id)?.name}</td></tr>)}
    </Table>
    {state.actor.can.post && <Form label="Add tax code" submit={b => command('tax-code.save', b)} onDone={reload} className="grid-form">
      <Field label="Name" name="name" required /><Field label="Rate (%)" name="rate" required inputMode="decimal" />
      <Field label="State" name="state" required defaultValue={state.settings.entity?.state} options={states} />
      <Field label="Liability account" name="accountId" required options={accountOptions(state.accounts, a => a.subtype === 'tax')} />
    </Form>}
  </Card>
}

function EntryPanel({ e, onChange }: { e: D; onChange: () => Promise<void> }) {
  const { state } = useShared(), who = useWho(), [editing, setEditing] = useState(false), [reversing, setReversing] = useState(false)
  const debit = e.lines.reduce((s: number, l: D) => s + l.debit_cents, 0), credit = e.lines.reduce((s: number, l: D) => s + l.credit_cents, 0)
  const mayPost = state.actor.can.post && (state.actor.role === 'owner' || e.prepared_by !== state.actor.email)
  if (editing) return <Card title="Edit draft"><JournalEditor entry={e} onDone={async () => { await onChange(); setEditing(false) }} /></Card>
  return <Card title={<>{e.number ? `Entry ${e.number}` : 'Draft entry'} — {e.memo}</>} actions={e.status === 'posted' ? <Chip tone="good">Posted</Chip> : <Chip tone="warn">Draft</Chip>}>
    {e.status === 'posted' && <div className="callout callout-good"><Icon name="ok" /><div><strong>{e.reversed_by_id ? 'Posted and reversed' : 'Posted — reverse to correct'}</strong><span>{e.reverses_id ? 'This entry reverses an earlier one. ' : ''}Posted entries never change; a reversal keeps both in the history.</span></div></div>}
    <dl className="facts"><div><dt>Date</dt><dd>{day(e.entry_date)}</dd></div><div><dt>Source</dt><dd>{SOURCE[e.source_kind]}{e.adjusting && <> · <Chip tone="info">Adjusting</Chip></>}</dd></div><div><dt>Prepared by</dt><dd>{e.prepared_kind === 'agent' && <Icon name="agent" />}{who(e.prepared_by)}</dd></div><div><dt>{e.status === 'posted' ? 'Posted by' : 'Approver'}</dt><dd>{e.posted_by ? who(e.posted_by) : 'The owner, or someone else with the posting grant'}</dd></div></dl>
    <Table heads={['#', 'Account', 'Description', 'Debit', 'Credit']} figures={[3, 4]}>
      {e.lines.map((l: D) => <tr key={l.id}><td>{l.line_no}</td><td>{l.account_code} · {l.account_name}{l.reclassified_by && <small className="sub"> · reclassified</small>}</td><td>{l.memo}</td><td className="fig">{l.debit_cents ? usd(l.debit_cents) : '—'}</td><td className="fig">{l.credit_cents ? usd(l.credit_cents) : '—'}</td></tr>)}
    </Table>
    <p className={`balance-line ${debit === credit ? 'tone-good' : 'tone-bad'}`}>Debits {usd(debit)} {debit === credit ? '=' : '≠'} Credits {usd(credit)}</p>
    <EntryNotes e={e} onChange={onChange} />
    <AskAccountant subjectKind="journal" subjectId={e.id} label={`${e.number ? `Entry ${e.number}` : 'Draft entry'} · ${e.entry_date} · ${e.memo}`} />
    <div className="entry-receipts"><strong><Icon name="receipt" /> Receipt</strong> {e.documents.length ? e.documents.map((d: D) => <a key={d.id} className="doc-link" href={`/api/pantry/documents/${d.id}${/^image\//.test(d.media_type) ? '?view=1' : ''}`} target="_blank" rel="noreferrer">{d.name}</a>)
      : e.status === 'posted' && state.actor.can.record ? <><span className="hint">None yet.</span> <CaptureButtons compact target={{ kind: 'journal', id: e.id }} onDone={onChange} /></> : <span className="hint">None</span>}</div>
    <div className="row-actions">
      {e.status === 'draft' && e.source_kind === 'manual' && state.actor.can.record && <><button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit</button><Action tone="danger" run={async () => { await command('journal.discard', { id: e.id, revision: e.revision }); await onChange() }}>Discard draft</Action></>}
      {e.status === 'draft' && e.source_kind === 'manual' && (mayPost ? <Action tone="primary" run={async () => { await command('journal.post', { id: e.id, revision: e.revision }); await onChange() }}>Post entry</Action> : <span className="hint">Waiting for the owner or someone else with the posting grant to post it.</span>)}
      {e.status === 'draft' && e.source_kind === 'opening' && <span className="hint">Opening balances post when the accountant signs off the move-in.</span>}
      {e.status === 'posted' && !e.reversed_by_id && !['invoice', 'credit', 'reversal'].includes(e.source_kind) && state.actor.can.post && (reversing
        ? <Form label="Post reversal" submit={b => command('journal.reverse', { id: e.id, ...b })} onDone={async () => { setReversing(false); await onChange() }} className="grid-form"><Field label="Reversal date" name="date" type="date" defaultValue={today()} required /><Field label="Reason" name="memo" required /></Form>
        : <button type="button" className="btn btn-secondary" onClick={() => setReversing(true)}>Reverse</button>)}
    </div>
    <Details facts={{ id: e.id, revision: e.revision, reverses: e.reverses_id, 'reversed by': e.reversed_by_id, proposal: e.proposal_id, document: e.document_id }} />
  </Card>
}

function Journal() {
  const { data, error, reload } = useView<D>('journal'), { state } = useShared()
  const [selected, setSelected] = useState<string | null>(null), [creating, setCreating] = useState(false)
  if (!data) return <Loading error={error} what="the journal" />
  const current = data.entries.find((e: D) => e.id === selected)
  return <div className="split">
    <Card title="Journal entries" actions={state.actor.can.record && <button type="button" className="btn btn-primary" onClick={() => { setCreating(true); setSelected(null) }}>New journal entry</button>}>
      <Table heads={['Date', 'Entry', 'Description', 'Status', 'Amount']} figures={[4]} empty="No entries yet. Invoices, bills and payments post here as you record them.">
        {data.entries.map((e: D) => <tr key={e.id} className={selected === e.id ? 'selected' : ''} onClick={() => { setSelected(e.id); setCreating(false) }} tabIndex={0} onKeyDown={k => { if (k.key === 'Enter') { setSelected(e.id); setCreating(false) } }}>
          <td>{day(e.entry_date)}</td><td>{e.number ?? '—'}</td><td>{e.memo}{e.adjusting && <> <Chip tone="info">Adjusting</Chip></>}</td><td>{e.status === 'posted' ? (e.reversed_by_id ? <Chip>Reversed</Chip> : <Chip tone="good">Posted</Chip>) : e.prepared_kind === 'import' ? <Chip tone="info">Staged</Chip> : <Chip tone="warn">Draft</Chip>}</td>
          <td className="fig">{usd(e.lines.reduce((s: number, l: D) => s + l.debit_cents, 0))}</td></tr>)}
      </Table>
    </Card>
    <div>{creating ? <Card title="New journal entry"><JournalEditor onDone={async saved => { setCreating(false); await reload(); setSelected(saved.id) }} /></Card>
      : current ? <EntryPanel key={current.id + current.revision} e={current} onChange={reload} /> : <Card title="Entry"><p>Choose an entry to review it, or start a new one.</p></Card>}</div>
  </div>
}

export function Books() {
  const [tab, setTab] = useState('Chart of accounts'), { state } = useShared()
  const tb = useView<D>(`reports/trial-balance?to=${today()}`)
  const balances = new Map<string, number>((tb.data?.rows ?? []).map((r: D) => [r.id, r.net]))
  return <>
    <PageHead title="Books" lead="Your chart of accounts and journal. Posted entries never change: corrections are reversals." />
    <Tabs tabs={['Chart of accounts', 'Journal entries', 'Sales tax', 'Review']} current={tab} onChange={setTab} />
    {tab === 'Chart of accounts' && <div className="split"><Chart balances={balances} />{state.actor.can.record && <NewAccount />}</div>}
    {tab === 'Journal entries' && <Journal />}
    {tab === 'Sales tax' && <><TaxCodes /><NexusWatch /></>}
    {tab === 'Review' && <Review />}
  </>
}
