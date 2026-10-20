// One retained presentation and PDF per issued revision. All output doors read
// this record; live payments never rewrite a document already sent to a customer.
import type { Hono } from 'hono'
import type { Bindings } from '../auth.server'
import type { Context } from './context'
import { longDay, now, requireThat, sha256, usd, type Data } from './core'
import { all, guard, one, q, type Sql } from './db'
import { invoicePdf, type InvoiceDocument } from './invoice-pdf'
import { base64Bytes, bytesBase64 } from './invoice-logo'
import { customValues, selectedTemplate } from './invoice-templates'
export { invoiceTemplateCommands as invoiceDocumentCommands, invoiceDocumentsView } from './invoice-templates'

export async function documentInvoice(db: D1Database, id: string) {
  const inv = await one(db, 'SELECT i.*, c.name AS customer_name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.id = ?', id)
  requireThat(inv, 'Invoice not found', 404)
  inv.lines = await all(db, 'SELECT * FROM pt_invoice_lines WHERE invoice_id = ? ORDER BY line_no', id)
  return inv
}
export async function buildInvoiceDocument(db: D1Database, inv: Data, parsed?: Data, overrideTemplateId?: string): Promise<InvoiceDocument> {
  const customer = parsed?.customer ?? await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', inv.customer_id)
  requireThat(customer, 'Customer not found', 404)
  const template = overrideTemplateId ? await selectedTemplate(db, customer, overrideTemplateId)
    : parsed?.documentTemplate ?? (inv.document_template ? JSON.parse(inv.document_template) : await selectedTemplate(db, customer, inv.document_template_id))
  const previousValues = parsed?.documentValues ?? JSON.parse(inv.document_values ?? '{}')
  const matching = Object.fromEntries(template.fields.filter((f: Data) => previousValues[f.key] !== undefined).map((f: Data) => [f.key, previousValues[f.key]]))
  const values = customValues(template, matching)
  const entity = await one(db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  const lines: Data[] = parsed?.lines ?? inv.lines
  const subtotal = parsed?.subtotal ?? inv.subtotal_cents ?? lines.reduce((s, l) => s + (l.amount_cents ?? l.amount), 0)
  const tax = parsed?.tax ?? inv.tax_cents ?? lines.reduce((s, l) => s + (l.tax_cents ?? l.tax ?? 0), 0)
  const due = parsed?.dueDate ?? inv.due_date ?? inv.issue_date
  const memo = parsed?.memo ?? inv.memo ?? ''
  const exemption = parsed?.exemption ?? (inv.exemption_evidence ? JSON.parse(inv.exemption_evidence) : inv.exemption)
  const terms = Math.round((Date.parse(due) - Date.parse(inv.issue_date)) / 86400000)
  return {
    business: entity?.legal_name ?? 'Pantry', title: `${inv.kind === 'credit' ? 'Credit' : 'Invoice'} ${inv.number}`,
    templateId: template.id, templateName: template.name, layout: template.layout, accentColor: template.accentColor, textColor: template.textColor, logo: template.logo,
    facts: [['Billed to', inv.customer_name ?? customer.name], ...(customer.billing_address ? [['Billing address', customer.billing_address] as [string, string]] : []),
      ['Issued', longDay(inv.issue_date)], ['Due', longDay(due)], ['Terms', terms === 0 ? 'Due on receipt' : `Net ${terms} days`],
      ...(template.address ? [['Business address', template.address] as [string, string]] : []), ...(template.remitTo ? [['Remit to', template.remitTo] as [string, string]] : []),
      ...template.fields.map((f: Data) => [f.label, values[f.key]] as [string, string])],
    lines: lines.map(l => ({ description: l.description, quantity: String((l.qty ?? l.quantity_milli ?? 1000) / 1000), amount: usd(l.amount ?? l.amount_cents) })),
    totals: [['Subtotal', usd(subtotal)], ['Sales tax', usd(tax)], ['Total', usd(inv.total_cents)], ['Amount due', usd(inv.total_cents)]],
    notes: [template.message, memo, ...(exemption ? [`Sales tax exempt in ${parsed?.destination ?? inv.destination_state}: certificate ${exemption.certificateNumber}, valid through ${exemption.expiresOn}.`] : []),
      template.paymentInstructions, template.footer].filter(Boolean),
  }
}
export async function issuedDocumentStatements(db: D1Database, inv: Data, revision: string, parsed?: Data): Promise<Sql[]> {
  const document = await buildInvoiceDocument(db, inv, parsed), pdf = invoicePdf(document), hash = await sha256(pdf)
  return [q('INSERT INTO pt_invoice_documents (invoice_id,issued_revision,document,pdf_base64,sha256,retained_at,basis) VALUES (?,?,?,?,?,?,\'issued\')', inv.id, revision, JSON.stringify(document), bytesBase64(pdf), hash, now()),
    q('UPDATE pt_invoices SET issued_document_revision = ?, issued_pdf_sha256 = ? WHERE id = ?', revision, hash, inv.id)]
}
export async function issuedDocument(db: D1Database, invoiceId: string) {
  let row = await one(db, 'SELECT * FROM pt_invoice_documents WHERE invoice_id = ?', invoiceId)
  requireThat(row, 'This invoice has no issued document. Issue the approved revision before sharing its PDF.', 409)
  const document = JSON.parse(row.document) as InvoiceDocument
  // Upgrade snapshots are already immutable. Materialize their bytes once,
  // using only that saved presentation, before any output door can share them.
  if (!row.pdf_base64) {
    const pdf = invoicePdf(document), hash = await sha256(pdf)
    await db.batch([
      db.prepare('UPDATE pt_invoice_documents SET pdf_base64 = ?, sha256 = ? WHERE invoice_id = ? AND pdf_base64 IS NULL').bind(bytesBase64(pdf), hash, invoiceId),
      db.prepare('UPDATE pt_invoices SET issued_pdf_sha256 = (SELECT sha256 FROM pt_invoice_documents WHERE invoice_id = ?) WHERE id = ?').bind(invoiceId, invoiceId),
    ])
    row = (await one(db, 'SELECT * FROM pt_invoice_documents WHERE invoice_id = ?', invoiceId))!
  }
  return { document, pdf: base64Bytes(row.pdf_base64), sha256: row.sha256 as string, revision: row.issued_revision as string, basis: row.basis as string }
}
export function documentSelectionStatements(id: string, parsed: Data): Sql[] {
  const t = parsed.documentTemplate
  return [guard('EXISTS (SELECT 1 FROM pt_invoice_templates WHERE id = ? AND revision = ?)', t.id, t.revision),
    q('UPDATE pt_invoices SET document_template_id = ?, document_template_revision = ?, document_template = ?, document_values = ? WHERE id = ?', t.id, t.revision, JSON.stringify(t), JSON.stringify(parsed.documentValues), id)]
}
export function registerInvoiceDocumentRoutes(api: Hono<{ Bindings: Bindings }>, reader: (c: any) => Promise<Context>) {
  api.get('/api/pantry/invoice-documents/:id/preview', async c => {
    const ctx = await reader(c), inv = await documentInvoice(ctx.db, c.req.param('id')), template = c.req.query('templateId')
    if (inv.status === 'issued' && !template) {
      const saved = await issuedDocument(ctx.db, inv.id)
      return c.json({ document: saved.document, pdfBase64: bytesBase64(saved.pdf), sha256: saved.sha256, issuedRevision: saved.revision, basis: saved.basis })
    }
    const document = await buildInvoiceDocument(ctx.db, inv, undefined, template), pdf = invoicePdf(document)
    return c.json({ document, pdfBase64: bytesBase64(pdf), sha256: await sha256(pdf), issuedRevision: null, basis: 'preview' })
  })
  api.get('/api/pantry/invoice-documents/:id/pdf', async c => {
    const ctx = await reader(c), inv = await documentInvoice(ctx.db, c.req.param('id')), template = c.req.query('templateId')
    const pdf = inv.status === 'issued' && !template ? (await issuedDocument(ctx.db, inv.id)).pdf : invoicePdf(await buildInvoiceDocument(ctx.db, inv, undefined, template))
    return new Response(pdf, { headers: { 'content-type': 'application/pdf', 'content-disposition': `inline; filename="${inv.number.replace(/[^\w.-]+/g, '_')}.pdf"`, 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; sandbox" } })
  })
}
