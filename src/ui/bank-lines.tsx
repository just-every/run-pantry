import { Help } from './help'
import { LineSuggestion, SuggestionRates } from './line-suggestions'
// Transactions: every bank and card line from files and feeds, newest first,
// with how it was filed. Lines filed by a rule name the rule and can be undone;
// lines still to file can be chosen and filed here; pending ones wait for the bank.
import { useEffect, useState } from 'react'
import { Action, Card, Chip, command, Empty, Field, Form, Table, day, usd, useShared, useWho, type D } from './kit'
import { RecordedPaymentProposal } from './recorded-payment-proposal'
import { DepositProposal } from './deposit-proposal'
import { MatchPanel } from './reconcile'
import { Icon } from './icons'
import { ListFilters } from './list-filters'
import { AskAccountant } from './ask-accountant'

const FILTERS = ['All', 'To file', 'Filed by rule', 'Pending', 'Excluded'] as const

function Status({ l, onUndo, picked, onFile }: { l: D; onUndo: () => Promise<void>; picked: boolean; onFile: () => void }) {
  const can = useShared().state.actor.can.record
  if(l.excluded_at)return <ExclusionStatus line={l} onDone={onUndo} />
  if (l.pending) return <Chip>Pending</Chip>
  if (l.removed_at) return <Chip tone="bad">Removed by the bank</Chip>
  if (l.transfer && (['pending', 'exception'].includes(l.transfer.status) || (l.transfer.status === 'paired' && l.transfer.pair_status === 'paired'))) return <TransferStatus l={l} onDone={onUndo} />
  if (l.rule_id) return <span className="filed"><Chip tone="good">{l.agent_permission_name?'Books agent · '+l.agent_permission_name:'Filed by rule · '+l.rule_name}</Chip><small className="sub">{l.filed_to.join(', ')} · {l.rule_snapshot?.legacy ? 'Legacy filing; original conditions not recorded' : <details><summary>Filing details</summary><p>Rule version: {l.rule_revision}</p></details>}</small>
    {can && !l.reconciliation_id && <span className="row-reveal"><Action run={async () => { await command('bank-rule.undo', { matchId: l.match_id }); await onUndo() }}>Undo</Action></span>}</span>
  if (l.match_id) return <span className="filed"><Chip tone="good">{l.automatic ? 'Matched automatically' : 'Filed'}</Chip><small className="sub">{l.filed_to.join(', ')}</small>
    {can && !l.reconciliation_id && <span className="row-reveal"><Action run={async () => { await command('match.undo', { id: l.match_id }); await onUndo() }}>Undo</Action></span>}</span>
  return <span className="filed"><Chip tone="warn">To file</Chip>{can && <button type="button" className="btn btn-link" aria-pressed={picked} onClick={e => { e.stopPropagation(); onFile() }}>{picked ? 'Chosen' : 'File it'}</button>}</span>
}

/** A held half names its expected account; resolving it always needs a person. */
function TransferStatus({ l, onDone }: { l: D; onDone: () => Promise<void> }) {
  const { state } = useShared(), [action, setAction] = useState('')
  const t = l.transfer, paired = t.status === 'paired'
  const finish = async () => { setAction(''); await onDone() }
  return <span className="filed">
    <Chip tone={paired ? 'good' : t.status === 'exception' ? 'bad' : 'warn'}>{paired ? 'Transfer paired' : t.status === 'exception' ? 'Transfer counterpart overdue' : 'Pending transfer'}</Chip>
    <small className="sub">{t.expected_account ? `${l.amount_cents < 0 ? 'To' : 'From'} ${t.expected_account}` : 'Choose the other account to identify this transfer'}{!paired && <> · waiting through {day(t.due_date)}</>}</small>
    {t.blocked && <small className="sub">{t.blocked}</small>}
    {state.actor.can.record && !t.blocked && <>
      {!action && <span className="row-actions">{paired
        ? !l.reconciliation_id && <button type="button" className="btn btn-link" onClick={() => setAction('undo')}>Undo both matches</button>
        : <><button type="button" className="btn btn-link" onClick={() => setAction('expect')}>{t.expected_account ? 'Change account' : 'Choose account'}</button><button type="button" className="btn btn-link" onClick={() => setAction('dismiss')}>Not a transfer</button></>}</span>}
      {action && <Form label={action === 'expect' ? 'Save account' : action === 'undo' ? 'Undo transfer' : 'Release line'} className="inline-form"
        submit={b => command(`transfer.${action}`, action === 'undo' ? { id: t.pair_id, ...b } : { bankLineId: l.id, revision: t.revision, ...b })} onDone={finish}>
        {action === 'expect' ? <Field label="Other account" name="otherBankAccountId" defaultValue={t.expected_bank_account_id ?? ''} required options={state.bankAccounts.filter((b: D) => b.id !== l.bank_account_id).map((b: D) => ({ value: b.id, label: `${b.name} · ${b.number_last4}` }))} /> : <Field label="Reason" name="reason" required />}
        <button type="button" className="btn btn-link" onClick={() => setAction('')}>Cancel</button>
      </Form>}
    </>}
  </span>
}

export function Suggestions({ items, onPick }: { items: D[]; onPick: (s: D) => void }) {
  if (!items?.length) return null
  return <>{items.map(s => <div key={`${s.payee}-${s.accountId}`} className="callout" role="status"><Icon name="agent" />
    <div><strong>You have filed {s.payee} to {s.accountName} {s.count} times.</strong><span>Make it a rule and Pantry files the next ones for you, marked “by rule” with an undo.</span></div>
    <button type="button" className="btn btn-secondary btn-small" onClick={() => onPick(s)}>Make a rule</button></div>)}</>
}

export function Transactions({ data, onDone, feeds }: { data: D | undefined; onDone: () => Promise<void>; feeds: boolean }) {
  const { state } = useShared(), [filter, setFilter] = useState<string>('All'), [account, setAccount] = useState(''), [picked, setPicked] = useState<string[]>([]),[updating,setUpdating]=useState(false)
  const finish=async()=>{setUpdating(true);try{await onDone();setPicked([])}finally{setUpdating(false)}}
  useEffect(()=>{setPicked([])},[filter,account])
  useEffect(()=>{
    const key=(event:KeyboardEvent)=>{
      if(updating)return
      if(event.key==='Escape'){event.preventDefault();setPicked([]);return}
      if(!state.actor.can.record)return
      if(event.ctrlKey||event.metaKey||event.altKey||(event.target as HTMLElement)?.closest('input,select,textarea,[contenteditable=true]'))return
      const lines=Array.from(document.querySelectorAll<HTMLElement>('[data-review-line]'))
      const index=lines.findIndex(row=>row.contains(document.activeElement)),k=event.key.toLowerCase()
      if(k==='j'||k==='k'){event.preventDefault();lines[Math.max(0,Math.min(lines.length-1,index+(k==='j'?1:-1)))]?.focus()}
      if(k==='x'&&index>=0){event.preventDefault();const id=lines[index].dataset.reviewLine!;setPicked(xs=>xs.includes(id)?xs.filter(x=>x!==id):[...xs,id])}
      if(k==='a'&&event.shiftKey){event.preventDefault();setPicked(lines.slice(0,50).map(row=>row.dataset.reviewLine!))}
    };document.addEventListener('keydown',key);return()=>document.removeEventListener('keydown',key)
  },[data,filter,account,state.actor.can.record,updating])
  if (!data) return null
  const rows: D[] = [...data.pending.map((p: D) => ({ ...p, pending: true, filed_to: [] })), ...data.lines]
    .filter(l => !account || l.bank_account_id === account)
    .filter(l => filter === 'All' || (filter === 'Pending' ? l.pending : filter === 'Filed by rule' ? l.rule_id : filter === 'Excluded' ? l.excluded_at : !l.pending && !l.match_id && !l.removed_at && !l.excluded_at))
    .sort((a, b) => b.posted_date.localeCompare(a.posted_date))
  const chosen: D[] = data.lines.filter((l: D) => !l.match_id && !l.removed_at && !l.excluded_at && picked.includes(l.id))
  const toggle = (id: string) => !updating && setPicked(xs => xs.includes(id) ? xs.filter(x => x !== id) : [...xs, id])
  return <fieldset disabled={updating} aria-label="Bank review queue" aria-busy={updating} style={{border:0,padding:0,margin:0,minWidth:0}}>
    {updating&&<p role="status" className="hint">Updating the review queue…</p>}
    <MatchPanelScroll count={chosen.length} />
    {state.actor.can.record && <Help label="Keyboard shortcuts"><p>J/K move between review lines · X selects the focused line · Shift+A selects up to 50 visible lines · Escape clears the selection.</p></Help>}
    <Card title="Transactions" actions={<ListFilters active={[...(filter !== 'All' ? [{ label: filter, clear: () => setFilter('All') }] : []), ...(account ? [{ label: state.bankAccounts.find((b: D) => b.id === account)?.name ?? 'Account', clear: () => setAccount('') }] : [])]}>
      <Field label="Show" name="filter" value={filter} onChange={(e: any) => setFilter(e.target.value)} options={FILTERS.map(f => ({ value: f, label: f }))} />
      <Field label="Account" name="account" empty="All accounts" value={account} onChange={(e: any) => setAccount(e.target.value)} options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} />
    </ListFilters>}>
      {rows.some(l => !l.pending && !l.match_id && !l.removed_at && !l.excluded_at) && state.actor.can.record && <Help label="How to file a transaction"><p>Choose a line marked To file, or several that one payment covers, and file it below: match it to what is already in the books, or add the expense, income or transfer it is.</p></Help>}
      {chosen.length > 0 && state.actor.can.record && <div className="row-actions"><button type="button" className="btn btn-secondary" onClick={()=>setPicked(rows.filter(l=>!l.pending&&!l.match_id&&!l.removed_at&&!l.excluded_at).slice(0,50).map(l=>l.id))}>Select up to 50 visible review lines</button><button type="button" className="btn btn-link" onClick={()=>setPicked([])}>Clear selection</button></div>}
      <div className="table-wrap"><table className="ledger selectable"><thead><tr><th><span className="sr-only">Select</span></th><th>Date</th><th>Account</th><th>Description</th><th className="fig">Amount</th><th>Filed</th></tr></thead>
        <tbody>{rows.length ? rows.map(l => { const open = !l.pending && !l.match_id && !l.removed_at && !l.excluded_at
          // A line still to file is chosen by clicking it anywhere (or its File it button); several chosen lines file as one match.
          return <tr tabIndex={0} data-review-line={open?l.id:undefined} key={(l.pending ? 'p-' : '') + l.id} className={`quiet-row ${picked.includes(l.id) ? 'selected' : ''}${open ? ' pickable' : ''}`} onClick={open ? () => toggle(l.id) : undefined}>
            <td data-label="Select">{open && <input type="checkbox" aria-label={`Select ${l.description} ${usd(l.amount_cents)}`} checked={picked.includes(l.id)} onChange={() => toggle(l.id)} onClick={e => e.stopPropagation()} />}</td>
            <td data-label="Date">{day(l.posted_date)}</td><td data-label="Account">{l.bank_name}</td>
            <td data-label="Description">{l.description}{l.payee && !l.description.toLowerCase().includes(l.payee.toLowerCase()) && <small className="sub"> · {l.payee}</small>}{l.feed_txn_id && <small className="sub feed-tag">feed</small>}</td>
            <td data-label="Amount" className={`fig${l.amount_cents > 0 ? ' money-in' : ''}`}>{usd(l.amount_cents)}</td>
            <td data-label="Filed"><LineSuggestion suggestion={data.suggestions?.[l.id]} /><Status l={l} onUndo={finish} picked={picked.includes(l.id)} onFile={() => toggle(l.id)} /><RecordedPaymentProposal offers={l.excluded_at || ['pending', 'exception'].includes(l.transfer?.status) ? undefined : data.recordedPayments?.[l.id]} canRecord={state.actor.can.record} onDone={finish} /><DepositProposal proposal={l.excluded_at || ['pending', 'exception'].includes(l.transfer?.status) ? undefined : data.depositProposals?.[l.id]} canRecord={state.actor.can.record} onDone={finish} />{!l.pending && <AskAccountant subjectKind="bank-line" subjectId={l.id} label={`${l.posted_date} · ${l.description} · ${usd(l.amount_cents)}`} />}</td></tr> }) : <tr className="empty"><td colSpan={6}><Empty>{data.lines.length ? 'Nothing matches this view.' : <><strong className="empty-title">No transactions yet.</strong>{feeds ? 'Connect a bank or card, or import a statement.' : 'Import a statement and its lines appear here.'}</>}</Empty></td></tr>}</tbody></table></div>
    </Card>
    <SuggestionRates rates={data.suggestionRates} />
    {chosen.length > 0 && <QueueSelection key={'queue:'+chosen.map(l=>l.id).join(':')} lines={chosen} onDone={finish} />}
    {chosen.length > 0 && new Set(chosen.map(l=>l.bank_account_id)).size===1 && <MatchPanel key={'match:'+chosen.map((l: D) => l.id).join(':')} suggestedCategory={chosen.length === 1 ? data.suggestions?.[chosen[0].id] : undefined} lines={chosen} postings={[]} bankId={chosen[0].bank_account_id} clear={() => setPicked([])} onDone={finish} />}
  </fieldset>
}

/** Brings Match review into view when the first line is chosen, so filing a line never happens off screen. */
function MatchPanelScroll({ count }: { count: number }) {
  useEffect(() => { if (count === 1) document.querySelector('.match-panel')?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) }, [count])
  return null
}

function QueueSelection({lines,onDone}:{lines:D[];onDone:()=>Promise<void>}){
 const [preview,setPreview]=useState<D|null>(null),[reviewed,setReviewed]=useState(false)
 return <Card title={`Review ${lines.length} selected line${lines.length===1?'':'s'}`}>
  <p>Accept each line's displayed category separately. Lines needing a payment match or an individual decision stay for review.</p>
  <Action run={async()=>{setReviewed(false);setPreview(await command('bank-queue.preview',{ids:lines.map(l=>l.id)}))}}>Review selected suggestions</Action>
  {preview&&<>
   <Table heads={['Line','Amount','Suggested category','Review']} figures={[1]}>
    {preview.items.map((item:D)=><tr key={item.id}><td>{item.description}</td><td className="fig">{usd(item.amount_cents)}</td><td>{item.suggestion?.accountName??'Individual review needed'}</td><td>{item.reason}</td></tr>)}
   </Table>
   <label className="check"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} /> I reviewed every displayed category and amount.</label>
   <Action tone="primary" disabled={!reviewed||preview.items.some((i:D)=>!i.available)} run={async()=>{await command('bank-queue.accept',{items:preview.items.map((i:D)=>({id:i.id,fingerprint:i.fingerprint}))});await onDone()}}>Accept selected suggestions</Action>
  </>}
  {lines.length===1&&<Form label="Exclude selected line" submit={b=>command('bank-line.exclude',{...b,id:lines[0].id})} onDone={onDone}>
   <Field label="Exclude as" name="kind" required options={[{value:'personal',label:'Personal'},{value:'duplicate',label:'Duplicate'}]} defaultValue="personal" />
   <Field label="Exclusion reason" name="reason" required />
   <p className="hint">Exclusion makes no entry. The line stays visible with your reason. A real bank movement still needs an entry before its statement can reconcile.</p>
  </Form>}
 </Card>
}
function ExclusionStatus({line,onDone}:{line:D;onDone:()=>Promise<void>}){
 const {state}=useShared(),who=useWho(),[restore,setRestore]=useState(false)
 return <span className="filed"><Chip>Excluded · {line.excluded_kind}</Chip><small className="sub">{line.excluded_reason} · {who(line.excluded_by)}</small>
  {state.actor.can.record&&!restore&&<button type="button" className="btn btn-link" onClick={()=>setRestore(true)}>Restore for review</button>}
  {restore&&<Form label="Restore excluded line" submit={b=>command('bank-line.exclude',{...b,id:line.id,revision:line.exclusion_revision,restore:true})} onDone={onDone}><Field label="Restoration reason" name="reason" required /><button type="button" className="btn btn-link" onClick={()=>setRestore(false)}>Cancel</button></Form>}
 </span>
}
