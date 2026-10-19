// Bank rules: the list, and an editor that previews exactly which open lines a
// rule would file before it is saved (and which it may not touch, and why).
import { useState } from 'react'
import { Action, Card, command, Field, accountOptions, day, usd, useShared, type D } from './kit'
import { Suggestions } from './bank-lines'

export type Draft = { id?: string; revision?: string; name: string; priority: string; mode: string; descriptionMode: string; splitMode: string; bankAccountId: string; direction: string; payee: string; descriptionContains: string; amountMin: string; amountMax: string; splits: { accountId: string; percent: string; amount: string }[]; contactId: string; taxCodeId: string; memo: string }
const blank: Draft = { name: '', priority: '', mode: 'automatic', descriptionMode: 'contains', splitMode: 'percent', bankAccountId: '', direction: 'out', payee: '', descriptionContains: '', amountMin: '', amountMax: '', splits: [{ accountId: '', percent: '100', amount: '' }], contactId: '', taxCodeId: '', memo: '' }
const money = (c?: number | null) => c ? (c / 100).toFixed(2) : ''

export const fromSuggestion = (s: D): Draft => ({ ...blank, name: s.payee, payee: s.payee, direction: s.direction, splits: [{ accountId: s.accountId, percent: '100', amount: '' }] })
const fromRule = (r: D): Draft => ({ id: r.id, revision: r.revision, name: r.name, priority: String(r.priority), mode: r.mode, descriptionMode: r.description_mode, splitMode: r.split_mode, bankAccountId: r.bank_account_id ?? '', direction: r.direction, payee: r.payee, descriptionContains: r.description_contains, amountMin: money(r.amount_min_cents), amountMax: money(r.amount_max_cents),
  splits: r.splits.map((s: D) => ({ accountId: s.accountId, percent: s.share ? String(s.share / 100) : '', amount: money(s.amountCents) })), contactId: r.contact_id ?? '', taxCodeId: r.tax_code_id ?? '', memo: r.memo })

function when(r: D, banks: D[]) {
  const parts = [r.direction === 'out' ? 'Money out' : r.direction === 'in' ? 'Money in' : 'Any line']
  if (r.bank_account_id) parts.push(`from ${banks.find(b => b.id === r.bank_account_id)?.name ?? 'one account'}`)
  if (r.payee) parts.push(`payee ${r.payee}`)
  if (r.description_contains) parts.push(`description ${r.description_mode === 'equals' ? 'equals' : 'contains'} “${r.description_contains}”`)
  if (r.amount_min_cents || r.amount_max_cents) parts.push(r.amount_min_cents && r.amount_max_cents ? `${usd(r.amount_min_cents)}–${usd(r.amount_max_cents)}` : r.amount_min_cents ? `${usd(r.amount_min_cents)} or more` : `up to ${usd(r.amount_max_cents)}`)
  return parts.join(', ')
}

function fileAs(r: D, state: D) {
  const name = (id: string) => state.accounts.find((a: D) => a.id === id)?.name ?? '—'
  const split = r.splits.length === 1 ? name(r.splits[0].accountId) : r.splits.map((s: D) => `${r.split_mode === 'amount' ? usd(s.amountCents) : `${s.share / 100}%`} ${name(s.accountId)}`).join(' · ')
  const extra = [r.contact_id && state.contacts.find((c: D) => c.id === r.contact_id)?.name, r.tax_code_id && `tax ${state.taxCodes.find((t: D) => t.id === r.tax_code_id)?.name ?? ''}`, r.memo && `“${r.memo}”`].filter(Boolean)
  return <>{split}{extra.length > 0 && <small className="sub"> · {extra.join(' · ')}</small>}</>
}

function Editor({ start, onClose, onDone }: { start: Draft; onClose: () => void; onDone: () => Promise<void> }) {
  const { state } = useShared()
  const [d, setD] = useState<Draft>(start), [preview, setPreview] = useState<D | null>(null), [fileNow, setFileNow] = useState(true), [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const set = (patch: Partial<Draft>) => { setD(x => ({ ...x, ...patch })); setPreview(null) }
  const setSplit = (k: number, patch: Partial<Draft['splits'][number]>) => set({ splits: d.splits.map((s, j) => j === k ? { ...s, ...patch } : s) })
  const categories = accountOptions(state.accounts, a => !['bank', 'receivable', 'payable'].includes(a.subtype))
  const body = () => ({ ...d, splits: d.splits.map(s => d.splitMode === 'amount' ? { accountId: s.accountId, amount: s.amount } : { accountId: s.accountId, percent: d.splits.length === 1 ? '100' : s.percent }) })
  const act = async (work: () => Promise<void>) => { setBusy(true); setError(''); try { await work() } catch (e) { setError((e as Error).message) } finally { setBusy(false) } }
  const field = (k: keyof Draft) => ({ value: d[k] as string, onChange: (e: any) => set({ [k]: e.target.value } as Partial<Draft>) })
  return <Card title={d.id ? `Edit rule · ${start.name}` : 'New rule'} className="rule-editor">
    <form className="form" onSubmit={e => { e.preventDefault(); void act(async () => setPreview(await command('bank-rule.preview', body()))) }}>
      <h3>When a line…</h3>
      <div className="grid-form">
        <Field label="Money" name="direction" {...field('direction')} options={[{ value: 'out', label: 'Goes out' }, { value: 'in', label: 'Comes in' }, { value: 'any', label: 'Either way' }]} />
        <Field label="Bank or card" name="bankAccountId" empty="Every account" {...field('bankAccountId')} options={state.bankAccounts.map((b: D) => ({ value: b.id, label: b.name }))} />
        <Field label="Payee" name="payee" {...field('payee')} hint="Matches whole words, like Adobe" />
        <Field label="Description match" name="descriptionMode" {...field('descriptionMode')} options={[{ value: 'contains', label: 'Contains' }, { value: 'equals', label: 'Equals' }]} />
        <Field label="Description text" name="descriptionContains" {...field('descriptionContains')} />
        <Field label="Amount from" name="amountMin" inputMode="decimal" {...field('amountMin')} />
        <Field label="Amount up to" name="amountMax" inputMode="decimal" {...field('amountMax')} />
      </div>
      <h3>…file it as</h3>
      <div className="grid-form">
        <Field label="Mode" name="mode" {...field('mode')} options={[{ value: 'automatic', label: 'Add automatically' }, { value: 'suggest', label: 'Suggest only' }]} />
        <Field label="Priority" name="priority" inputMode="numeric" {...field('priority')} hint="Lower numbers run first. Blank puts a new rule last." />
        <Field label="Split by" name="splitMode" {...field('splitMode')} options={[{ value: 'percent', label: 'Percentage' }, { value: 'amount', label: 'Amount' }]} hint="Amounts must add up to the statement line, including tax." />
        {d.splits.map((s, k) => <div className="split-row field-wide" key={k}>
          <Field label={d.splits.length > 1 ? `Category ${k + 1}` : 'Category'} name={`split-${k}`} required value={s.accountId} onChange={(e: any) => setSplit(k, { accountId: e.target.value })} options={categories} />
          {(d.splits.length > 1 || d.splitMode === 'amount') && <Field label={d.splitMode === 'amount' ? 'Amount' : 'Percent'} name={`split-value-${k}`} inputMode="decimal" value={d.splitMode === 'amount' ? s.amount : s.percent} onChange={(e: any) => setSplit(k, d.splitMode === 'amount' ? { amount: e.target.value } : { percent: e.target.value })} />}
          {d.splits.length > 1 && <><button type="button" className="btn btn-link" onClick={() => set({ splits: d.splits.filter((_, j) => j !== k) })}>Remove</button></>}
        </div>)}
        <div className="field-wide"><button type="button" className="btn btn-link" onClick={() => set({ splits: d.splits.length === 1 ? [{ ...d.splits[0], percent: '50' }, { accountId: '', percent: '50', amount: '' }] : [...d.splits, { accountId: '', percent: '', amount: '' }] })}>+ Split across categories</button></div>
        <Field label="Vendor or customer" name="contactId" empty="None" {...field('contactId')} options={state.contacts.filter((c: D) => c.active).map((c: D) => ({ value: c.id, label: c.name }))} />
        <Field label="Tax code" name="taxCodeId" empty="No tax code" {...field('taxCodeId')} options={state.taxCodes.map((t: D) => ({ value: t.id, label: `${t.name} (${t.rate_milli_percent / 1000}%)` }))} hint="Its share of the line goes to the tax account" />
        <Field label="Memo" name="memo" {...field('memo')} />
        <Field label="Rule name" name="name" required {...field('name')} />
      </div>
      <div className="form-end"><button className="btn btn-secondary" disabled={busy}>{busy && !preview ? 'Working…' : 'Preview'}</button><button type="button" className="btn btn-link" onClick={onClose}>Cancel</button>{error && <p role="alert" className="error">{error}</p>}</div>
    </form>
    {preview && <div className="rule-preview" aria-live="polite">
      <p><strong>{d.mode === 'suggest' && preview.suggested.length ? `This rule suggests ${preview.suggested.length} open line${preview.suggested.length === 1 ? '' : 's'} for a person to file` : preview.count ? `This rule would file ${preview.count} line${preview.count === 1 ? '' : 's'} now` : 'No open line can be filed by this rule now'}</strong>{preview.count > 0 && <> · {usd(preview.total)}</>}</p>
      {preview.files.length > 0 && <ul className="preview-lines">{preview.files.map((l: D) => <li key={l.id}><span>{day(l.posted_date)} {l.description}</span><strong>{usd(l.amount_cents)}</strong></li>)}</ul>}
      {[...preview.held, ...preview.preceded, ...preview.suggested].length > 0 && <><p className="hint">Matches it will leave alone:</p><ul className="preview-lines held">{[...preview.held, ...preview.preceded, ...preview.suggested].map((l: D) => <li key={l.id}><span>{day(l.posted_date)} {l.description} <small className="sub">({l.reason})</small></span><strong>{usd(l.amount_cents)}</strong></li>)}</ul></>}
      {preview.earlier.length > 0 && <><p className="hint">Last six matching charges, including previously filed lines:</p><ul className="preview-lines">{preview.earlier.map((l: D) => <li key={l.id}><span>{day(l.posted_date)} {l.description}</span><strong>{usd(l.amount_cents)}</strong></li>)}</ul></>}
      {preview.count > 0 && <label className="check"><input type="checkbox" checked={fileNow} onChange={e => setFileNow(e.target.checked)} /> {preview.count === 1 ? 'File this line' : `File these ${preview.count} lines`} when I save</label>}
      <div className="form-end"><button type="button" className="btn btn-primary" disabled={busy} onClick={() => void act(async () => { await command('bank-rule.save', { ...body(), fileExisting: preview.count > 0 && fileNow }); await onDone(); onClose() })}>{busy ? 'Working…' : 'Save rule'}</button></div>
    </div>}
  </Card>
}

export function Rules({ data, draft, setDraft, onDone }: { data: D | undefined; draft: Draft | null; setDraft: (d: Draft | null) => void; onDone: () => Promise<void> }) {
  const { state } = useShared(), can = state.actor.can.record
  if (!data) return null
  return <div className="stack">
    {!draft && <Suggestions items={data.suggestions} onPick={s => setDraft(fromSuggestion(s))} />}
    {draft && <Editor key={draft.id ?? draft.name} start={draft} onClose={() => setDraft(null)} onDone={onDone} />}
    {data.suggestedLines?.length > 0 && <Card title="Suggested by your rules"><ul className="preview-lines">{data.suggestedLines.map((l: D) => <li key={l.id}><span>{day(l.posted_date)} {l.description}<small className="sub"> · {l.ruleName} · {l.reason}</small><small className="sub"> · {fileAs(data.rules.find((r: D) => r.id === l.ruleId), state)}</small></span><strong>{usd(l.amount_cents)}</strong></li>)}</ul></Card>}
    <Card title="Bank rules" actions={can && !draft && <button type="button" className="btn btn-primary btn-small" onClick={() => setDraft(blank)}>New rule</button>}>
      <p className="hint">Rules file routine lines as they arrive, from a feed or a statement file. A line filed by a rule says so and can be undone. Rules never touch a locked month or a reconciled statement.</p>
      <div className="table-wrap"><table className="ledger"><thead><tr><th>Rule</th><th>When</th><th>Files as</th><th className="fig">Filed</th><th><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{data.rules.length ? data.rules.map((r: D) => <tr key={r.id}>
          <td data-label="Rule"><strong>{r.name}</strong><small className="sub"> · Priority {r.priority} · {r.mode === 'suggest' ? 'Suggest only' : 'Add automatically'}</small></td><td data-label="When">{when(r, state.bankAccounts)}</td><td data-label="Files as">{fileAs(r, state)}</td>
          <td data-label="Filed" className="fig">{r.filed}</td>
          <td data-label="Actions">{can && <div className="row-actions"><button type="button" className="btn btn-secondary btn-small" onClick={() => setDraft(fromRule(r))}>Edit</button>
            <Action tone="danger" run={async () => { if (window.confirm(`Retire the rule ${r.name}? Lines it filed stay filed.`)) { await command('bank-rule.retire', { id: r.id, revision: r.revision }); await onDone() } }}>Retire</Action></div>}</td>
        </tr>) : <tr className="empty"><td colSpan={5}>No rules yet. File a payee the same way a few times and Pantry suggests one.</td></tr>}</tbody></table></div>
    </Card>
  </div>
}
