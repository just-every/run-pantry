import { requireThat } from '../core'
import { all, one } from '../db'

/** The same readback for a new payment, an idempotent replay and recovery reads. */
export async function payment(db: D1Database, id: string) {
  const row = await one(db, 'SELECT * FROM pt_payments WHERE id = ?', id)
  requireThat(row, 'Payment not found', 404)
  row.allocations = await all(db, "SELECT * FROM pt_allocations WHERE source_kind = 'payment' AND source_id = ? ORDER BY id", id)
  return row
}
