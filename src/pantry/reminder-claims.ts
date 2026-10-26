import { uid } from './core'
import { q, type Sql } from './db'

// A reminder is one invoice-wide batch, with its original billing recipients.
// A later contact or schedule edit cannot open another batch that day.
export const reminderEligible = `EXISTS (SELECT 1 FROM pt_invoices i WHERE i.id=? AND i.kind='invoice' AND i.status='issued' AND i.void_date IS NULL
 AND i.total_cents > COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON p.id=a.source_id AND a.source_kind='payment' WHERE a.target_kind='invoice' AND a.target_id=i.id AND (a.source_kind='credit' OR p.reversal_id IS NULL) AND a.voided_on IS NULL),0)
 AND NOT EXISTS (SELECT 1 FROM pt_stripe_payments sp WHERE sp.invoice_id=i.id AND (sp.status='processing' OR sp.disputed_cents>0))
 AND NOT EXISTS (SELECT 1 FROM pt_collection_cases cc WHERE cc.invoice_id=i.id AND cc.status IN ('disputed','stopped')))`

export type ReminderBatch = { id: string; day: string }
export function reminderBatchClaim(invoiceId: string, batch: ReminderBatch): Sql {
  return q(`INSERT INTO pt_reminder_batches(invoice_id,day,id) SELECT ?,?,? WHERE ${reminderEligible}`, invoiceId, batch.day, batch.id, invoiceId)
}
export async function claimReminderBatch(db: D1Database, invoiceId: string, day: string) {
  const batch = { id: uid(), day }, base = reminderBatchClaim(invoiceId, batch)
  const claim = q(base.sql + ' AND EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND sent_at IS NOT NULL AND reminders_paused=0)', ...base.params, invoiceId)
  try {
    const result = await db.prepare(claim.sql).bind(...claim.params).run()
    return result.meta.changes === 1 ? batch : null
  } catch (error) {
    if (/UNIQUE/.test(String((error as Error).message))) return null
    throw error
  }
}
