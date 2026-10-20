// Sibling postings share Pantry's parsers, accounting batches and period guards.
import { authority, who } from '../access'
import { contact, documentStatements } from '../contacts'
import type { Context } from '../context'
import { date, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { approval, assertOpen, audit, changed, one, periodOpen, q, type Sql } from '../db'
import { documentSelectionStatements } from '../invoice-documents'
import { invoice, issueStatements, lineStatements, nextNumber, parseInvoice } from '../invoices'
import { entryStatements, parseLines } from '../journal'
import { bill, billStatements, paymentStatements } from '../payables'
import type { Prepared } from './idempotency'

export async function prepareContact(c: Context, b: Data): Promise<Prepared> {
  const externalId = text(b.externalId, 'External contact ID', 200), kind = text(b.kind, 'Kind')
  requireThat(kind === 'vendor' || kind === 'customer', 'Kind is vendor or customer')
  const name = text(b.name, 'Name', 200)
  const old = await one(c.db, 'SELECT contact_id FROM pt_integration_contacts WHERE credential_id = ? AND external_id = ? AND kind = ?', c.actor.id, externalId, kind)
  // Names are unique within each contact kind. A new or rotated connection
  // links the existing business rather than trying to create it a second time.
  const current = old ? await contact(c.db, old.contact_id, kind) : await one(c.db, 'SELECT * FROM pt_contacts WHERE kind = ? AND name = ?', kind, name)
  requireThat(!current || current.active, 'This contact is inactive; ask the owner to reactivate it in Pantry', 409)
  const email = b.email === undefined && current ? current.email : optionalText(b.email, 'Email', 254).toLowerCase()
  requireThat(!email || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email), 'Enter a valid email')
  const terms = b.termsDays === undefined ? current?.terms_days ?? 30 : Number(b.termsDays)
  requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
  const id = current?.id ?? uid(), revision = uid(), statements: Sql[] = []
  if (current) {
    statements.push(q('UPDATE pt_contacts SET name = ?,email = ?,terms_days = ?,revision = ? WHERE id = ? AND revision = ?', name, email, terms, revision, id, current.revision), changed())
  } else statements.push(q("INSERT INTO pt_contacts (id,kind,name,email,terms_days,external_ref,bank_reference,active,revision) VALUES (?,?,?,?,?,?,'',1,?)", id, kind, name, email, terms, externalId, revision))
  if (!old) statements.push(q('INSERT INTO pt_integration_contacts (credential_id,external_id,kind,contact_id) VALUES (?,?,?,?)', c.actor.id, externalId, kind, id))
  statements.push(audit(who(c.actor), 'contact.upsert', kind, id, { externalId, name }))
  return { id, kind: 'contact', statements }
}

export async function prepareBill(c: Context, b: Data): Promise<Prepared> {
  const p = await billStatements(c, b)
  return { ...p, kind: 'bill' }
}

export async function preparePayment(c: Context, b: Data): Promise<Prepared> {
  const p = await paymentStatements(c.db, who(c.actor), b)
  return { id: p.id, kind: 'payment', statements: [periodOpen(date(b.date)), ...p.statements] }
}

export async function prepareInvoice(c: Context, b: Data): Promise<Prepared> {
  const p = await parseInvoice(c.db, b), kind = b.kind === 'credit' ? 'credit' : 'invoice'
  await assertOpen(c.db, p.issueDate)
  const id = uid(), revision = uid(), number = b.number ? text(b.number, 'Number', 40) : await nextNumber(c.db, kind)
  let creditFor = null
  if (kind === 'credit') {
    const target = await invoice(c.db, text(b.creditFor, 'Invoice being credited'))
    requireThat(target.kind === 'invoice' && target.status === 'issued' && target.customer_id === p.customer.id, 'A credit applies to an issued invoice of the same customer')
    creditFor = target.id
  }
  const post = b.post === true
  if (post) requireThat(p.lines.every(l => l.taxCode), 'Every invoice line needs a tax code or an explicit exemption', 409)
  const statements = [periodOpen(p.issueDate),
    q("INSERT INTO pt_invoices (id,kind,number,customer_id,issue_date,due_date,status,memo,credit_for,subtotal_cents,tax_cents,total_cents,opening,prepared_by,revision,created_at,approved_by,approved_revision) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?)", id, kind, number, p.customer.id, p.issueDate, p.dueDate, post ? 'approved' : 'draft', p.memo, creditFor, p.subtotal, p.tax, p.total, c.actor.email, revision, now(), post ? c.actor.email : null, post ? revision : null),
    ...documentSelectionStatements(id, p), ...lineStatements(id, p.lines)]
  if (post) {
    const current = { id, kind, number, customer_id: p.customer.id, customer_name: p.customer.name, issue_date: p.issueDate, total_cents: p.total, credit_for: creditFor, revision,
      lines: p.lines.map(l => ({ account_id: l.accountId, amount_cents: l.amount, description: l.description, tax_code: l.taxCode, tax_cents: l.tax })) }
    statements.push(approval(who(c.actor), kind, id, revision, 'integration.post', 'approved', 'Owner delegated posting to this scoped credential'), ...(await issueStatements(c.db, current, who(c.actor), c.actor.email, p)).statements)
  } else statements.push(audit(who(c.actor), `${kind}.draft`, kind, id, { number, total: p.total }))
  return { id, kind: 'invoice', statements }
}

export async function prepareJournal(c: Context, b: Data): Promise<Prepared> {
  const day = date(b.date), memo = text(b.memo, 'Description', 500)
  await assertOpen(c.db, day)
  const lines = await parseLines(c.db, b.lines), id = uid(), revision = uid(), post = b.post === true
  const statements = [periodOpen(day), ...entryStatements({ id, date: day, memo, sourceKind: 'manual', preparedBy: c.actor.email, preparedKind: 'import', revision, lines }, post ? c.actor.email : undefined),
    audit(who(c.actor), post ? 'journal.post' : 'journal.draft', 'journal', id, { memo })]
  if (post) statements.push(approval(who(c.actor), 'journal', id, revision, 'integration.post', 'approved', 'Owner delegated posting to this scoped credential'))
  return { id, kind: 'journal', statements }
}

export async function prepareReadiness(c: Context, b: Data, id: string): Promise<Prepared> {
  requireThat(typeof b.received === 'boolean' && typeof b.readyToPay === 'boolean', 'Send received and readyToPay as true or false')
  requireThat(!b.readyToPay || b.received, 'Receive the goods before marking the bill ready to pay')
  const current = await bill(c.db, id)
  requireThat(current.status === 'posted', 'Only a posted bill can be marked received or ready to pay', 409)
  await assertOpen(c.db, current.bill_date)
  return { id, kind: 'bill', statements: [periodOpen(current.bill_date),
    q("UPDATE pt_bills SET received = ?,ready_to_pay = ?,revision = ? WHERE id = ? AND revision = ? AND status = 'posted'", +b.received, +b.readyToPay, uid(), id, current.revision), changed(),
    audit(who(c.actor), 'bill.readiness', 'bill', id, { received: b.received, readyToPay: b.readyToPay })] }
}

export async function prepareDocument(c: Context, b: Data): Promise<Prepared> {
  const prepared = await documentStatements(c, b)
  const table = { bill: ['pt_bills', 'bill_date'], invoice: ['pt_invoices', 'issue_date'], journal: ['pt_journal_entries', 'entry_date'], payment: ['pt_payments', 'payment_date'], statement: ['pt_statements', 'end_date'] }[String(b.linkedKind)]
  if (table) {
    const row = await one(c.db, `SELECT ${table[1]} AS day FROM ${table[0]} WHERE id = ?`, b.linkedId)
    requireThat(row, 'Linked record not found', 404)
    await assertOpen(c.db, row.day)
    prepared.statements.unshift(periodOpen(row.day))
  }
  return { ...prepared, kind: 'document' }
}
