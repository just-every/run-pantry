import { DimensionFields } from './dimensions'
// A journal entry draft: one debit or credit per line, with the balance check
// shown as the person types. The server decides; this only helps.
import { useState } from 'react'
import { accountOptions, command, Field, today, usd, useShared, type D } from './kit'

type Line = { accountId: string; debit: string; credit: string; memo: string;className?:string;locationName?:string;projectName?:string }
const blank = (): Line => ({ accountId: '', debit: '', credit: '', memo: '' })
const toCents = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim()) ? Math.round(Number(v.replace(/,/g, '')) * 100) : 0

export function JournalEditor({ entry, onDone }: { entry?: D; onDone: (saved: D) => void | Promise<void> }) {
  const { state } = useShared()
  const [lines, setLines] = useState<Line[]>(entry ? entry.lines.map((l: D) => ({ accountId: l.account_id, debit: l.debit_cents ? (l.debit_cents / 100).toFixed(2) : '', credit: l.credit_cents ? (l.credit_cents / 100).toFixed(2) : '', memo: l.memo,className:l.class_name,locationName:l.location_name,projectName:l.project_name })) : [blank(), blank()])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const debit = lines.reduce((s, l) => s + toCents(l.debit), 0), credit = lines.reduce((s, l) => s + toCents(l.credit), 0)
  const options = accountOptions(state.accounts, a => !['receivable', 'payable'].includes(a.subtype))
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  return <form className="form" onSubmit={async e => {
    e.preventDefault(); const f = new FormData(e.currentTarget)
    setBusy(true); setError('')
    try { await onDone(await command('journal.save-draft', { id: entry?.id, revision: entry?.revision, date: f.get('date'), memo: f.get('memo'), adjusting: f.get('adjusting') === 'on', lines })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="grid-form">
      <Field label="Entry date" name="date" type="date" defaultValue={entry?.entry_date ?? today()} required />
      <Field label="Description" name="memo" defaultValue={entry?.memo} required wide />
    </div>
    <label><input type="checkbox" name="adjusting" defaultChecked={Boolean(entry?.adjusting)} /> Adjusting entry (fiscal year end)</label>
    <div className="table-wrap"><table className="ledger lines-editor"><thead><tr><th>#</th><th>Account</th><th>Line memo</th><th className="fig">Debit</th><th className="fig">Credit</th><th /></tr></thead>
      <tbody>{lines.map((l, i) => <tr key={i}>
        <td data-label="#">{i + 1}</td>
        <td data-label="Account"><select aria-label={`Line ${i + 1} account`} value={l.accountId} onChange={e => set(i, { accountId: e.target.value })} required><option value="">Choose…</option>{options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
        <td data-label="Line memo"><input aria-label={`Line ${i + 1} memo`} value={l.memo} onChange={e => set(i, { memo: e.target.value })} /><DimensionFields line={l} index={i} onChange={patch=>set(i,patch)} /></td>
        <td data-label="Debit"><input aria-label={`Line ${i + 1} debit`} inputMode="decimal" className="fig" value={l.debit} onChange={e => set(i, { debit: e.target.value, credit: e.target.value ? '' : l.credit })} /></td>
        <td data-label="Credit"><input aria-label={`Line ${i + 1} credit`} inputMode="decimal" className="fig" value={l.credit} onChange={e => set(i, { credit: e.target.value, debit: e.target.value ? '' : l.debit })} /></td>
        <td>{lines.length > 2 && <button type="button" className="btn btn-link" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
      </tr>)}</tbody></table></div>
    <div className="balance-check"><button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, blank()])}>Add line</button>
      <strong className={debit === credit && debit > 0 ? 'tone-good' : 'tone-bad'}>Debits {usd(debit)} {debit === credit ? '=' : '≠'} Credits {usd(credit)}</strong></div>
    <div className="form-end"><button className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button>{error && <p role="alert" className="error">{error}</p>}</div>
  </form>
}
