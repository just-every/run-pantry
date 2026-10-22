import { useState } from 'react'
import { accountOptions, Card, command, contactOptions, Field, Loading, today, usd, useShared, useView, type D } from './kit'
import { addDays, blank, ServiceLines, type Line } from './invoice-editor'
import { EstimateDeliveryLines, EstimateEconomics } from './estimate-economics'

export function EstimateDocumentPreview({ estimateId, revision }: { estimateId: string; revision: string }) {
  const path = `estimates/${encodeURIComponent(estimateId)}`
  const { data, error } = useView<D>(`${path}/preview?revision=${encodeURIComponent(revision)}`)
  if (!data) return <Card title="Estimate document"><Loading error={error} what="estimate preview" /></Card>
  const doc = data.document
  return <Card title={data.basis === 'sent' ? 'Retained sent estimate' : 'Estimate document preview'}>
    <p><strong>{doc.title}</strong> · {doc.templateName}</p>
    <dl className="facts">{doc.facts.map(([label, value]: string[], i: number) => <div key={i}><dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value || '—'}</dd></div>)}</dl>
    {doc.notes.map((note: string, i: number) => <p key={i} style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{note}</p>)}
    <p className="hint" style={{ overflowWrap: 'anywhere' }}>{data.basis === 'sent' ? 'The email attachment and customer PDF use this retained document.' : 'Save changes to update the preview before sending.'}<br />Revision: {data.issuedRevision ?? revision}<br />PDF SHA-256: {data.sha256}</p>
    <p><a href={`/api/pantry/${path}/pdf`} target="_blank" rel="noreferrer">Open estimate PDF</a></p>
    <iframe title="Estimate document preview" src={`/api/pantry/${path}/pdf?revision=${encodeURIComponent(revision)}`} style={{ width: '100%', height: 520, border: 0 }} />
  </Card>
}

export function EstimateEditor({ estimate, onDone, onCancel }: { estimate?: D; onDone: (saved: D) => Promise<void>; onCancel: () => void }) {
  const { state } = useShared(), { data: documents, error: documentError } = useView<D>('invoice-documents')
  const input: D = estimate?.input ?? {}, initialLines: D[] = (input.lines ?? []).map((l: D, i: number) => {
    const saved = estimate?.lines[i]
    return { ...l, description: l.description ?? saved?.description ?? '', quantity: String(l.quantity ?? (saved ? saved.quantity_milli / 1000 : 1)), rate: String(l.rate ?? (saved ? saved.unit_cents / 100 : '')), accountId: l.accountId ?? saved?.accountId ?? '', taxCode: l.taxCode ?? saved?.chosenTaxCode ?? '' }
  })
  const lineOrder = initialLines.map((l, i) => ({ l, number: i + 1 })).sort((a, b) => Number(a.l.kind === 'delivery') - Number(b.l.kind === 'delivery'))
  const [lines, setLines] = useState<Line[]>(initialLines.filter(l => l.kind !== 'delivery').length ? initialLines.filter(l => l.kind !== 'delivery') as Line[] : [blank(accountOptions(state.accounts, a => a.type === 'income')[0]?.value)])
  const [delivery, setDelivery] = useState<D[]>(initialLines.filter(l => l.kind === 'delivery'))
  const [customer, setCustomer] = useState(input.customerId ?? ''), [issue, setIssue] = useState(input.issueDate ?? today()), [due, setDue] = useState<string | null>(input.dueDate ?? null)
  const [templateId, setTemplateId] = useState(input.templateId ?? ''), [customFields, setCustomFields] = useState<D>(input.customFields ?? {})
  const [discounts, setDiscounts] = useState<D[]>((input.discounts ?? []).map((d: D) => ({ ...d, lines: Array.isArray(d.lines) ? d.lines.map((n: number) => lineOrder.findIndex(entry => entry.number === n) + 1) : null }))), [deposit, setDeposit] = useState<D | null>(input.deposit ?? null), [early, setEarly] = useState<D | null>(input.earlyPayment ?? null)
  const [busy, setBusy] = useState(false), [error, setError] = useState('')
  const contact = state.contacts.find((c: D) => c.id === customer)
  const effectiveTemplateId = templateId || contact?.invoice_template_id || documents?.settings.default_template_id
  const template = documents?.templates.find((t: D) => t.id === effectiveTemplateId)
  const days = contact?.invoice_terms_override ? contact.terms_days : template?.termsDays
  const dueShown = due ?? (days !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(issue) ? addDays(issue, Number(days)) : '')
  const remapDiscounts = (before: D[], after: D[]) => setDiscounts(ds => ds.map(d => ({ ...d, lines: Array.isArray(d.lines) ? d.lines.map((n: number) => {
    const previous = before[Number(n) - 1], next = after.indexOf(previous)
    return next < 0 ? null : next + 1
  }).filter((n: number | null) => n !== null) : null })))
  const changeItems = (update: (ls: Line[]) => Line[]) => {
    const next = update(lines)
    if (next.length !== lines.length) remapDiscounts([...lines, ...delivery], [...next, ...delivery])
    setLines(next)
  }
  const changeDelivery = (next: D[]) => {
    if (next.length !== delivery.length) remapDiscounts([...lines, ...delivery], [...lines, ...next])
    setDelivery(next)
  }
  return <form className="invoice-editor" onSubmit={async e => {
    e.preventDefault(); const fields = Object.fromEntries(new FormData(e.currentTarget)); setBusy(true); setError('')
    try {
      const saved = await command('estimate.save-draft', { id: estimate?.id, revision: estimate?.revision, customerId: customer, number: fields.number, issueDate: issue, dueDate: dueShown,
        validUntil: fields.validUntil, destinationState: fields.destinationState, templateId: effectiveTemplateId, customFields: Object.fromEntries((template?.fields ?? []).map((f: D) => [f.key, customFields[f.key] ?? f.defaultValue])),
        lines: [...lines, ...delivery], discounts: discounts.map(d => ({ ...d, ...(Array.isArray(d.lines) ? { lines: d.lines.map(Number) } : {}) })), deposit, earlyPayment: early, memo: fields.memo })
      await onDone(saved)
    } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="split split-wide-left"><div className="stack">
      <Card title={estimate ? `Edit ${estimate.number}` : 'New estimate'}>
        {estimate?.status === 'sent' && <p className="callout callout-warn">Saving changes withdraws the sent acceptance link. Review and send the new revision for acceptance.</p>}
        <div className="grid-form">
          <Field label="Customer" name="customerId" value={customer} onChange={(e: any) => { setCustomer(e.target.value); setTemplateId(''); setCustomFields({}) }} options={contactOptions(state.contacts, 'customer')} required />
          <Field label="Estimate number" name="number" defaultValue={estimate?.number ?? ''} hint="Leave blank for the next estimate number." />
          <Field label="Estimate date" name="issueDate" type="date" value={issue} onChange={(e: any) => setIssue(e.target.value)} required />
          <Field label="Valid until" name="validUntil" type="date" defaultValue={input.validUntil ?? ''} min={issue} hint="Optional. Acceptance ends after this date in the business time zone saved with this revision." />
          <Field label="Invoice due date" name="dueDate" type="date" value={dueShown} onChange={(e: any) => setDue(e.target.value)} hint="Initial terms for conversion; review the invoice dates when billing." required />
          <Field label="Ship-to / destination state" name="destinationState" defaultValue={input.destinationState ?? ''} maxLength={2} hint="Two-letter US state code for customer exemption treatment." />
        </div>
      </Card>
      <Card title="Estimate presentation">
        {!documents ? <Loading error={documentError} what="document templates" /> : <>
          <Field label="Estimate template" name="templateId" value={effectiveTemplateId ?? ''} onChange={(e: any) => { setTemplateId(e.target.value); setCustomFields({}) }} required options={documents.templates.map((t: D) => ({ value: t.id, label: t.name }))} />
          {(template?.fields ?? []).map((f: D) => <Field key={f.key} label={f.label} name={`custom-${f.key}`} value={customFields[f.key] ?? f.defaultValue} onChange={(e: any) => setCustomFields(v => ({ ...v, [f.key]: e.target.value }))} />)}
          <p className="hint">Uses the business's invoice document templates and the customer's default. The sent revision retains its presentation and PDF.</p>
        </>}
      </Card>
      <ServiceLines lines={lines} setLines={changeItems} />
      <EstimateDeliveryLines lines={delivery} setLines={changeDelivery} itemCount={lines.length} />
      <EstimateEconomics discounts={discounts} setDiscounts={setDiscounts} deposit={deposit} setDeposit={setDeposit} early={early} setEarly={setEarly} />
      <Card title="Memo"><Field label="Memo on the estimate" name="memo" type="textarea" defaultValue={input.memo ?? ''} wide /></Card>
    </div><div className="stack"><Card title="Review estimate">
      {estimate && <p>Last saved total: <strong>{usd(estimate.total_cents)}</strong>.</p>}
      <p>Save the draft, then review its calculated discounts, sales tax and document before sending this revision to the customer.</p>
      <div className="form-end column"><button className="btn btn-primary btn-block" disabled={busy || !documents}>{busy ? 'Saving…' : 'Save estimate draft'}</button><button type="button" className="btn btn-secondary btn-block" onClick={onCancel} disabled={busy}>Cancel</button>{error && <p role="alert" className="error">{error}</p>}</div>
    </Card></div></div>
  </form>
}
