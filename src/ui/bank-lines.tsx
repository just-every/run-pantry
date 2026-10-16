// Transactions: every bank and card line from files and feeds, newest first,
// with how it was filed. Lines filed by a rule name the rule and can be undone;
// lines still to file can be chosen and filed here; pending ones wait for the bank.
import { useState } from 'react'
import { Action, Card, Chip, command, Field, day, usd, useShared, type D } from './kit'
import { MatchPanel } from './reconcile'
import { Icon } from './icons'

const FILTERS = ['All', 'To file', 'Filed by rule', 'Pending'] as const

function Status({ l, onUndo }: { l: D; onUndo: () => Promise<void> }) {
  const can = useShared().state.actor.can.record
  if (l.pending) return <Chip>Pending</Chip>
  if (l.removed_at) return <Chip tone="bad">Removed by the bank</Chip>
  if (l.rule_id) return <span className="filed"><Chip tone="good">Filed by rule · {l.rule_name}</Chip><small className="sub">{l.filed_to.join(', ')}</small>
    {can && !l.reconciliation_id && <Action run={async () => { await command('bank-rule.undo', { matchId: l.match_id }); await onUndo() }}>Undo</Action>}</span>
  if (l.match_id) return <span className="filed"><Chip tone="good">Filed</Chip><small className="sub">{l.filed_to.join(', ')}</small></span>
  return <Chip tone="warn">To file</Chip>
}

export function Suggestions({ items, onPick }: { items: D[]; onPick: (s: D) => void }) {
  if (!items?.length) return null
  return <>{items.map(s => <div key={`${s.payee}-${s.accountId}`} className="callout" role="status"><Icon name="agent" />
    <div><strong>You have filed {s.payee} to {s.accountName} {s.count} times.</strong><span>Make it a rule and Pantry files the next ones for you, marked “by rule” with an undo.</span></div>
    <button type="button" className="btn btn-secondary btn-small" onClick={() => onPick(s)}>Make a rule</button></div>)}</>
}

export function Transactions({ data, onDone }: { data: D | undefined; onDone: () => Promise<void> }) {
  const { state } = useShared(), [filter, setFilter] = useState<string>('All'), [account, setAccount] = useState(''), [picked, setPicked] = useState<string[]>([])
  if (!data) return null
  const rows: D[] = [...data.pending.map((p: D) => ({ ...p, pending: true, filed_to: [] })), ...data.lines]
    .filter(l => !account || l.bank_account_id === account)
    .filter(l => filter === 'All' || (filter === 'Pending' ? l.pending : filter === 'Filed by rule' ? l.rule_id : !l.pending && !l.match_id && !l.removed_at))
    .sort((a, b) => b.posted_date.localeCompare(a.posted_date))
  const chosen = data.lines.filter((l: D) => picked.includes(l.id))
  const toggle = (id: string) => setPicked(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id])
  return <>
    <Card title="Transactions" actions={<div className="inline-fields">
      <Field label="Show" name="filter" value={filter} onChange={(e: any) => setFilter(e.target.value)} options={FILTERS.map(f => ({ value: f, label: f }))} />
      <Field label="Account" name="account" empty="All accounts" value={account} onChange={(e: any) => setAccount(e.target.value)} options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} />
    </div>}>
      <div className="table-wrap"><table className="ledger selectable"><thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Account</th><th>Description</th><th className="fig">Amount</th><th>Filed</th></tr></thead>
        <tbody>{rows.length ? rows.map(l => { const open = !l.pending && !l.match_id && !l.removed_at
          return <tr key={(l.pending ? 'p-' : '') + l.id} className={picked.includes(l.id) ? 'selected' : ''}>
            <td data-label="Select">{open && <input type="checkbox" aria-label={`Select ${l.description} ${usd(l.amount_cents)}`} checked={picked.includes(l.id)} onChange={() => toggle(l.id)} />}</td>
            <td data-label="Date">{day(l.posted_date)}</td><td data-label="Account">{l.bank_name}</td>
            <td data-label="Description">{l.description}{l.payee && !l.description.toLowerCase().includes(l.payee.toLowerCase()) && <small className="sub"> · {l.payee}</small>}{l.feed_txn_id && <small className="sub"> · feed</small>}</td>
            <td data-label="Amount" className="fig">{usd(l.amount_cents)}</td>
            <td data-label="Filed"><Status l={l} onUndo={onDone} /></td></tr> }) : <tr className="empty"><td colSpan={6}>{data.lines.length ? 'Nothing matches this view.' : 'No transactions yet. Connect a bank or card, or import a statement.'}</td></tr>}</tbody></table></div>
    </Card>
    {chosen.length > 0 && <MatchPanel lines={chosen} postings={[]} bankId={chosen[0].bank_account_id} clear={() => setPicked([])} onDone={onDone} />}
  </>
}
