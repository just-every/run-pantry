// Customers, vendors and source documents. Documents are evidence: their bytes
// are kept exactly and never interpreted as instructions.
import { authority, who } from './access'
import { now, optionalText, requireThat, sha256, text, uid } from './core'
import { audit, changed, one, q, run, type Sql } from './db'
import type { Command, Context } from './context'
import { vendorProfile } from './receipts/vendor-profile'
import { customerProfile } from './customer-profile'
import { selectedTemplate } from './invoice-templates'
import { documentCaptureStatements, decideDocumentDuplicate } from './receipts/document-intake'

export async function contact(db: D1Database, id: string, kind?: 'customer' | 'vendor') {
  const row = await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', id)
  requireThat(row, 'Customer or vendor not found', 404)
  requireThat(!row.erased_at, 'This contact was erased; its retained bookkeeping cannot receive new personal data', 409)
  requireThat(!kind || row.kind === kind, `Choose a ${kind}`)
  return row
}

const saveContact: Command = { need: 'record', async run(c, b) {
  const kind = text(b.kind, 'Kind')
  requireThat(kind === 'customer' || kind === 'vendor', 'Kind is customer or vendor')
  const id = b.id ? text(b.id, 'Contact') : uid(), statements: Sql[] = [authority(c.actor, 'record')]
  const current = b.id ? await contact(c.db, id) : null
  const preserve = current
  const name = text(b.name === undefined ? preserve?.name : b.name, 'Name', 200), email = optionalText(b.email === undefined ? preserve?.email : b.email, 'Email', 254).toLowerCase()
  requireThat(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
  const invoiceTemplate = kind === 'customer' ? await selectedTemplate(c.db, preserve ?? {}, b.invoiceTemplateId) : null
  const terms = b.termsDays === undefined ? preserve?.terms_days ?? invoiceTemplate?.termsDays ?? 30 : b.termsDays === '' ? invoiceTemplate?.termsDays ?? 30 : Number(b.termsDays)
  requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
  // How the customer's deposits read on the bank statement, for automatic matching.
  const bankReference = optionalText(b.bankReference === undefined ? preserve?.bank_reference : b.bankReference, 'Bank statement reference', 120)
  const profile = kind === 'vendor' ? await vendorProfile(c.db, b, current) : null
  const customer = kind === 'customer' ? customerProfile(b, current) : null
  if (customer?.invoiceTemplateId) await selectedTemplate(c.db, {}, customer.invoiceTemplateId)
  if (b.id) {
    requireThat(current!.revision === b.revision, 'Record changed; reload', 409)
    requireThat(current!.kind === kind, 'A customer stays a customer; add a vendor separately')
    const active = b.active === undefined && preserve ? preserve.active : b.active === false || b.active === 'false' ? 0 : 1
    statements.push(q('UPDATE pt_contacts SET name = ?, email = ?, terms_days = ?, bank_reference = ?, active = ?, revision = ? WHERE id = ? AND revision = ?', name, email, terms, bankReference, active, uid(), id, b.revision), changed())
  } else statements.push(q('INSERT INTO pt_contacts (id, kind, name, email, terms_days, external_ref, bank_reference, active, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)', id, kind, name, email, terms, '', bankReference, uid()))
  if (profile) statements.push(q('UPDATE pt_contacts SET address = ?, phone = ?, default_account_id = ?, default_class = ?,default_location=?,default_project=?, is_1099 = ?, vendor_ein_hash = ? WHERE id = ?', profile.address, profile.phone, profile.accountId, profile.className,profile.locationName,profile.projectName, profile.is1099, profile.einHash, id), changed())
  if (profile) {
    const box = b.vendorTaxBox === undefined ? current?.vendor_tax_box ?? 'NEC-1' : text(b.vendorTaxBox, '1099 box')
    requireThat(['NEC-1', 'MISC-1', 'MISC-2', 'MISC-3', 'MISC-5', 'MISC-6', 'MISC-7', 'MISC-8', 'MISC-9', 'MISC-10', 'MISC-11', 'MISC-12', 'MISC-14', 'MISC-15'].includes(box), 'Choose a supported 1099 box')
    const method = b.providerPaymentMethod === undefined ? current?.provider_payment_method ?? '' : optionalText(b.providerPaymentMethod, 'Preferred payment method', 30)
    requireThat(['', 'ach', 'check', 'wire', 'card', 'cash', 'payment-network'].includes(method), 'Choose a payment method')
    const provider = b.paymentProvider === undefined ? current?.payment_provider ?? '' : optionalText(b.paymentProvider, 'Payment provider', 100)
    const contacts = customerProfile({ contacts: b.contacts }, current).contacts
    statements.push(q('UPDATE pt_contacts SET vendor_tax_box=?, provider_payment_method=?, payment_provider=?, contacts_json=? WHERE id=?', box, method, provider, contacts, id), changed())
  }
  if (customer) statements.push(q('UPDATE pt_contacts SET contacts_json = ?, billing_address = ?, service_address = ?, phone = ?, internal_notes = ?, pay_methods = ?, invoice_template_id = ?, invoice_terms_override = ?, reminder_days = ? WHERE id = ?', customer.contacts, customer.billingAddress, customer.serviceAddress, customer.phone, customer.internalNotes, customer.payMethods, customer.invoiceTemplateId, b.termsDays === undefined ? current?.invoice_terms_override ?? 0 : b.termsDays === '' ? 0 : 1, customer.reminderDays, id), changed())
  statements.push(audit(who(c.actor), b.id ? 'contact.update' : 'contact.create', kind, id, { name }))
  await run(c.db, statements)
  return contact(c.db, id)
} }

const LINKABLE = ['bill', 'invoice', 'journal', 'payment', 'statement', 'none']
const MEDIA = /^(application\/pdf|image\/(png|jpeg|webp)|text\/(plain|csv)|application\/(x-ofx|ofx|vnd\.intu\.qbo))$/

export async function documentInsert(c: { actor: any }, input: { name: string; mediaType: string; bytes: Uint8Array; linkedKind?: string | null; linkedId?: string | null; note?: string }) {
  requireThat(input.bytes.length > 0 && input.bytes.length <= 1_500_000, 'Documents are 1 byte to 1.5 MB')
  const id = uid(), hash = await sha256(input.bytes)
  return { id, sha256: hash, statement: q('INSERT INTO pt_documents (id, name, media_type, size, sha256, content, linked_kind, linked_id, note, uploaded_by, uploaded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    id, input.name, input.mediaType, input.bytes.length, hash, input.bytes, input.linkedKind ?? null, input.linkedId ?? null, input.note ?? '', c.actor.email, now()) }
}

export async function documentStatements(c: Context, b: Record<string, any>) {
  const name = text(b.name, 'File name', 200), mediaType = text(b.mediaType, 'File type', 100)
  requireThat(MEDIA.test(mediaType), 'Upload a PDF, image, text, CSV or OFX file')
  requireThat(typeof b.base64 === 'string' && /^[A-Za-z0-9+/]+=*$/.test(b.base64), 'File content is missing')
  const bytes = Uint8Array.from(atob(b.base64), ch => ch.charCodeAt(0))
  const linkedKind = optionalText(b.linkedKind, 'Linked record') || 'none'
  requireThat(LINKABLE.includes(linkedKind), 'Documents attach to a bill, invoice, journal, payment or statement')
  const linkedId = linkedKind === 'none' ? null : text(b.linkedId, 'Linked record')
  if (linkedKind !== 'none') {
    const table = { bill: 'pt_bills', invoice: 'pt_invoices', journal: 'pt_journal_entries', payment: 'pt_payments', statement: 'pt_statements' }[linkedKind]!
    requireThat(await one(c.db, `SELECT 1 FROM ${table} WHERE id = ?`, linkedId), 'Linked record not found', 404)
  }
  const doc = await documentInsert(c, { name, mediaType, bytes, linkedKind: linkedKind === 'none' ? null : linkedKind, linkedId, note: optionalText(b.note, 'Note', 500) })
  return { id: doc.id, statements: [authority(c.actor, 'record'), doc.statement, ...await documentCaptureStatements(c, doc.id, { name, mediaType, bytes, linkedKind: linkedKind === 'none' ? null : linkedKind, linkedId }), audit(who(c.actor), 'document.upload', 'document', doc.id, { name, sha256: doc.sha256, linkedKind, linkedId })] }
}

const uploadDocument: Command = { need: 'record', async run(c, b) {
  const doc = await documentStatements(c, b)
  await run(c.db, doc.statements)
  return (await one(c.db, 'SELECT id, name, media_type, size, sha256, linked_kind, linked_id, note, uploaded_by, uploaded_at, duplicate_of, duplicate_basis, duplicate_reason, duplicate_decision FROM pt_documents WHERE id = ?', doc.id))!
} }

export const contactCommands: Record<string, Command> = {
  'contact.save': saveContact,
  'document.upload': uploadDocument,
  'document.duplicate-decide': decideDocumentDuplicate,
}
