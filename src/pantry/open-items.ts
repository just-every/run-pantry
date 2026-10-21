// What makes an open item open as of a date: the allocations counted against
// each invoice or bill, and the money received, paid or credited but not yet
// applied. Ageing sums these rows; its drill-through lists them.
import { all } from './db'
import type { Data } from './core'

type Kind = 'receivable' | 'payable'
const live = (p = 'p') => `(${p}.reversal_id IS NULL OR EXISTS (SELECT 1 FROM pt_journal_entries r WHERE r.id = ${p}.reversal_id AND r.entry_date > ?))`

/** Allocations counted against open items as of a date (a reversed payment or voided credit stops counting from its date). */
export const appliedAsOf = (db: D1Database, kind: Kind, asOf: string) => all(db, `SELECT a.id, a.source_kind, a.source_id, a.target_id, a.amount_cents, a.allocation_date FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
  WHERE a.target_kind = ? AND a.allocation_date <= ? AND (a.source_kind = 'credit' OR ${live()}) AND (a.voided_on IS NULL OR a.voided_on > ?) ORDER BY a.allocation_date, a.created_at, a.id`, kind === 'receivable' ? 'invoice' : 'bill', asOf, asOf, asOf)

/** Signed rows whose sum is the unapplied money: payments and credits in, their applications out. */
export async function unappliedRows(db: D1Database, kind: Kind, asOf: string): Promise<Data[]> {
  const direction = kind === 'receivable' ? 'received' : 'paid'
  const payments = (await all(db, `SELECT p.id, p.payment_date AS date, p.amount_cents, p.reference FROM pt_payments p WHERE p.direction = ? AND p.payment_date <= ? AND ${live()} ORDER BY p.payment_date, p.id`, direction, asOf, asOf))
    .map(p => ({ part: 'payment', id: p.id, date: p.date, amount: p.amount_cents, record: { kind: 'payment', id: p.id }, note: p.reference }))
  const applied = (await all(db, `SELECT a.id, a.source_id, a.target_id, a.allocation_date AS date, a.amount_cents FROM pt_allocations a JOIN pt_payments p ON p.id = a.source_id
    WHERE a.source_kind = 'payment' AND p.direction = ? AND a.allocation_date <= ? AND ${live()} ORDER BY a.allocation_date, a.id`, direction, asOf, asOf))
    .map(a => ({ part: 'payment-applied', id: a.id, date: a.date, amount: -a.amount_cents, record: { kind: 'payment', id: a.source_id }, target: a.target_id }))
  const credits = kind === 'receivable'
    ? (await all(db, `SELECT i.id, i.issue_date AS date, i.total_cents FROM pt_invoices i WHERE i.kind = 'credit' AND i.status = 'issued' AND i.issue_date <= ? AND (i.early_reversal_id IS NULL OR (SELECT r.entry_date FROM pt_journal_entries r WHERE r.id = i.early_reversal_id) > ?) ORDER BY i.issue_date, i.id`, asOf, asOf))
      .map(c => ({ part: 'credit', id: c.id, date: c.date, amount: c.total_cents, record: { kind: 'invoice', id: c.id } }))
    : (await all(db, 'SELECT v.id, v.credit_date AS date, v.amount_cents, v.journal_id FROM pt_vendor_credits v WHERE v.credit_date <= ? ORDER BY v.credit_date, v.id', asOf))
      .map(c => ({ part: 'credit', id: c.id, date: c.date, amount: c.amount_cents, record: { kind: 'entry', id: c.journal_id } }))
  const creditApplied = (await all(db, kind === 'receivable'
    ? "SELECT a.id, a.source_id, a.target_id, a.allocation_date AS date, a.amount_cents FROM pt_allocations a WHERE a.source_kind = 'credit' AND a.target_kind = 'invoice' AND a.allocation_date <= ? AND (a.voided_on IS NULL OR a.voided_on > ?) ORDER BY a.allocation_date, a.id"
    : "SELECT a.id, a.source_id, a.target_id, a.allocation_date AS date, a.amount_cents, v.journal_id FROM pt_allocations a LEFT JOIN pt_vendor_credits v ON v.id = a.source_id WHERE a.source_kind = 'credit' AND a.target_kind = 'bill' AND a.allocation_date <= ? ORDER BY a.allocation_date, a.id", ...(kind === 'receivable' ? [asOf, asOf] : [asOf])))
    .map(a => ({ part: 'credit-applied', id: a.id, date: a.date, amount: -a.amount_cents, record: kind === 'receivable' ? { kind: 'invoice', id: a.source_id } : { kind: 'entry', id: a.journal_id }, target: a.target_id }))
  return [...payments, ...applied, ...credits, ...creditApplied]
}
