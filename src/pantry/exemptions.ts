// Sales tax certificates retain the exact document; renewals add evidence and
// never rewrite a citation already frozen on an invoice.
import { authority, who } from './access'
import { date, list, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, audit, changed, guard, one, q, run, type Sql } from './db'
import { contact } from './contacts'
import { documentStatements, MAX_DOCUMENT_BYTES } from './documents'
import { businessDay, sendingSettings } from './delivery'
import type { Command } from './context'

const STATES = new Set('AL AK AZ AR CA CO CT DE FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY DC'.split(' '))
export function destinationState(value: unknown) {
  const state = optionalText(value, 'Ship-to / destination state', 2).toUpperCase()
  requireThat(!state || STATES.has(state), 'Choose a two-letter US destination state')
  return state
}
export const exemptionDay = async (db: D1Database) => businessDay((await sendingSettings(db)).time_zone)

export async function exemptionView(db: D1Database) {
  const today = await exemptionDay(db)
  const certificates = await all(db, `SELECT e.*, c.name AS customer_name, d.name AS document_name, d.sha256 AS document_sha256,
    r.reminded_at, r.email_status, r.email_detail FROM pt_exemption_certificates e
    JOIN pt_contacts c ON c.id = e.customer_id JOIN pt_documents d ON d.id = e.document_id
    LEFT JOIN pt_exemption_reminders r ON r.certificate_id = e.id ORDER BY e.created_at DESC, e.id`)
  return { today, certificates: certificates.map((e): Data => ({ ...e, states: JSON.parse(e.states) })) }
}

export async function applicableExemption(db: D1Database, customerId: string, state: string, issueDate: string) {
  if (!state) return null
  const today = await exemptionDay(db)
  const cert = await one(db, `SELECT e.*, d.name AS document_name, d.sha256 AS document_sha256 FROM pt_exemption_certificates e
    JOIN pt_documents d ON d.id = e.document_id WHERE e.customer_id = ? AND e.active = 1
    AND e.valid_from <= ? AND e.valid_from <= ? AND e.expires_on >= ? AND e.expires_on >= ?
    AND EXISTS (SELECT 1 FROM json_each(e.states) WHERE value = ?) ORDER BY e.expires_on DESC, e.created_at DESC, e.id LIMIT 1`, customerId, issueDate, today, issueDate, today, state)
  return cert ? { id: cert.id, certificateNumber: cert.certificate_number, documentId: cert.document_id, documentName: cert.document_name,
    documentSha256: cert.document_sha256, states: JSON.parse(cert.states), validFrom: cert.valid_from, expiresOn: cert.expires_on } : null
}

/** Rechecked in the posting batch: a retired or expired certificate cannot race issuance. */
export function exemptionFence(evidence: Data | null, customerId: string, state: string, issueDate: string, today: string): Sql[] {
  return evidence ? [guard(`EXISTS (SELECT 1 FROM pt_exemption_certificates e JOIN pt_documents d ON d.id = e.document_id
    WHERE e.id = ? AND e.customer_id = ? AND e.active = 1 AND e.document_id = ? AND d.sha256 = ?
    AND e.valid_from = ? AND e.expires_on = ? AND e.valid_from <= ? AND e.valid_from <= ? AND e.expires_on >= ? AND e.expires_on >= ?
    AND EXISTS (SELECT 1 FROM json_each(e.states) WHERE value = ?))`,
  evidence.id, customerId, evidence.documentId, evidence.documentSha256, evidence.validFrom, evidence.expiresOn, issueDate, today, issueDate, today, state)] : []
}

export async function assertInvoiceExemption(db: D1Database, current: Data) {
  const evidence = typeof current.exemption_evidence === 'string' ? JSON.parse(current.exemption_evidence) : current.exemption_evidence
  if (!evidence) return []
  const cert = await one(db, 'SELECT * FROM pt_exemption_certificates WHERE id = ?', evidence.id), today = await exemptionDay(db)
  requireThat(cert && cert.active && cert.customer_id === current.customer_id && JSON.parse(cert.states).includes(current.destination_state)
    && cert.valid_from <= current.issue_date && cert.valid_from <= today && cert.expires_on >= current.issue_date && cert.expires_on >= today,
  'The cited exemption certificate expired or was replaced. Edit this invoice and review its tax treatment before approving or issuing it.', 409)
  return exemptionFence(evidence, current.customer_id, current.destination_state, current.issue_date, today)
}

const save: Command = { need: 'record', async run(c, b) {
  const customer = await contact(c.db, text(b.customerId, 'Customer'), 'customer')
  requireThat(customer.active, 'Customer is inactive')
  const states = [...new Set(list<unknown>(b.states, 'Covered states', 51).map(s => {
    const state = destinationState(s); requireThat(state, 'A covered state is required'); return state
  }))].sort()
  const validFrom = date(b.validFrom, 'Valid from'), expiresOn = date(b.expiresOn, 'Expiry date')
  requireThat(expiresOn >= validFrom, 'Expiry date is on or after the valid-from date')
  const number = text(b.certificateNumber, 'Certificate number', 120), id = uid()
  const replacesId = b.replacesId ? text(b.replacesId, 'Previous certificate') : null
  if (replacesId) {
    const previous = await one(c.db, 'SELECT customer_id, active FROM pt_exemption_certificates WHERE id = ?', replacesId)
    requireThat(previous && previous.customer_id === customer.id && previous.active, 'Renew an active certificate for this customer', 409)
  }
  requireThat(typeof b.base64 === 'string' && b.base64.length <= Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4 && /^[A-Za-z0-9+/]+={0,2}$/.test(b.base64), 'Certificate document is required (up to 12 MB)')
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(b.base64), ch => ch.charCodeAt(0)) } catch { requireThat(false, 'Certificate document is not valid base64') }
  const doc = await documentStatements(c.actor.email, { name: text(b.name, 'Document name', 200), mediaType: text(b.mediaType, 'Document type', 100), bytes,
    linkedKind: 'exemption', linkedId: id, note: `Certificate ${number}` })
  await run(c.db, [authority(c.actor, 'record'), ...doc.statements,
    ...(replacesId ? [q('UPDATE pt_exemption_certificates SET active = 0 WHERE id = ? AND customer_id = ? AND active = 1', replacesId, customer.id), changed()] : []),
    q('INSERT INTO pt_exemption_certificates (id, customer_id, document_id, certificate_number, states, valid_from, expires_on, replaces_id, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, customer.id, doc.id, number, JSON.stringify(states), validFrom, expiresOn, replacesId, c.actor.email, now()),
    audit(who(c.actor), 'exemption.save', 'exemption', id, { customer: customer.id, states, expiresOn, document: doc.id, replacesId })])
  return (await exemptionView(c.db)).certificates.find(e => e.id === id)!
} }

const retire: Command = { need: 'record', async run(c, b) {
  const id = text(b.id, 'Certificate'), reason = text(b.reason, 'Reason', 500)
  await run(c.db, [authority(c.actor, 'record'), q('UPDATE pt_exemption_certificates SET active = 0 WHERE id = ? AND active = 1', id), changed(),
    audit(who(c.actor), 'exemption.retire', 'exemption', id, { reason })])
  return { id }
} }

export const exemptionCommands: Record<string, Command> = { 'exemption.save': save, 'exemption.retire': retire }
