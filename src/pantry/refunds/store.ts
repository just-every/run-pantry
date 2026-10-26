import { requireThat, type Data } from '../core'
import { all, one } from '../db'

export const RESERVED = "('approved','pending','succeeded')"
export async function refunded(db: D1Database, kind: string, id: string, asOf?: string, reserved = true) {
  return Number((await one(db, `SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_customer_refunds WHERE source_kind=? AND source_id=? AND status IN ${reserved ? RESERVED : "('succeeded')"}${asOf ? ' AND refund_date<=?' : ''}`, kind, id, ...(asOf ? [asOf] : [])))?.n ?? 0)
}
export async function refund(db: D1Database, id: string) {
  const row = await one(db, 'SELECT r.*, c.name AS customer_name, b.name AS bank_name FROM pt_customer_refunds r JOIN pt_contacts c ON c.id=r.customer_id JOIN pt_bank_accounts b ON b.id=r.bank_account_id WHERE r.id=?', id)
  requireThat(row, 'Refund not found', 404)
  return row
}
export async function refundSource(db: D1Database, kind: string, id: string) {
  const row: Data | null = kind === 'payment'
    ? await one(db, "SELECT p.*, p.contact_id AS customer_id, p.amount_cents AS total_cents FROM pt_payments p WHERE p.id=? AND p.direction='received' AND p.reversal_id IS NULL AND p.customer_deposit_id IS NULL", id)
    : await one(db, "SELECT * FROM pt_invoices WHERE id=? AND kind='credit' AND status='issued' AND early_reversal_id IS NULL", id)
  requireThat(row, 'Choose a current customer payment or issued credit', 409)
  const used = Number((await one(db, 'SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_allocations WHERE source_kind=? AND source_id=? AND voided_by IS NULL', kind, id))?.n ?? 0)
  let available = row.total_cents - used - await refunded(db, kind, id)
  if (kind === 'credit') {
    const paid = Number((await one(db, "SELECT COALESCE(SUM(a.amount_cents),0) AS n FROM pt_allocations a JOIN pt_payments p ON p.id=a.source_id WHERE a.source_kind='payment' AND a.target_kind='invoice' AND a.target_id=? AND a.voided_by IS NULL AND p.reversal_id IS NULL", row.credit_for))?.n ?? 0)
    const returned = Number((await one(db, `SELECT COALESCE(SUM(r.amount_cents),0) AS n FROM pt_customer_refunds r JOIN pt_invoices i ON i.id=r.source_id AND r.source_kind='credit' WHERE i.credit_for=? AND r.status IN ${RESERVED}`, row.credit_for))?.n ?? 0)
    available = Math.min(available, paid - returned)
  }
  return { row, available }
}
export const refundsView = (db: D1Database, customerId?: string) => all(db, `SELECT r.*, c.name AS customer_name, b.name AS bank_name FROM pt_customer_refunds r JOIN pt_contacts c ON c.id=r.customer_id JOIN pt_bank_accounts b ON b.id=r.bank_account_id ${customerId ? 'WHERE r.customer_id=?' : ''} ORDER BY r.created_at DESC,r.id`, ...(customerId ? [customerId] : []))
