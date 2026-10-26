import { authorityCondition } from '../access'
import { assertDoor, financialSourceAllowed } from '../access-policy/doors'
import type { Context } from '../context'
import { date, monthBounds, requireThat, type Data } from '../core'
import { all, one } from '../db'
import { appliedAsOf } from '../open-items'
import { entryDocuments } from '../receipts/attachments'
import { ageing, prevDay, trialBalance } from '../reports'
import { requireEntity } from '../settings'
import { yearBounds } from '../year-end-checks'
import type { ExportOptions, Snapshot } from './types'

export async function exportAuthority(c: Context) {
  const actor = c.actor
  requireThat(actor.kind === 'person' && ['owner', 'accountant'].includes(actor.role), 'Only the owner or accountant may export books to another accounting system', 403)
  requireThat(financialSourceAllowed(actor, 'trial-balance') && !actor.policy?.maskTin && !actor.policy?.maskBank, 'Destination exports require unmasked access to all financial records', 403)
  await assertDoor(c, '/api/pantry/package/portability')
  const condition = authorityCondition(actor, 'read')
  requireThat(await one(c.db, `SELECT 1 WHERE ${condition.sql}`, ...condition.params), 'Financial export authority changed; sign in again', 403)
}

export async function readSnapshot(c: Context, options: ExportOptions): Promise<Snapshot> {
  await exportAuthority(c)
  requireThat(['qbo', 'xero'].includes(options.destination), 'Choose QuickBooks Online or Xero')
  const entity = await requireEntity(c.db)
  requireThat(options.year !== undefined || options.asOf !== undefined, 'Choose a closed fiscal year')
  const day = options.asOf === undefined ? undefined : date(options.asOf, 'Export date')
  const bounds = yearBounds(options.year ?? Number(day!.slice(0, 4)), Number(entity.fiscal_year_start))
  requireThat(!day || day === bounds.end, `Choose the fiscal year-end date ${bounds.end}`)
  requireThat(entity.books_start <= bounds.end, 'The selected year precedes these books')
  const periods = await all(c.db, 'SELECT * FROM pt_periods WHERE start_date <= ? AND end_date >= ? ORDER BY id', bounds.end, bounds.start)
  // Only the selected fiscal year's operating months need be closed. Prior history is
  // retained for the opening balance and fenced by posted-entry revisions on release.
  let month = (entity.books_start > bounds.start ? String(entity.books_start) : bounds.start).slice(0, 7)
  while (month <= bounds.finalPeriod) {
    const p = periods.find(p => p.id === month), expected = monthBounds(month)
    requireThat(p?.status === 'locked' && p.start_date === expected.start && p.end_date === expected.end, `Close ${month} before exporting this year`, 409)
    const next = new Date(`${month}-01T00:00:00Z`); next.setUTCMonth(next.getUTCMonth() + 1); month = next.toISOString().slice(0, 7)
  }
  const db = c.db, end = bounds.end
  const [accounts, contacts, items, entries, lines, invoices, invoiceLines, bills, billLines, payments, vendorCredits, banks, links, receivables, payables, opening, closing, arAllocations, apAllocations] = await Promise.all([
    all(db, 'SELECT * FROM pt_accounts ORDER BY code, id'),
    // Explicit allowlist: tax identities, bank credentials and invoice-link tokens never leave here.
    all(db, "SELECT id, kind, name, email, phone, address, billing_address, service_address, CASE WHEN kind='customer' THEN billing_address ELSE address END AS export_address, terms_days, external_ref, active, revision FROM pt_contacts ORDER BY kind, name, id"),
    all(db, 'SELECT * FROM pt_items ORDER BY name, id'),
    all(db, "SELECT id, number, entry_date, memo, source_kind, source_id, document_id, reverses_id, reversed_by_id, revision FROM pt_journal_entries WHERE status = 'posted' AND entry_date <= ? ORDER BY entry_date, number, id", end),
    all(db, "SELECT l.* FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id=l.entry_id WHERE e.status='posted' AND e.entry_date<=? ORDER BY e.entry_date, e.number, l.line_no", end),
    all(db, "SELECT id, kind, number, customer_id, issue_date, due_date, status, memo, total_cents, subtotal_cents, tax_cents, opening, journal_id, discount_cents, after_tax_discount_cents, discount_account_id, void_date, early_reversal_id, revision FROM pt_invoices WHERE status='issued' AND issue_date<=? ORDER BY issue_date, number, id", end),
    all(db, "SELECT l.* FROM pt_invoice_lines l JOIN pt_invoices i ON i.id=l.invoice_id WHERE i.status='issued' AND i.issue_date<=? ORDER BY i.issue_date, i.number, l.line_no", end),
    all(db, "SELECT id, vendor_id, reference, bill_date, due_date, status, memo, total_cents, opening, journal_id, revision FROM pt_bills WHERE (status='posted' OR opening=1 OR status='void') AND bill_date<=? ORDER BY bill_date, reference, id", end),
    all(db, "SELECT l.* FROM pt_bill_lines l JOIN pt_bills b ON b.id=l.bill_id WHERE (b.status='posted' OR b.opening=1 OR b.status='void') AND b.bill_date<=? ORDER BY b.bill_date, b.reference, l.line_no", end),
    all(db, "SELECT p.id,p.direction,p.contact_id,p.payment_date,p.amount_cents,p.bank_account_id,p.reference,p.memo,p.journal_id,p.reversal_id,p.method FROM pt_payments p JOIN pt_journal_entries e ON e.id=p.journal_id WHERE e.status='posted' AND p.payment_date<=? ORDER BY p.payment_date,p.id", end),
    all(db, "SELECT v.* FROM pt_vendor_credits v JOIN pt_journal_entries e ON e.id=v.journal_id WHERE e.status='posted' AND v.credit_date<=? ORDER BY v.credit_date,v.id", end),
    all(db, 'SELECT id,name,account_id,opening_date FROM pt_bank_accounts ORDER BY id'),
    entryDocuments(db), ageing(db, 'receivable', end), ageing(db, 'payable', end),
    trialBalance(db, prevDay(bounds.start)), trialBalance(db, end), appliedAsOf(db, 'receivable', end), appliedAsOf(db, 'payable', end),
  ])
  requireThat(closing.balanced && opening.balanced, 'Posted trial balance does not balance', 409)
  for (const e of entries) {
    const own = lines.filter(l => l.entry_id === e.id)
    requireThat(own.length > 1 && own.reduce((n,l) => n + l.debit_cents - l.credit_cents, 0) === 0, `Posted journal ${e.id} does not balance`, 409)
  }
  const ids = new Set(entries.flatMap(e => (links[e.id] ?? []).map(d => d.id)))
  const documents = (await all(db, 'SELECT id,name,media_type,size,sha256,linked_kind,linked_id,erased_at FROM pt_documents ORDER BY id')).filter(d => ids.has(d.id))
  const allocations: Data[] = [...arAllocations.map(a => ({ ...a, target_kind: 'invoice' })), ...apAllocations.map(a => ({ ...a, target_kind: 'bill' }))]
  return { entity, year: bounds.year, start: bounds.start, end, periods, accounts, contacts, items, entries, lines, invoices, invoiceLines, bills, billLines, payments, vendorCredits, banks, documents, entryDocuments: links, receivables, payables, opening, closing, allocations }
}
