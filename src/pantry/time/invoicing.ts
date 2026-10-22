// Unbilled hours join the customer's next new invoice using its real service
// item's current rate. The claim commits with the draft, so simultaneous
// drafts cannot invoice the same hours twice. Private time notes stay with
// time records rather than becoming immutable customer-facing journal text.
import { requireThat, type Data } from '../core'
import { all, changed, guard, q, type Sql } from '../db'
export async function invoiceTime(db: D1Database, body: Data) {
  if (body.id || body.kind === 'credit') return { body, claims: (_id: string): Sql[] => [] }
  const entries = await all(db, 'SELECT t.*, p.name AS project, i.name AS service, i.description, i.rate_cents, i.active, i.revision AS item_revision FROM pt_time_entries t JOIN pt_time_projects p ON p.id = t.project_id JOIN pt_items i ON i.id = t.item_id WHERE t.customer_id = ? AND t.invoice_id IS NULL ORDER BY t.work_date,t.created_at,t.id', String(body.customerId ?? ''))
  for (const t of entries) requireThat(t.active && t.rate_cents > 0, `Set an active billing rate for ${t.service} before invoicing its waiting hours`, 409)
  return { body: { ...body, lines: [...(body.lines ?? []), ...entries.map(t => ({ projectName:t.project,itemId: t.item_id, description: `${t.service} · ${t.project} · ${t.work_date}`, quantity: (Math.round(t.minutes * 1000 / 60) / 1000).toFixed(3) }))] },
    claims: (invoiceId: string): Sql[] => entries.flatMap(t => [guard('EXISTS (SELECT 1 FROM pt_items WHERE id = ? AND revision = ? AND active = 1)', t.item_id, t.item_revision), q('UPDATE pt_time_entries SET invoice_id = ? WHERE id = ? AND revision = ? AND invoice_id IS NULL', invoiceId, t.id, t.revision), changed()]) }
}
