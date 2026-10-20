// Invoice and credit drafts, and the service lines recurring invoices share. A
// line without a tax code is shown as needing a decision; approval is refused
// until every line has one.
import { useState } from 'react'
import { InvoiceDocumentPreview } from './invoice-templates'
import { accountOptions, Card, command, contactOptions, Field, today, usd, useShared, useView, type D } from './kit'

export type Line = { description: string; quantity: string; rate: string; accountId: string; taxCode: string; itemId?: string }
export const blank = (accountId = ''): Line => ({ description: '', quantity: '1', rate: '', accountId, taxCode: '' })
export const cents = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim()) ? Math.round(Number(v.replace(/,/g, '')) * 100) : 0
export const qty = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) ? Number(v) : 0

/** The day `days` after a YYYY-MM-DD date, on the calendar. */
export function addDays(day: string, days: number) {
  const [y, m, d] = day.split('-').map(Number), t = new Date(Date.UTC(y, m - 1, d + days))
  return t.toISOString().slice(0, 10)
}

/** The number the next invoice or credit takes, as the server gives it when the field is left blank. */
export function nextNumber(invoices: D[], kind: 'invoice' | 'credit') {
  const prefix = kind === 'invoice' ? 'INV-' : 'CR-'
  const n = invoices.map(i => String(i.number ?? '')).filter(x => x.startsWith(prefix)).map(x => Number(x.slice(prefix.length))).filter(Number.isInteger).reduce((m, x) => Math.max(m, x), 0)
  return prefix + String(n + 1).padStart(4, '0')
}

export function InvoiceEditor({ invoice, creditFor, invoices = [], onDone, onCancel }: { invoice?: D; creditFor?: D; invoices?: D[]; onDone: (saved: D) => void; onCancel: () => void }) {
  const { state } = useShared()
  const { data: documents } = useView<D>('invoice-documents')
  const [templateId, setTemplateId] = useState(invoice?.document_template_id ?? ''), [customFields, setCustomFields] = useState<D>(JSON.parse(invoice?.document_values ?? '{}'))
  const income = accountOptions(state.accounts, a => a.type === 'income')
  const source = invoice ?? creditFor
  const [lines, setLines] = useState<Line[]>(source?.lines?.length ? source.lines.map((l: D) => ({ ...(l.item_id ? { itemId: l.item_id } : {}), description: l.description, quantity: String(l.quantity_milli / 1000), rate: (l.unit_cents / 100).toFixed(2), accountId: l.account_id, taxCode: creditFor ? l.tax_code ?? '' : ('chosen_tax_code' in l ? l.chosen_tax_code : l.tax_code) ?? '' })) : [blank(income[0]?.value)])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const kind = creditFor || invoice?.kind === 'credit' ? 'credit' : 'invoice'
  // The due date follows the customer's terms from the issue date until the person types one.
  const [customer, setCustomer] = useState<string>(source?.customer_id ?? ''), [issue, setIssue] = useState<string>(invoice?.issue_date ?? today())
  const [destination, setDestination] = useState<string>(source?.destination_state ?? '')
  const { data: exemptions } = useView<D>('exemptions')
  const certificate = kind === 'invoice' && destination ? exemptions?.certificates.filter((e: D) => e.active && e.customer_id === customer && e.states.includes(destination.toUpperCase()) && e.valid_from <= issue && e.valid_from <= exemptions.today && e.expires_on >= issue && e.expires_on >= exemptions.today).sort((a: D, b: D) => b.expires_on.localeCompare(a.expires_on))[0] : null
  const effectiveLines = certificate ? lines.map(l => ({ ...l, taxCode: 'exempt' })) : lines
  const { tax, subtotal, missing } = lineTotals(effectiveLines, state.taxCodes)
  const [due, setDue] = useState<string | null>(invoice?.due_date ?? null)
  const contact = state.contacts.find((c: D) => c.id === customer)
  const effectiveTemplateId = templateId || contact?.invoice_template_id || documents?.settings.default_template_id
  const template = documents?.templates.find((t: D) => t.id === effectiveTemplateId)
  const terms = contact?.invoice_terms_override ? contact.terms_days : template?.termsDays
  const dueShown = due ?? (customer && terms !== undefined && /^\d{4}-\d{2}-\d{2}$/.test(issue) ? addDays(issue, Number(terms)) : '')
  return <form className="invoice-editor" onSubmit={async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true); setError('')
    try { onDone(await command('invoice.save-draft', { ...f, kind, creditFor: creditFor?.id ?? invoice?.credit_for, id: invoice?.id, revision: invoice?.revision, templateId: effectiveTemplateId, customFields: Object.fromEntries((template?.fields ?? []).map((f: D) => [f.key, customFields[f.key] ?? f.defaultValue])), lines })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="split split-wide-left">
      <div className="stack">
        <Card title={kind === 'credit' ? `Credit for ${creditFor?.number ?? ''}` : 'Invoice details'}>
          <div className="grid-form">
            <Field label="Customer" name="customerId" value={customer} onChange={(e: any) => { setCustomer(e.target.value); setTemplateId(''); setCustomFields({}) }} required options={contactOptions(state.contacts, 'customer')} />
            <Field label={kind === 'credit' ? 'Credit number' : 'Invoice number'} name="number" key={invoice?.id ?? (kind === 'invoice' ? documents?.nextNumber : 'credit')} defaultValue={invoice?.number ?? (kind === 'invoice' ? documents?.nextNumber ?? '' : nextNumber(invoices, kind))} required hint={invoice ? undefined : 'The next number in sequence; change it if you need to'} />
            <Field label="Ship-to / destination state" name="destinationState" value={destination} onChange={(e: any) => setDestination(e.target.value.toUpperCase())} maxLength={2} hint="Two-letter US state code. Required to apply a customer exemption certificate." />
            <Field label="Issue date" name="issueDate" type="date" value={issue} onChange={(e: any) => setIssue(e.target.value)} required />
            <Field label="Due date" name="dueDate" type="date" value={dueShown} onChange={(e: any) => setDue(e.target.value)} hint={due === null && customer && terms !== undefined ? `${terms} days after the issue date` : undefined} />
          </div>
        </Card>
        <Card title="Invoice presentation">
          <Field label="Invoice template" name="templateId" value={effectiveTemplateId ?? ''} onChange={(e: any) => { setTemplateId(e.target.value); setCustomFields({}) }} required options={(documents?.templates ?? []).map((t: D) => ({ value: t.id, label: t.name }))} />
          {(template?.fields ?? []).map((f: D) => <Field key={f.key} label={f.label} name={`custom-${f.key}`} value={customFields[f.key] ?? f.defaultValue} onChange={(e: any) => setCustomFields(v => ({ ...v, [f.key]: e.target.value }))} />)}
          <p className="hint">The selected template is saved with this draft. Preview the saved draft before approval.</p>
        </Card>
        {invoice?.id && <InvoiceDocumentPreview invoiceId={invoice.id} />}
        {certificate && <div className="callout" role="status"><strong>Certificate {certificate.certificate_number} applies in {destination}</strong><span>Exempt through {certificate.expires_on}. <a href={`/api/pantry/documents/${certificate.document_id}`}>View certificate</a>. Your line tax choices below are kept for when the certificate no longer applies.</span></div>}
        {invoice?.exemption && !certificate && <div className="callout callout-warn" role="status"><strong>Review tax treatment</strong><span>The earlier certificate no longer applies to these details. Saving uses your original line tax choices.</span></div>}
        <ServiceLines lines={lines} setLines={setLines} />
        <Card title="Memo"><Field label="Memo on the invoice" name="memo" type="textarea" defaultValue={invoice?.memo} wide /></Card>
      </div>
      <Card title={kind === 'credit' ? 'Credit summary' : 'Invoice summary'}>
        <dl className="summary"><div><dt>Subtotal</dt><dd>{usd(subtotal)}</dd></div><div><dt>Sales tax</dt><dd>{usd(tax)}</dd></div><div className="total"><dt>Total</dt><dd>{usd(subtotal + tax)}</dd></div></dl>
        {missing > 0 && <div className="callout callout-warn" role="status"><strong>Tax treatment needed before approval</strong><span>{missing} line{missing === 1 ? ' is' : 's are'} missing a sales tax code. Choose a code or mark the line exempt.</span></div>}
        <div className="form-end column"><button className="btn btn-primary btn-block" disabled={busy || !documents}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>{error && <p role="alert" className="error">{error}</p>}</div>
      </Card>
    </div>
  </form>
}

/** Totals as the server computes them: quantity × rate, tax rounded per line. */
export function lineTotals(lines: Line[], taxCodes: D[]) {
  const rate = (code: string) => code && code !== 'exempt' ? taxCodes.find(t => t.id === code)?.rate_milli_percent ?? 0 : 0
  const amounts = lines.map(l => Math.round(qty(l.quantity) * cents(l.rate)))
  const tax = lines.reduce((s, l, i) => s + Math.round(amounts[i] * rate(l.taxCode) / 100000), 0), subtotal = amounts.reduce((s, a) => s + a, 0)
  return { amounts, tax, subtotal, missing: lines.filter(l => !l.taxCode).length }
}

/** The service lines table, shared by invoices and recurring invoices. */
export function ServiceLines({ lines, setLines }: { lines: Line[]; setLines: (f: (ls: Line[]) => Line[]) => void }) {
  const { state } = useShared()
  const income = accountOptions(state.accounts, a => a.type === 'income')
  const { amounts } = lineTotals(lines, state.taxCodes)
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const items: D[] = state.items ?? []
  // Choosing a product or service fills the line from it (ITEM-001); its income account then stays the item's.
  const pick = (i: number, id: string) => {
    const it = items.find(x => x.id === id)
    set(i, it ? { itemId: it.id, description: it.description || it.name, rate: (it.rate_cents / 100).toFixed(2), accountId: it.income_account_id, taxCode: it.tax_category === 'non-taxable' ? 'exempt' : it.tax_code ?? '' } : { itemId: undefined })
  }
  return <Card title="Service lines" actions={<button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, blank(income[0]?.value)])}>Add line</button>}>
    <div className="table-wrap"><table className="ledger lines-editor"><thead><tr><th>#</th><th>Item and description</th><th className="fig">Quantity</th><th className="fig">Rate</th><th className="fig">Amount</th><th>Income account</th><th>Sales tax code</th><th /></tr></thead>
      <tbody>{lines.map((l, i) => <tr key={i}>
        <td data-label="#">{i + 1}</td>
        <td data-label="Item and description"><div className="stack" style={{ gap: 6 }}><select aria-label={`Line ${i + 1} product or service`} value={l.itemId ?? ''} onChange={e => pick(i, e.target.value)}><option value="">No item</option>{items.filter(it => it.active || it.id === l.itemId).map(it => <option key={it.id} value={it.id}>{it.name}{it.sku ? ` · ${it.sku}` : ''}{it.active ? '' : ' (inactive)'}</option>)}</select><input aria-label={`Line ${i + 1} description`} value={l.description} onChange={e => set(i, { description: e.target.value })} required /></div></td>
        <td data-label="Quantity"><input aria-label={`Line ${i + 1} quantity`} className="fig narrow" inputMode="decimal" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} required /></td>
        <td data-label="Rate"><input aria-label={`Line ${i + 1} rate`} className="fig narrow" inputMode="decimal" value={l.rate} onChange={e => set(i, { rate: e.target.value })} required /></td>
        <td data-label="Amount" className="fig">{usd(amounts[i])}</td>
        <td data-label="Income account"><select aria-label={`Line ${i + 1} income account`} disabled={!!l.itemId} value={l.accountId} onChange={e => set(i, { accountId: e.target.value })} required><option value="">Choose…</option>{income.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
        <td data-label="Sales tax code"><select aria-label={`Line ${i + 1} sales tax code`} disabled={items.find(it => it.id === l.itemId)?.tax_category === 'non-taxable'} className={l.taxCode ? '' : 'needs-decision'} aria-invalid={!l.taxCode || undefined} value={l.taxCode} onChange={e => set(i, { taxCode: e.target.value })}><option value="">Tax treatment needed</option><option value="exempt">Exempt / not taxable</option>{state.taxCodes.map((t: D) => <option key={t.id} value={t.id}>{t.name} ({(t.rate_milli_percent / 1000).toFixed(3)}%)</option>)}</select></td>
        <td>{lines.length > 1 && <button type="button" className="btn btn-link" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
      </tr>)}</tbody></table></div>
  </Card>
}
