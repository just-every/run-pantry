// Owner-managed presentation templates; customer and invoice selections refer
// to real saved templates. Drafts retain the selected template's exact values.
import { authority, who } from './access'
import type { Command } from './context'
import { now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, q, run } from './db'
import { invoiceLogo } from './invoice-logo'

export async function documentSettings(db: D1Database) {
  return (await one(db, 'SELECT * FROM pt_invoice_document_settings WHERE id = 1'))!
}
export async function invoiceTemplates(db: D1Database) {
  return (await all(db, 'SELECT * FROM pt_invoice_templates ORDER BY name, id')).map(t => ({ ...t, ...JSON.parse(t.settings) }))
}
export async function selectedTemplate(db: D1Database, customer: Data, templateId?: unknown) {
  const settings = await documentSettings(db)
  const id = templateId ? text(templateId, 'Invoice template') : customer.invoice_template_id || settings.default_template_id
  const row = await one(db, 'SELECT * FROM pt_invoice_templates WHERE id = ?', id)
  requireThat(row, 'Choose a saved invoice template')
  return { id: row.id, revision: row.revision, name: row.name, ...JSON.parse(row.settings) }
}
export function customValues(template: Data, raw: unknown) {
  requireThat(raw === undefined || (raw !== null && typeof raw === 'object' && !Array.isArray(raw)), 'Custom fields must be an object')
  const values = (raw ?? {}) as Data
  requireThat(Object.keys(values).every(k => template.fields.some((f: Data) => f.key === k)), 'A custom field is not on this template; review its fields')
  return Object.fromEntries(template.fields.map((f: Data) => [f.key, optionalText(values[f.key] ?? f.defaultValue, f.label, 300)]))
}
const save: Command = { need: 'owner', async run(c, b) {
  const id = b.id ? text(b.id, 'Template') : uid(), old = b.id ? await one(c.db, 'SELECT * FROM pt_invoice_templates WHERE id = ?', id) : null
  requireThat(!b.id || (old && old.revision === b.revision), 'Template changed; reload', 409)
  const name = text(b.name, 'Template name', 80), layout = text(b.layout, 'Layout')
  requireThat(['classic', 'banner'].includes(layout), 'Choose Classic or Banner layout')
  const color = (v: unknown, label: string) => { const s = text(v, label, 7); requireThat(/^#[0-9a-fA-F]{6}$/.test(s), `${label} needs a six-digit hex color`); return s.toLowerCase() }
  const termsDays = Number(b.termsDays)
  requireThat(Number.isInteger(termsDays) && termsDays >= 0 && termsDays <= 365, 'Default terms are 0–365 days')
  const fields: Data[] = b.fields ?? []
  requireThat(Array.isArray(fields) && fields.length <= 12, 'Add at most 12 custom fields')
  const parsed = fields.map((f, i) => { requireThat(f && typeof f === 'object' && !Array.isArray(f), `Field ${i + 1} must be an object`); const key = text(f.key, `Field ${i + 1} key`, 40); requireThat(/^[a-z][a-z0-9_]*$/.test(key), 'Field keys use lowercase letters, numbers and underscores'); return { key, label: text(f.label, `Field ${i + 1} label`, 80), defaultValue: optionalText(f.defaultValue, 'Default field value', 300) } })
  requireThat(new Set(parsed.map(f => f.key)).size === fields.length, 'Each field needs a different key')
  const previous = old ? JSON.parse(old.settings) : null
  const settings = { layout, accentColor: color(b.accentColor, 'Accent color'), textColor: color(b.textColor, 'Text color'),
    address: optionalText(b.address, 'Business address', 1000), remitTo: optionalText(b.remitTo, 'Remit to', 1000), termsDays,
    paymentInstructions: optionalText(b.paymentInstructions, 'Payment instructions', 2000), footer: optionalText(b.footer, 'Footer', 1000), message: optionalText(b.message, 'Template message', 2000),
    logo: b.logoBase64 === undefined ? previous?.logo ?? null : invoiceLogo(b.logoBase64), fields: parsed }
  const revision = uid()
  await run(c.db, [authority(c.actor, 'owner'), ...(old ? [q('UPDATE pt_invoice_templates SET name = ?, settings = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = ? AND revision = ?', name, JSON.stringify(settings), revision, c.actor.email, now(), id, b.revision), changed()] : [q('INSERT INTO pt_invoice_templates (id,name,settings,revision,updated_by,updated_at) VALUES (?,?,?,?,?,?)', id, name, JSON.stringify(settings), revision, c.actor.email, now())]), audit(who(c.actor), 'invoice-template.save', 'invoice-template', id, { name, revision })])
  return (await invoiceTemplates(c.db)).find(t => t.id === id)!
} }
export async function nextInvoiceNumber(db: D1Database) {
  const settings = await documentSettings(db)
  const rows = await all<{ number: string }>(db, "SELECT number FROM pt_invoices WHERE number GLOB 'INV-[0-9]*'")
  const max = rows.map(r => /^INV-\d+$/.test(r.number) ? Number(r.number.slice(4)) : 0).reduce((a, n) => Math.max(a, n), 0)
  return 'INV-' + String(Math.max(settings.next_invoice, max + 1)).padStart(4, '0')
}
const saveSettings: Command = { need: 'owner', async run(c, b) {
  const current = await documentSettings(c.db), next = Number(b.nextInvoice)
  requireThat(current.revision === b.revision, 'Invoice settings changed; reload', 409)
  requireThat(Number.isInteger(next) && next >= 1 && next <= 999999999, 'Next invoice number is a whole number from 1 to 999999999')
  const template = await selectedTemplate(c.db, {}, b.defaultTemplateId)
  const currentNext = Number((await nextInvoiceNumber(c.db)).slice(4))
  const maxUsed = (await all<{ number: string }>(c.db, "SELECT number FROM pt_invoices WHERE number LIKE 'INV-%'")).reduce((m, r) => /^INV-\d+$/.test(r.number) ? Math.max(m, Number(r.number.slice(4))) : m, 0)
  requireThat(next > maxUsed, 'Start after the highest existing invoice number')
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_invoice_document_settings SET next_invoice = ?, default_template_id = ?, revision = ? WHERE id = 1 AND revision = ?', next, template.id, uid(), current.revision), changed(),
    guard("NOT EXISTS (SELECT 1 FROM pt_invoices WHERE number = ?)", 'INV-' + String(next).padStart(4, '0')), audit(who(c.actor), 'invoice-document-settings.save', 'invoice-document-settings', '1', { next, previousNext: currentNext, defaultTemplateId: template.id })])
  return invoiceDocumentsView(c.db)
} }
const customerDefault: Command = { need: 'record', async run(c, b) {
  const customer = await one(c.db, "SELECT * FROM pt_contacts WHERE id = ? AND kind = 'customer'", text(b.customerId, 'Customer'))
  requireThat(customer && customer.revision === b.revision, 'Customer changed; reload', 409)
  const template = b.templateId ? await selectedTemplate(c.db, customer, b.templateId) : null
  await run(c.db, [authority(c.actor, 'record'), q("UPDATE pt_contacts SET invoice_template_id = ?, revision = ? WHERE id = ? AND revision = ? AND kind = 'customer'", template?.id ?? null, uid(), customer.id, customer.revision), changed(), audit(who(c.actor), 'customer.invoice-template', 'customer', customer.id, { templateId: template?.id ?? null })])
  return (await one(c.db, 'SELECT * FROM pt_contacts WHERE id = ?', customer.id))!
} }
export const invoiceTemplateCommands: Record<string, Command> = { 'invoice-template.save': save, 'invoice-document-settings.save': saveSettings, 'customer.invoice-template': customerDefault }
export async function invoiceDocumentsView(db: D1Database) {
  return { settings: await documentSettings(db), templates: await invoiceTemplates(db), nextNumber: await nextInvoiceNumber(db) }
}
