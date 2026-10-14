// Invoice and credit drafts. A line without a tax code is shown as needing a
// decision; approval is refused until every line has one.
import { useState } from 'react'
import { accountOptions, Card, command, contactOptions, Field, today, usd, useShared, type D } from './kit'

type Line = { description: string; quantity: string; rate: string; accountId: string; taxCode: string }
const blank = (accountId = ''): Line => ({ description: '', quantity: '1', rate: '', accountId, taxCode: '' })
const cents = (v: string) => /^\d+(\.\d{1,2})?$/.test(v.replace(/,/g, '').trim()) ? Math.round(Number(v.replace(/,/g, '')) * 100) : 0
const qty = (v: string) => /^\d+(\.\d{1,3})?$/.test(v.trim()) ? Number(v) : 0

export function InvoiceEditor({ invoice, creditFor, onDone, onCancel }: { invoice?: D; creditFor?: D; onDone: (saved: D) => void; onCancel: () => void }) {
  const { state } = useShared()
  const income = accountOptions(state.accounts, a => a.type === 'income')
  const source = invoice ?? creditFor
  const [lines, setLines] = useState<Line[]>(source?.lines?.length ? source.lines.map((l: D) => ({ description: l.description, quantity: String(l.quantity_milli / 1000), rate: (l.unit_cents / 100).toFixed(2), accountId: l.account_id, taxCode: creditFor ? l.tax_code ?? '' : l.tax_code ?? '' })) : [blank(income[0]?.value)])
  const [error, setError] = useState(''), [busy, setBusy] = useState(false)
  const rate = (code: string) => code && code !== 'exempt' ? state.taxCodes.find((t: D) => t.id === code)?.rate_milli_percent ?? 0 : 0
  const amounts = lines.map(l => Math.round(qty(l.quantity) * cents(l.rate)))
  const tax = lines.reduce((s, l, i) => s + Math.round(amounts[i] * rate(l.taxCode) / 100000), 0), subtotal = amounts.reduce((s, a) => s + a, 0)
  const missing = lines.filter(l => !l.taxCode).length
  const set = (i: number, patch: Partial<Line>) => setLines(ls => ls.map((l, j) => j === i ? { ...l, ...patch } : l))
  const kind = creditFor || invoice?.kind === 'credit' ? 'credit' : 'invoice'
  return <form className="invoice-editor" onSubmit={async e => {
    e.preventDefault(); const f = Object.fromEntries(new FormData(e.currentTarget))
    setBusy(true); setError('')
    try { onDone(await command('invoice.save-draft', { ...f, kind, creditFor: creditFor?.id ?? invoice?.credit_for, id: invoice?.id, revision: invoice?.revision, lines })) } catch (err) { setError((err as Error).message) } finally { setBusy(false) }
  }}>
    <div className="split split-wide-left">
      <div className="stack">
        <Card title={kind === 'credit' ? `Credit for ${creditFor?.number ?? ''}` : 'Invoice details'}>
          <div className="grid-form">
            <Field label="Customer" name="customerId" defaultValue={source?.customer_id} required options={contactOptions(state.contacts, 'customer')} />
            <Field label={kind === 'credit' ? 'Credit number' : 'Invoice number'} name="number" defaultValue={invoice?.number} hint={invoice ? undefined : 'Leave blank for the next number'} />
            <Field label="Issue date" name="issueDate" type="date" defaultValue={invoice?.issue_date ?? today()} required />
            <Field label="Due date" name="dueDate" type="date" defaultValue={invoice?.due_date} hint="Blank uses the customer's terms" />
          </div>
        </Card>
        <Card title="Service lines" actions={<button type="button" className="btn btn-secondary" onClick={() => setLines(ls => [...ls, blank(income[0]?.value)])}>Add line</button>}>
          <div className="table-wrap"><table className="ledger lines-editor"><thead><tr><th>#</th><th>Description</th><th className="fig">Quantity</th><th className="fig">Rate</th><th className="fig">Amount</th><th>Income account</th><th>Sales tax code</th><th /></tr></thead>
            <tbody>{lines.map((l, i) => <tr key={i}>
              <td data-label="#">{i + 1}</td>
              <td data-label="Description"><input aria-label={`Line ${i + 1} description`} value={l.description} onChange={e => set(i, { description: e.target.value })} required /></td>
              <td data-label="Quantity"><input aria-label={`Line ${i + 1} quantity`} className="fig narrow" inputMode="decimal" value={l.quantity} onChange={e => set(i, { quantity: e.target.value })} required /></td>
              <td data-label="Rate"><input aria-label={`Line ${i + 1} rate`} className="fig narrow" inputMode="decimal" value={l.rate} onChange={e => set(i, { rate: e.target.value })} required /></td>
              <td data-label="Amount" className="fig">{usd(amounts[i])}</td>
              <td data-label="Income account"><select aria-label={`Line ${i + 1} income account`} value={l.accountId} onChange={e => set(i, { accountId: e.target.value })} required><option value="">Choose…</option>{income.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}</select></td>
              <td data-label="Sales tax code"><select aria-label={`Line ${i + 1} sales tax code`} className={l.taxCode ? '' : 'needs-decision'} aria-invalid={!l.taxCode || undefined} value={l.taxCode} onChange={e => set(i, { taxCode: e.target.value })}><option value="">Tax treatment needed</option><option value="exempt">Exempt / not taxable</option>{state.taxCodes.map((t: D) => <option key={t.id} value={t.id}>{t.name} ({(t.rate_milli_percent / 1000).toFixed(3)}%)</option>)}</select></td>
              <td>{lines.length > 1 && <button type="button" className="btn btn-link" onClick={() => setLines(ls => ls.filter((_, j) => j !== i))}>Remove</button>}</td>
            </tr>)}</tbody></table></div>
        </Card>
        <Card title="Memo"><Field label="Memo on the invoice" name="memo" type="textarea" defaultValue={invoice?.memo} wide /></Card>
      </div>
      <Card title={kind === 'credit' ? 'Credit summary' : 'Invoice summary'}>
        <dl className="summary"><div><dt>Subtotal</dt><dd>{usd(subtotal)}</dd></div><div><dt>Sales tax</dt><dd>{usd(tax)}</dd></div><div className="total"><dt>Total</dt><dd>{usd(subtotal + tax)}</dd></div></dl>
        {missing > 0 && <div className="callout callout-warn" role="status"><strong>Tax treatment needed before approval</strong><span>{missing} line{missing === 1 ? ' is' : 's are'} missing a sales tax code. Choose a code or mark the line exempt.</span></div>}
        <div className="form-end column"><button className="btn btn-primary btn-block" disabled={busy}>{busy ? 'Saving…' : 'Save draft'}</button><button type="button" className="btn btn-secondary btn-block" onClick={onCancel}>Cancel</button>{error && <p role="alert" className="error">{error}</p>}</div>
      </Card>
    </div>
  </form>
}
