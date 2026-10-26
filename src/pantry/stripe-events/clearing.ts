import { pantry } from '../access'
import { Fault, uid, type Data } from '../core'
import { audit, changed, guard, one, q, run, type Sql } from '../db'
import { processorDimensions } from '../dimensions/processor'
import { entryStatements } from '../journal'
import { hold } from '../stripe-clearing/store'

/** null means unowned; false means a known invoice movement is held for resolution. */
export async function adoptStripeEventMovement(db: D1Database, settings: Data, item: Data, balanceLedger: string): Promise<boolean | null> {
  let movement = await one(db, `SELECT m.*,COALESCE(m.entry_id,r.journal_id) AS owned_entry,r.status AS refund_status FROM pt_stripe_event_movements m LEFT JOIN pt_customer_refunds r ON r.id=m.refund_id WHERE m.account_id=? AND m.balance_transaction=?`, settings.account_id, item.id)
  // A Pantry-initiated refund may settle before its webhook is delivered.
  if (!movement && item.source_id) {
    const refund = await one(db, 'SELECT * FROM pt_customer_refunds WHERE provider_account=? AND provider_id=?', settings.account_id, item.source_id)
    if (refund) movement = { account_id: settings.account_id, balance_transaction: item.id, source_id: refund.provider_id, kind: 'refund', amount_cents: -refund.amount_cents, owned_entry: refund.journal_id, refund_status: refund.status, refund_id: refund.id }
  }
  if (!movement) return null
  const defer = async (reason: string) => { await hold(db, item.id, reason); return false }
  if (!movement.owned_entry) return defer('Waiting for the invoice refund to settle and post; this provider refund will not be booked twice.')
  const journal = await one(db, 'SELECT * FROM pt_journal_entries WHERE id=?', movement.owned_entry)
  if (!journal || journal.status !== 'posted' || journal.reversed_by_id) return defer('The linked invoice movement is missing, unposted or reversed; reconcile it before closing Stripe clearing.')
  if (item.currency !== 'usd' || item.amount_cents !== movement.amount_cents || item.net_cents !== item.amount_cents - item.fee_cents) return defer('Stripe movement differs from its linked invoice return or refund.')
  if (item.entry_id) return item.entry_id === movement.owned_entry
  if (!item.event_date) return defer('Stripe movement has no provider date.')
  const dimensions = await processorDimensions(db), by = pantry('stripe'), statements: Sql[] = [...dimensions.guards]
  let feeEntry: string | null = null
  if (item.fee_cents) {
    feeEntry = uid()
    const cents = Number(item.fee_cents)
    statements.push(...entryStatements({ id: feeEntry, date: item.event_date, memo: `Stripe ${movement.kind} fee ${item.id}`, sourceKind: 'bank', sourceId: item.id, preparedBy: by.email, preparedKind: 'import', lines: [
      { ...dimensions.coding('fees'), accountId: settings.fee_account_id, debit: Math.max(cents, 0), credit: Math.max(-cents, 0), memo: 'Stripe movement fee' },
      { ...dimensions.coding('clearing'), accountId: balanceLedger, debit: Math.max(-cents, 0), credit: Math.max(cents, 0), memo: 'Stripe movement fee' },
    ] }, by.email))
  }
  statements.push(guard('EXISTS(SELECT 1 FROM pt_journal_entries WHERE id=? AND status=\'posted\' AND reversed_by_id IS NULL)', movement.owned_entry),
    q(`INSERT INTO pt_stripe_event_movements(account_id,balance_transaction,source_id,kind,amount_cents,entry_id,refund_id) VALUES(?,?,?,?,?,?,?) ON CONFLICT(account_id,balance_transaction) DO NOTHING`, settings.account_id, item.id, movement.source_id, movement.kind, movement.amount_cents, movement.refund_id ? null : movement.owned_entry, movement.refund_id ?? null),
    q("UPDATE pt_stripe_clearing_items SET status='adopted',reason='',entry_id=?,fee_entry_id=? WHERE id=? AND entry_id IS NULL", movement.owned_entry, feeEntry, item.id), changed(),
    audit(by, 'stripe.clearing-adopt', 'stripe-item', item.id, { kind: movement.kind, entryId: movement.owned_entry, feeEntryId: feeEntry }))
  try { await run(db, statements); return true } catch (error) {
    if (!(error instanceof Fault)) throw error
    return defer(error.message)
  }
}
