import { useState } from 'react'
import { Card, command, Field, Form, Loading, useShared, useView, type D } from './kit'
import { InvoiceTemplateEditor } from './invoice-template-editor'

export function InvoiceDocumentPreview({ invoiceId, templateId }: { invoiceId: string; templateId?: string }) {
  const query = templateId ? `?templateId=${encodeURIComponent(templateId)}` : ''
  const path = `invoice-documents/${encodeURIComponent(invoiceId)}`
  const { data, error } = useView<D>(`${path}/preview${query}`)
  if (!data) return <Loading error={error} what="invoice preview" />
  const doc = data.document
  return <Card title={data.basis === 'preview' ? 'Template preview on this invoice' : 'Retained issued document'}>
    <p>{data.basis === 'preview' ? 'This preview uses the selected template. Save a draft with that template to use it when issuing.' : data.basis === 'upgrade' ? 'Retained during the document upgrade. Current payment status is shown separately on the customer page.' : 'The email attachment, hosted PDF and download use this retained file.'}</p>
    <p><strong>{doc.title}</strong> · {doc.templateName}</p>
    <dl className="facts">{doc.facts.map(([label, value]: string[], n: number) => <div key={n}><dt>{label}</dt><dd style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{value || '—'}</dd></div>)}</dl>
    {doc.notes.map((note: string, n: number) => <p key={n} style={{ whiteSpace: 'pre-wrap' }}>{note}</p>)}
    {data.issuedRevision && <p className="hint" style={{ overflowWrap: 'anywhere' }}>Issued revision: {data.issuedRevision}<br />PDF SHA-256: {data.sha256}</p>}
    <p><a href={`/api/pantry/${path}/pdf${query}`} target="_blank" rel="noreferrer">Open PDF preview</a></p>
    <iframe title="Invoice document preview" src={`/api/pantry/${path}/pdf${query}`} style={{ width: '100%', height: 520, border: 0 }} />
  </Card>
}

export function InvoiceTemplates() {
  const { state, reload: reloadShared } = useShared(), { data, error, reload } = useView<D>('invoice-documents'), { data: sales, reload: reloadSales } = useView<D>('sales')
  const [editing, setEditing] = useState<string | null>(null), [templateId, setTemplateId] = useState(''), [customerId, setCustomerId] = useState(''), [previewId, setPreviewId] = useState('')
  if (!data) return <Loading error={error} what="invoice templates" />
  const options = data.templates.map((t: D) => ({ value: t.id, label: t.name })), selectedId = templateId || data.settings.default_template_id
  const selected = data.templates.find((t: D) => t.id === selectedId), customer = state.contacts.find((c: D) => c.id === customerId)
  const refresh = async () => { await Promise.all([reload(), reloadShared(), reloadSales()]) }
  return <div className="stack">
    <Card title="Invoice documents" actions={state.actor.can.owner && <button type="button" className="btn btn-secondary" onClick={() => setEditing('new')}>New invoice template</button>}>
      <p>Choose the document customers receive. Each issued invoice keeps its template, logo, fields and PDF.</p>
      <Field label="Saved invoice template" name="selectedInvoiceTemplate" options={options} value={selectedId} onChange={(e: any) => setTemplateId(e.target.value)} />
      {selected && <p>{selected.layout === 'banner' ? 'Banner' : 'Classic'} layout · {selected.fields.length} custom fields · default terms {selected.termsDays} days</p>}
      {selected && state.actor.can.owner && <button type="button" className="btn btn-secondary" onClick={() => setEditing(selected.id)}>Edit invoice template</button>}
    </Card>
    {editing && state.actor.can.owner && <InvoiceTemplateEditor key={editing + (data.templates.find((t: D) => t.id === editing)?.revision ?? '')} template={data.templates.find((t: D) => t.id === editing)} onCancel={() => setEditing(null)} onSaved={async t => { setEditing(null); setTemplateId(t.id); await refresh() }} />}
    <div className="split">
      {state.actor.can.owner && <Card title="Invoice numbering and business default">
        <Form key={data.settings.revision} label="Save invoice defaults" submit={b => command('invoice-document-settings.save', { ...b, revision: data.settings.revision })} onDone={refresh}>
          <Field label="Next invoice sequence number" name="nextInvoice" type="number" min={1} max={999999999} defaultValue={Number(data.nextNumber.slice(4))} required hint={`Next automatic number: ${data.nextNumber}. Set the first unused number from your previous system.`} />
          <Field label="Business default invoice template" name="defaultTemplateId" defaultValue={data.settings.default_template_id} options={options} required />
        </Form>
      </Card>}
      {state.actor.can.record && <Card title="Customer invoice default">
        <Field label="Customer for template default" name="invoiceTemplateCustomer" value={customerId} onChange={(e: any) => setCustomerId(e.target.value)} options={state.contacts.filter((c: D) => c.kind === 'customer' && c.active).map((c: D) => ({ value: c.id, label: c.name }))} />
        {customer && <Form key={customer.id + customer.revision} label="Save customer invoice template" submit={b => command('customer.invoice-template', { ...b, customerId: customer.id, revision: customer.revision })} onDone={refresh}>
          <Field label="Customer default invoice template" name="templateId" defaultValue={customer.invoice_template_id ?? ''} empty="Use business default" options={options} />
        </Form>}
      </Card>}
    </div>
    <Card title="Preview with a real invoice">
      <Field label="Invoice for template preview" name="templatePreviewInvoice" value={previewId} onChange={(e: any) => setPreviewId(e.target.value)} options={(sales?.invoices ?? []).map((i: D) => ({ value: i.id, label: `${i.number} · ${i.customer_name}` }))} />
      {!sales?.invoices.length && <p>Save an invoice draft to preview any template with its actual customer and lines.</p>}
    </Card>
    {previewId && <InvoiceDocumentPreview invoiceId={previewId} templateId={selectedId} />}
  </div>
}
