import { useState } from 'react'
import { VendorHistory } from './vendor-history'
import { Action, command, Field, Form, usd, useShared, useView, type D } from './kit'

const amount = (n?: number | null) => n == null ? '' : (n / 100).toFixed(2)
export function ReceiptDraft({ r, accounts, onChange }: { r: D; accounts: D[]; onChange: () => Promise<void> }) {
  const { state } = useShared(), proposed = r.draftProposal, saved = proposed?.saved, p = saved?.payload
  const [editing, setEditing] = useState(!saved), [kind, setKind] = useState(p?.kind ?? proposed?.kind ?? 'bill')
  const [totalText, setTotalText] = useState(amount(p?.total ?? proposed?.total)), [dateText, setDateText] = useState(p?.date ?? proposed?.date ?? '')
  const offers = useView<D>(kind === 'expense' && totalText ? `receipts/candidates?${new URLSearchParams({ id: r.id, total: totalText, date: dateText, vendor: r.vendor ?? r.read_vendor ?? '' })}` : null)
  const [lines, setLines] = useState<D[]>((p?.lines ?? proposed?.lines ?? []).map((l: D) => ({ ...l, amount: amount(l.amount) })))
  if (!proposed || !r.vendor_id) return <p className="hint">Confirm the vendor to draft this document as a bill or paid expense.</p>
  const options = accounts.map(a => ({ value: a.id, label: `${a.code} · ${a.name}` }))
  const charges = (offers.data?.candidates ?? r.candidates).filter((c: D) => c.kind === 'bankline' && c.record)
  return <section aria-label="Document draft">
    <h3>{saved ? `${saved.kind === 'bill' ? 'Bill' : 'Expense'} draft · ${saved.status}` : 'Draft from this document'}</h3>
    {saved && !editing ? <>
      <p>{p.vendor} · {usd(p.total)} · {p.lines.map((l: D) => l.description).join(', ')}. Tax {usd(p.tax)}. {p.termsDays} day terms{p.kind === 'bill' ? `; due ${p.dueDate}` : ''}.{p.className ? ` Class: ${p.className}.` : ''}</p>
      <p className="hint">{saved.ownerRequired ? 'Owner approval required. ' : ''}The original document stays attached. Review its coding and vendor history before approving this revision. {p.is1099 ? '1099 vendor.' : ''}</p>
      <VendorHistory key={r.vendor_id + saved.revision} vendorId={r.vendor_id} />
      <div className="row-actions">
        <button type="button" className="btn btn-secondary" onClick={() => setEditing(true)}>Edit document draft</button>
        {saved.status === 'draft' && state.actor.can.post && <Action run={async () => { await command('capture-draft.approve', { id: saved.id, revision: saved.revision }); await onChange() }}>Approve draft</Action>}
        {saved.status === 'approved' && state.actor.can.post && <Action tone="primary" run={async () => { await command('capture-draft.post', { id: saved.id, revision: saved.revision }); await onChange() }}>Post approved draft</Action>}
      </div>
    </> : <Form label="Save document draft" className="grid-form" submit={b => command('receipt.draft-save', { ...b, id: r.id, revision: r.revision, draftRevision: saved?.revision, kind, lines })} onDone={async () => { setEditing(false); await onChange() }}>
      <Field label="Draft as" name="kind" value={kind} onChange={(e: any) => setKind(e.target.value)} options={[{ value: 'bill', label: 'Unpaid bill' }, { value: 'expense', label: 'Paid expense' }]} />
      <Field label="Document date" name="date" type="date" value={dateText} onChange={(e: any) => setDateText(e.target.value)} required />
      <Field label="Vendor invoice or receipt number" name="invoiceNumber" defaultValue={p?.reference ?? proposed.invoiceNumber} required={kind === 'bill'} />
      <Field label="Document total" name="total" value={totalText} onChange={(e: any) => setTotalText(e.target.value)} inputMode="decimal" required />
      <Field label="Purchase tax" name="tax" defaultValue={amount(p?.tax ?? proposed.tax)} inputMode="decimal" />
      <Field label="Document payment terms (days)" name="termsDays" defaultValue={p?.termsDays ?? proposed.termsDays} type="number" min={0} max={365} />
      {kind === 'bill' ? <Field label="Document due date" name="dueDate" type="date" defaultValue={p?.dueDate ?? proposed.dueDate ?? ''} /> : <Field label="Paid bank or card charge" name="bankLineId" required defaultValue={p?.bankLineId ?? ''} options={charges.map((c: D) => ({ value: c.id, label: `${c.label} · ${usd(c.amount_cents)}` }))} />}
      <Field label="Document class" name="className" defaultValue={p?.className ?? proposed.className} />
      <fieldset className="field-wide"><legend>Document lines before tax</legend>{lines.map((l, i) => <div className="grid-form" key={i}>
        <Field label={`Description ${i + 1}`} name={`description-${i}`} value={l.description} required onChange={(e: any) => setLines(ls => ls.map((x, j) => j === i ? { ...x, description: e.target.value } : x))} />
        <Field label={`Account ${i + 1}`} name={`account-${i}`} options={options} value={l.accountId ?? ''} required onChange={(e: any) => setLines(ls => ls.map((x, j) => j === i ? { ...x, accountId: e.target.value } : x))} />
        <Field label={`Amount ${i + 1}`} name={`amount-${i}`} value={l.amount} inputMode="decimal" required onChange={(e: any) => setLines(ls => ls.map((x, j) => j === i ? { ...x, amount: e.target.value } : x))} />
        {lines.length > 1 && <button className="btn btn-link" type="button" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove line {i + 1}</button>}
      </div>)}<button className="btn btn-secondary" type="button" onClick={() => setLines(ls => [...ls, { description: '', accountId: r.account_id, amount: '' }])}>Add document line</button></fieldset>
    </Form>}
  </section>
}
