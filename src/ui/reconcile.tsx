// The reconciliation workspace: balance proof, statement lines beside ledger
// postings, a match being built (or an agent's proposal to approve), and
// Finish, which stays unavailable until the proof holds.
import { useState } from 'react'
import { Action, Card, Chip, command, Details, Field, Loading, Metrics, accountOptions, contactOptions, day, monthName, usd, useShared, useView, useWho, type D } from './kit'
import { RecordedPaymentProposal } from './recorded-payment-proposal'
import { DepositProposal } from './deposit-proposal'
import { ReconciliationUndo } from './reconciliation-undo'
import { Icon } from './icons'

type NewItem = { type: string; amount: string; accountId?: string; contactId?: string; otherBankAccountId?: string; direction?: string; memo?: string; allocations?: Record<string, string> }

// The buttons that add what the books lack, and the name each new item goes by.
const KINDS: [string, string, string][] = [['fee', '+ Expense or fee', 'New expense, charge or bank fee'], ['income', '+ Bank income', 'New bank income'], ['transfer', '+ Transfer', 'New transfer'],
  ['receipt', '+ Customer payment', 'New payment from a customer'], ['payment', '+ Vendor payment', 'New payment to a vendor']]

const plain = (s: string) => s.toUpperCase().replace(/[^A-Z0-9]+/g, '')
const plainRef = (o: D) => plain(o.number ?? o.reference ?? '')

/** Open invoices (for a customer payment) or bills (for a vendor payment) of the chosen contact. */
function openItems(sales: D | undefined, it: NewItem): D[] {
  if (!sales || !it.contactId) return []
  return it.type === 'receipt' ? sales.invoices.filter((i: D) => i.kind === 'invoice' && i.status === 'issued' && i.open_cents > 0 && i.customer_id === it.contactId)
    : sales.bills.filter((b: D) => b.status !== 'void' && b.status !== 'draft' && b.open_cents > 0 && b.vendor_id === it.contactId)
}

/** What a payment pays, before the person changes it: the one open item the statement line names or whose balance is exactly the amount. */
function suggested(open: D[], amount: string, lines: D[]): Record<string, string> {
  const cents = /^\d+(\.\d{1,2})?$/.test(amount) ? Math.round(Number(amount) * 100) : 0
  const words = plain(lines.map(l => `${l.description} ${l.reference ?? ''}`).join(' '))
  const named = open.filter(o => plainRef(o).length >= 3 && words.includes(plainRef(o)) && o.open_cents <= cents)
  const exact = open.filter(o => o.open_cents === cents)
  const pick = named.length === 1 ? named[0] : exact.length === 1 ? exact[0] : null
  return pick ? { [pick.id]: (Math.min(pick.open_cents, cents) / 100).toFixed(2) } : {}
}

export function MatchPanel({ lines, postings, bankId, clear, onDone, suggestedCategory }: { suggestedCategory?: D; lines: D[]; postings: D[]; bankId: string; clear: () => void; onDone: () => Promise<void> }) {
  const { state } = useShared(), [items, setItems] = useState<NewItem[]>(() => suggestedCategory && lines.length === 1 ? [{ type: suggestedCategory.billId ? 'payment' : lines[0].amount_cents < 0 ? 'fee' : 'income', amount: (Math.abs(lines[0].amount_cents) / 100).toFixed(2), accountId: suggestedCategory.accountId, contactId: suggestedCategory.contactId ?? undefined, allocations: suggestedCategory.billId ? { [suggestedCategory.billId]: (Math.abs(lines[0].amount_cents) / 100).toFixed(2) } : undefined, direction: lines[0].amount_cents < 0 ? 'out' : 'in', memo: suggestedCategory.payee }] : []), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const sales = useView<D>(items.some(i => i.type === 'receipt' || i.type === 'payment') ? 'sales' : null).data
  // Until the person types what a payment pays, it pays what Pantry suggests from the line and the open items.
  const applies = (it: NewItem) => it.allocations ?? suggested(openItems(sales, it), it.amount, lines)
  const statement = lines.reduce((s, l) => s + l.amount_cents, 0)
  const signed = (i: NewItem) => { const c = /^\d+(\.\d{1,2})?$/.test(i.amount) ? Math.round(Number(i.amount) * 100) : 0; return i.type === 'payment' || ((i.type === 'fee' || i.type === 'transfer') && i.direction !== 'in') ? -c : c }
  const ledger = postings.reduce((s, p) => s + Number(p.amount), 0) + items.reduce((s, i) => s + signed(i), 0)
  const set = (k: number, patch: Partial<NewItem>) => setItems(xs => xs.map((x, j) => j === k ? { ...x, ...patch } : x))
  const add = (type: string) => setItems(xs => [...xs, { type, amount: Math.abs(statement - ledger) ? (Math.abs(statement - ledger) / 100).toFixed(2) : '', direction: statement - ledger >= 0 ? 'in' : 'out' }])
  return <Card title="Match review" className="match-panel">
    <div className="match-grid">
      <div><h3>Statement line{lines.length === 1 ? '' : 's'}</h3>{lines.length ? lines.map(l => <p key={l.id} className="pair"><span>{day(l.posted_date)} {l.description}</span><strong>{usd(l.amount_cents)}</strong></p>) : <p className="hint">Choose the statement lines to match.</p>}</div>
      <div><h3>Ledger postings</h3>{postings.map(p => <p key={p.id} className="pair"><span>{day(p.entry_date)} {p.memo}</span><strong>{usd(Number(p.amount))}</strong></p>)}
        {items.map((it, k) => <div className="new-item" key={k}>
          <strong>{KINDS.find(k => k[0] === it.type)![2]}</strong>
          <div className="grid-form">
            <Field label="Amount" name={`amount-${k}`} value={it.amount} onChange={(e: any) => set(k, { amount: e.target.value })} inputMode="decimal" />
            {(it.type === 'fee' || it.type === 'income') && <Field label="Account" name={`account-${k}`} value={it.accountId ?? ''} onChange={(e: any) => set(k, { accountId: e.target.value })} options={accountOptions(state.accounts, a => !['bank', 'receivable', 'payable'].includes(a.subtype))} />}
            {(it.type === 'fee' || it.type === 'income') && <Field label="Payee" name={`payee-${k}`} empty="No named payee" value={it.contactId ?? ''} onChange={(e: any) => set(k, { contactId: e.target.value })} options={contactOptions(state.contacts, it.type === 'fee' ? 'vendor' : 'customer')} />}
            {it.type === 'transfer' && <><Field label="Other bank account" name={`other-${k}`} value={it.otherBankAccountId ?? ''} onChange={(e: any) => set(k, { otherBankAccountId: e.target.value })} options={state.bankAccounts.filter((b: D) => b.id !== bankId).map((b: D) => ({ value: b.id, label: b.name }))} /><Field label="Money" name={`dir-${k}`} value={it.direction ?? 'out'} onChange={(e: any) => set(k, { direction: e.target.value })} options={[{ value: 'in', label: 'Came in' }, { value: 'out', label: 'Went out' }]} /></>}
            {(it.type === 'receipt' || it.type === 'payment') && <Field label={it.type === 'receipt' ? 'Customer' : 'Vendor'} name={`contact-${k}`} value={it.contactId ?? ''} onChange={(e: any) => set(k, { contactId: e.target.value, allocations: undefined })} options={contactOptions(state.contacts, it.type === 'receipt' ? 'customer' : 'vendor')} />}
          </div>
          {(it.type === 'receipt' || it.type === 'payment') && <Applies it={it} open={openItems(sales, it)} applied={applies(it)} onChange={allocations => set(k, { allocations })} />}
          <button type="button" className="btn btn-link" onClick={() => setItems(xs => xs.filter((_, j) => j !== k))}>Remove</button>
        </div>)}
        <div className="row-actions small">{KINDS.map(([t, label]) => <button key={t} type="button" className="btn btn-secondary btn-small" onClick={() => add(t)}>{label}</button>)}</div>
      </div>
      <div className="match-totals">
        <p className="pair"><span>Statement</span><strong>{usd(statement)}</strong></p><p className="pair"><span>Ledger</span><strong>{usd(ledger)}</strong></p>
        <p className={`pair ${statement === ledger ? 'tone-good' : 'tone-bad'}`}><span>Difference</span><strong>{usd(statement - ledger)}</strong></p>
        <button type="button" className="btn btn-primary btn-block" disabled={busy || !lines.length || statement !== ledger} onClick={async () => {
          setBusy(true); setError('')
          const create = items.map(({ allocations, ...i }) => ({ ...i, allocations: Object.entries(i.type === 'receipt' || i.type === 'payment' ? applies({ ...i, allocations }) : {}).filter(([, v]) => v).map(([targetId, amount]) => ({ targetId, amount })) }))
          try { await command('match.approve', { bankLineIds: lines.map(l => l.id), journalLineIds: postings.map(p => p.id), create }); setItems([]); clear(); await onDone() } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
        }}>Approve match</button>
        <button type="button" className="btn btn-secondary btn-block" onClick={() => { setItems([]); clear() }}>Clear</button>
        {error && <p role="alert" className="error">{error}</p>}
      </div>
    </div>
  </Card>
}

/** Which of the contact's open invoices or bills a new payment pays. */
function Applies({ it, open, applied, onChange }: { it: NewItem; open: D[]; applied: Record<string, string>; onChange: (a: Record<string, string>) => void }) {
  if (!it.contactId) return null
  const what = it.type === 'receipt' ? 'invoices' : 'bills', any = Object.values(applied).some(v => v)
  if (!open.length) return <p className="hint">No open {what} for them; the payment is recorded as unapplied.</p>
  return <fieldset className="allocations"><legend>Pays these open {what}</legend>
    {open.map(o => <div className="field" key={o.id}><label htmlFor={`ap-${o.id}`}>{o.number ?? o.reference} — {usd(o.open_cents)} open</label>
      <input id={`ap-${o.id}`} inputMode="decimal" value={applied[o.id] ?? ''} onChange={e => onChange({ ...applied, [o.id]: e.target.value })} /></div>)}
    {!any && <p className="hint">Not applied yet: enter what it pays, or it stays unapplied until you apply it under Sales &amp; bills › Payments.</p>}
  </fieldset>
}

function Proposed({ p, onDone }: { p: D; onDone: () => Promise<void> }) {
  return <Card title={<><Icon name="agent" /> Match proposed by {p.agent_name}</>} className="match-panel">
    <p>{p.summary}</p>
    <p className="hint">Used {p.payload.bankLineIds.length} statement line{p.payload.bankLineIds.length === 1 ? '' : 's'} and {p.payload.journalLineIds.length} ledger posting{p.payload.journalLineIds.length === 1 ? '' : 's'}{p.payload.create?.length ? `, adding ${p.payload.create.length} bank item${p.payload.create.length === 1 ? '' : 's'}` : ''}. Approving re-checks every one of them.</p>
    <div className="row-actions">
      <Action tone="primary" run={async () => { await command('proposal.decide', { id: p.id, revision: p.revision, decision: 'approve' }); await onDone() }}>Approve match</Action>
      <Action run={async () => { await command('proposal.decide', { id: p.id, revision: p.revision, decision: 'reject' }); await onDone() }}>Reject</Action>
    </div>
    <Details facts={{ proposal: p.id, 'statement lines': p.payload.bankLineIds.join(', '), postings: p.payload.journalLineIds.join(', ') }} />
  </Card>
}

export function Reconcile({ statementId, back }: { statementId: string; back: () => void }) {
  const { data: r, error, reload } = useView<D>(`reconciliation/${statementId}`), proposals = useView<D>('proposals'), shared = useShared(), who = useWho()
  const [lineIds, setLineIds] = useState<string[]>([]), [postingIds, setPostingIds] = useState<string[]>([])
  if (!r) return <Loading error={error} what="the reconciliation" />
  const refresh = async () => { await reload(); await proposals.reload(); await shared.reload() }
  const matchedPostings = new Set(r.postings.filter((p: D) => p.match_id).map((p: D) => p.id))
  const waiting = (proposals.data?.proposals ?? []).filter((p: D) => p.kind === 'match' && p.status === 'proposed' && p.payload.bankLineIds.some((id: string) => r.lines.some((l: D) => l.id === id)))
  const proposedLines = new Set(waiting.flatMap((p: D) => p.payload.bankLineIds))
  const toggle = (list: string[], set: (x: string[]) => void, id: string) => set(list.includes(id) ? list.filter(x => x !== id) : [...list, id])
  const finished = !!r.completed
  return <>
    <div className="page-head"><div><button type="button" className="btn btn-link back" onClick={back}>← Bank</button><h1>Reconcile {r.bank.name} — {monthName(r.statement.end_date.slice(0, 7))}</h1><p className="lead">Statement {day(r.statement.start_date)} to {day(r.statement.end_date)}, imported from {r.statement.source_name}.</p></div></div>
    <div className="proof">
      <Metrics items={[
        { label: 'Statement opening balance', value: usd(r.opening), icon: 'bank' },
        { label: 'Statement closing balance', value: usd(r.closing), icon: 'bank' },
        { label: 'Cleared in Pantry', value: usd(r.cleared), note: <>Book {usd(r.book)} less {usd(r.outstandingTotal)} not yet on a statement</>, icon: 'ok' },
        { label: 'Difference', value: usd(r.difference), tone: r.difference === 0 ? 'good' : 'bad', icon: r.difference === 0 ? 'ok' : 'alert' },
      ]} />
      <div className="finish">
        {finished ? <><Chip tone="good">Reconciled</Chip><p>By {who(r.completed.completed_by)}, {day(r.completed.completed_at)}</p></>
          : <><Action tone="primary" disabled={!r.ready || !shared.state.actor.can.record} run={async () => { await command('reconciliation.complete', { statementId }); await refresh() }}>Finish reconciliation</Action>
            <p>{r.ready ? 'Every line is matched and the balances agree.' : 'You can finish when every difference is explained.'}</p></>}
      </div>
    </div>
    <ReconciliationUndo info={r.undo} history={r.history} statementId={statementId} onDone={refresh} />
    {!finished && r.blockers.length > 0 && <div className="callout callout-warn" role="status"><Icon name="alert" /><div><strong>Before you can finish</strong><ul>{r.blockers.map((b: D) => <li key={b.kind}>{b.message}</li>)}</ul></div></div>}
    <div className="split even">
      <Card title="Statement lines" actions={lineIds.length > 0 && <Chip tone="info">{lineIds.length} selected</Chip>}>
        <div className="table-wrap"><table className="ledger selectable"><thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Description</th><th className="fig">Amount</th><th>Status</th></tr></thead>
          <tbody>{r.lines.map((l: D) => { const picked = lineIds.includes(l.id); return <tr key={l.id} className={picked ? 'selected' : proposedLines.has(l.id) && !l.match_id ? 'proposed' : ''}>
            <td data-label="Select"><input type="checkbox" aria-label={`Select ${l.description} ${usd(l.amount_cents)}`} checked={picked} disabled={!!l.match_id || finished} onChange={() => toggle(lineIds, setLineIds, l.id)} /></td>
            <td data-label="Date">{day(l.posted_date)}</td><td data-label="Description">{l.description}{l.automatic ? <small className="sub block">{l.match_note}</small> : !l.match_id && r.depositNotes[l.id] ? <small className="sub block">{r.depositNotes[l.id]}</small> : null}</td><td data-label="Amount" className="fig">{usd(l.amount_cents)}</td>
            <td data-label="Status">{l.automatic ? <><Chip tone="good">Matched automatically</Chip>{!finished && shared.state.actor.can.record && <Action run={async () => { await command('match.undo', { id: l.match_id, reason: 'Automatic match undone by a person' }); await refresh() }}>Undo</Action>}</> : l.match_id ? <><Chip tone="good">Matched</Chip>{!finished && shared.state.actor.can.record && <Action run={async () => { await command('match.undo', { id: l.match_id }); await refresh() }}>Undo</Action>}</> : proposedLines.has(l.id) ? <Chip tone="agent">Proposed by agent</Chip> : <><Chip tone="warn">Unmatched</Chip><RecordedPaymentProposal offers={r.recordedPayments?.[l.id]} canRecord={!finished && shared.state.actor.can.record} onDone={refresh} /><DepositProposal proposal={r.depositProposals[l.id]} canRecord={!finished && shared.state.actor.can.record} onDone={refresh} /></>}</td></tr> })}</tbody></table></div>
      </Card>
      <Card title="Ledger postings">
        <div className="table-wrap"><table className="ledger selectable"><thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Entry</th><th className="fig">Amount</th><th>Status</th></tr></thead>
          <tbody>{r.postings.length ? r.postings.map((p: D) => { const picked = postingIds.includes(p.id); return <tr key={p.id} className={picked ? 'selected' : ''}>
            <td data-label="Select"><input type="checkbox" aria-label={`Select ${p.memo} ${usd(Number(p.amount))}`} checked={picked} disabled={matchedPostings.has(p.id) || finished} onChange={() => toggle(postingIds, setPostingIds, p.id)} /></td>
            <td data-label="Date">{day(p.entry_date)}</td><td data-label="Entry">{p.number} · {p.memo}</td><td data-label="Amount" className="fig">{usd(Number(p.amount))}</td><td data-label="Status">{p.match_id ? <Chip tone="good">Cleared</Chip> : <Chip>Not yet on a statement</Chip>}</td></tr> }) : <tr className="empty"><td colSpan={5}>No postings in this bank account for the statement period.</td></tr>}</tbody></table></div>
      </Card>
    </div>
    {waiting.map((p: D) => <Proposed key={p.id} p={p} onDone={refresh} />)}
    {!finished && <MatchPanel lines={r.lines.filter((l: D) => lineIds.includes(l.id))} postings={r.postings.filter((p: D) => postingIds.includes(p.id))} bankId={r.bank.id} clear={() => { setLineIds([]); setPostingIds([]) }} onDone={refresh} />}
  </>
}
