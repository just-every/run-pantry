// Customers, vendors and source documents. Documents are evidence: their bytes
// are kept exactly and never interpreted as instructions.
import { authority, who } from './access'
import { now, optionalText, requireThat, sha256, text, uid } from './core'
import { audit, changed, one, q, run, type Sql } from './db'
import type { Command } from './context'

export async function contact(db: D1Database, id: string, kind?: 'customer' | 'vendor') {
  const row = await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', id)
  requireThat(row, 'Customer or vendor not found', 404)
  requireThat(!kind || row.kind === kind, `Choose a ${kind}`)
  return row
}

const saveContact: Command = { need: 'record', async run(c, b) {
  const kind = text(b.kind, 'Kind')
  requireThat(kind === 'customer' || kind === 'vendor', 'Kind is customer or vendor')
  const name = text(b.name, 'Name', 200), email = optionalText(b.email, 'Email', 254).toLowerCase()
  requireThat(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
  const terms = b.termsDays === undefined || b.termsDays === '' ? 30 : Number(b.termsDays)
  requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
  const id = b.id ? text(b.id, 'Contact') : uid(), statements: Sql[] = [authority(c.actor, 'record')]
  if (b.id) {
    const current = await contact(c.db, id)
    requireThat(current.revision === b.revision, 'Record changed; reload', 409)
    requireThat(current.kind === kind, 'A customer stays a customer; add a vendor separately')
    const active = b.active === false || b.active === 'false' ? 0 : 1
    statements.push(q('UPDATE pt_contacts SET name = ?, email = ?, terms_days = ?, active = ?, revision = ? WHERE id = ? AND revision = ?', name, email, terms, active, uid(), id, b.revision), changed())
  } else statements.push(q('INSERT INTO pt_contacts (id, kind, name, email, terms_days, external_ref, active, revision) VALUES (?, ?, ?, ?, ?, ?, 1, ?)', id, kind, name, email, terms, '', uid()))
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

const uploadDocument: Command = { need: 'record', async run(c, b) {
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
  await run(c.db, [authority(c.actor, 'record'), doc.statement, audit(who(c.actor), 'document.upload', 'document', doc.id, { name, sha256: doc.sha256, linkedKind, linkedId })])
  return (await one(c.db, 'SELECT id, name, media_type, size, sha256, linked_kind, linked_id, note, uploaded_by, uploaded_at FROM pt_documents WHERE id = ?', doc.id))!
} }

export const contactCommands: Record<string, Command> = {
  'contact.save': saveContact,
  'document.upload': uploadDocument,
}
