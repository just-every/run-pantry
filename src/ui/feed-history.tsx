// Backfill choices and observations held outside the posting queue.
import { useState } from 'react'
import { Action, command, day, Field, Form, usd, type D } from './kit'

const REFERENCE_REASON: Record<string, string> = { 'before-books': 'Before books start', 'locked-period': 'Locked period', 'opening-balance': 'Included in opening balance' }

export const HISTORY_MODES = [
  { value: 'booksStart', label: 'Books start date' },
  { value: 'lastReconciled', label: 'Day after the last reconciled statement' },
  { value: 'explicit', label: 'Choose a date' },
]

export function HistoryFields({ prefix, mode, startDate, onChange }: { prefix: string; mode: string; startDate: string; onChange: (patch: { historyMode?: string; historyDate?: string }) => void }) {
  return <>
    <Field label="Start feed history" name={`history-${prefix}`} value={mode} options={HISTORY_MODES} onChange={(e: any) => onChange({ historyMode: e.target.value })} />
    {mode === 'explicit' && <Field label="History start date" name={`history-date-${prefix}`} type="date" required value={startDate} onChange={(e: any) => onChange({ historyDate: e.target.value })} />}
  </>
}

export function HistoryChoice({ account, onDone }: { account: D; onDone: () => Promise<void> }) {
  const [editing, setEditing] = useState(false)
  const [choice, setChoice] = useState({ historyMode: account.history_mode ?? 'booksStart', historyDate: account.history_start ?? '' })
  return <div>
    <p className="hint">Feed starts {day(account.history_start)}. Earliest history received: {day(account.available_from)}.</p>
    {!editing ? <button className="btn btn-link" type="button" onClick={() => setEditing(true)}>Change history start</button> : <Form label="Save history start" submit={() => command('feed.history', { feedAccountId: account.id, revision: account.revision, history: { mode: choice.historyMode, ...(choice.historyMode === 'explicit' ? { startDate: choice.historyDate } : {}) } })} onDone={async () => { setEditing(false); await onDone() }}>
      <HistoryFields prefix={account.id} mode={choice.historyMode} startDate={choice.historyDate} onChange={patch => setChoice(c => ({ ...c, ...patch }))} />
      <button className="btn btn-link" type="button" onClick={() => setEditing(false)}>Cancel</button>
    </Form>}
  </div>
}

function DuplicateDecision({ observation, canRecord, onDone }: { observation: D; canRecord: boolean; onDone: () => Promise<void> }) {
  const [selected, setSelected] = useState(observation.candidates?.[0]?.id ?? '')
  return <div className="callout callout-warn"><div>
    <strong>Possible duplicate · {observation.description}</strong>
    <p>{observation.bank_name} · {day(observation.date)} · {usd(observation.amount_cents)}. Held for your decision; nothing posted.</p>
    {canRecord && <>
      <Field label="Existing statement line" name={`duplicate-${observation.id}`} value={selected} onChange={(e: any) => setSelected(e.target.value)} options={observation.candidates.map((l: D) => ({ value: l.id, label: `${l.posted_date} · ${l.description} · ${usd(l.amount_cents)}` }))} />
      <div className="row-actions">
        <Action run={async () => { await command('feed.duplicate-decide', { id: observation.id, revision: observation.revision, decision: 'duplicate', bankLineId: selected }); await onDone() }}>Same transaction</Action>
        <Action run={async () => { await command('feed.duplicate-decide', { id: observation.id, revision: observation.revision, decision: 'distinct' }); await onDone() }}>Keep as a separate transaction</Action>
      </div>
    </>}
  </div></div>
}

export function HistoryObservations({ history, canRecord, onDone }: { history?: D; canRecord: boolean; onDone: () => Promise<void> }) {
  if (!history) return null
  return <>
    {history.duplicates?.filter((o: D) => o.state === 'doubtful' && !o.removed_at).map((o: D) => <DuplicateDecision key={o.id + o.revision} observation={o} canRecord={canRecord} onDone={onDone} />)}
    {!!history.references?.length && <details><summary>Reference history · {history.references.length}</summary>
      <p className="hint">History before the books start, included in an opening balance or inside a locked period stays as reference. These observations never post.</p>
      <ul>{history.references.map((o: D) => <li key={o.id}><strong>{o.description}</strong>{o.removed_at && <small className="sub">Removed by the bank</small>}<p>{o.bank_name} · {day(o.date)} · {usd(o.amount_cents)} · {REFERENCE_REASON[o.reason] ?? o.reason}</p></li>)}</ul>
    </details>}
  </>
}
