import { pantry } from '../access'
import { now, requireThat, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import { reverseEarlyDiscounts } from '../early-payment'
import { refundOutcome } from '../refunds/posting'
import { stripeCall } from '../stripe-api'
import { accountFence, amount, objectId, providerDay, safe, type EventContext } from './provider'
import type { CompleteEvent } from './returns'

const journalOf = '(SELECT journal_id FROM pt_customer_refunds WHERE id=?)'

/** Release only the part Stripe actually refunded, consuming unapplied money first. */
async function releaseAllocations(c: EventContext, row: Data, refund: Data) {
  const allocations = await all(c.db, "SELECT * FROM pt_allocations WHERE source_kind='payment' AND source_id=? AND voided_by IS NULL ORDER BY created_at DESC,id DESC", row.payment_id)
  const payment = await one(c.db, 'SELECT * FROM pt_payments WHERE id=?', row.payment_id)
  requireThat(payment && !payment.reversal_id, 'Refund source payment was reversed; reconcile this provider refund', 409)
  const reserved = Number((await one(c.db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_customer_refunds WHERE source_kind='payment' AND source_id=? AND id<>? AND status IN ('approved','pending','succeeded')", row.payment_id, refund.id))?.n ?? 0)
  const used = allocations.reduce((n, a) => n + Number(a.amount_cents), 0)
  let remove = Math.max(0, refund.amount_cents - (payment.amount_cents - reserved - used))
  requireThat(remove <= used, 'Stripe refunds exceed the original receipt; reconcile this payment', 409)
  const removed = new Map<string, number>(), writes: Sql[] = [], day = refund.refund_date, by = pantry('stripe')
  for (const allocation of allocations) {
    if (!remove) break
    requireThat(allocation.target_kind === 'invoice', 'Customer refund source contains a non-invoice allocation', 409)
    const cents = Math.min(remove, allocation.amount_cents), left = allocation.amount_cents - cents
    if (allocation.early_counted) removed.set(allocation.target_id, (removed.get(allocation.target_id) ?? 0) + cents)
    // The new refund journal is inserted by refundOutcome before these statements.
    writes.push(q(`UPDATE pt_allocations SET voided_on=?,voided_by=(SELECT id FROM pt_journal_entries WHERE source_kind='bank' AND source_id=? AND status='posted') WHERE id=? AND voided_by IS NULL`, day, refund.id, allocation.id), changed())
    if (left) writes.push(q(`INSERT INTO pt_allocations(id,source_kind,source_id,target_kind,target_id,amount_cents,allocation_date,created_by,created_at,early_counted) VALUES(?,'payment',?,'invoice',?,?,?,?,?,?)`, uid(), row.payment_id, allocation.target_id, left, day, by.email, now(), allocation.early_counted))
    remove -= cents
  }
  return [guard('EXISTS(SELECT 1 FROM pt_payments WHERE id=? AND reversal_id IS NULL)', row.payment_id),
    ...await reverseEarlyDiscounts(c.db, by, row.payment_id, day, `Stripe refund ${refund.provider_id} removed a counted payment`, removed), ...writes]
}

async function ownership(c: EventContext, outcome: Data, refund: Data): Promise<Sql[]> {
  if (outcome.status !== 'succeeded') return []
  const btId = objectId(outcome.balance_transaction)
  requireThat(btId, 'Stripe refund has no balance transaction yet; compare it again after settlement', 409)
  const bt = await stripeCall(c.key, 'GET', `/balance_transactions/${encodeURIComponent(btId)}`)
  requireThat(bt.currency === 'usd' && bt.amount === -refund.amount_cents, 'Stripe refund balance differs from its USD amount', 409)
  const item = await one(c.db, 'SELECT entry_id FROM pt_stripe_clearing_items WHERE id=? AND entry_id IS NOT NULL', btId)
  requireThat(!item || item.entry_id === refund.journal_id, 'This refund was already imported; reconcile the existing Stripe journal before posting it to the invoice', 409)
  return [guard(`NOT EXISTS(SELECT 1 FROM pt_stripe_clearing_items WHERE id=? AND entry_id IS NOT NULL AND entry_id IS NOT ${journalOf})`, btId, refund.id),
    q(`INSERT INTO pt_stripe_event_movements(account_id,balance_transaction,source_id,kind,amount_cents,refund_id) VALUES(?,?,?,'refund',?,?) ON CONFLICT(account_id,balance_transaction) DO NOTHING`, c.settings.account_id, btId, outcome.id, -refund.amount_cents, refund.id),
    guard('EXISTS(SELECT 1 FROM pt_stripe_event_movements WHERE account_id=? AND balance_transaction=? AND refund_id=? AND amount_cents=?)', c.settings.account_id, btId, refund.id, -refund.amount_cents)]
}

/** Provider-side refunds are recorded facts. This path never asks Stripe to move money. */
export async function recordRefund(c: EventContext, row: Data | null, charge: Data, outcome: Data, completeStatements: (sessionId?: string) => Sql[], finish: CompleteEvent) {
  const cents = amount(outcome.amount), intent = objectId(charge.payment_intent)
  requireThat(outcome.currency === 'usd' && objectId(outcome.charge) === charge.id && (!outcome.payment_intent || objectId(outcome.payment_intent) === intent), 'Stripe refund does not match its charge', 409)
  const metadataId = outcome.metadata?.pantry_refund
  let refund = await one(c.db, 'SELECT * FROM pt_customer_refunds WHERE provider_id=? OR id=?', outcome.id, String(metadataId ?? ''))
  if (metadataId) requireThat(refund && refund.id === metadataId, 'Stripe refund names an unknown Pantry refund; reconcile its identity', 409)
  if (refund) {
    requireThat(refund.method === 'stripe' && refund.provider_account === c.settings.account_id && refund.payment_intent === intent && (!refund.provider_id || refund.provider_id === outcome.id) && refund.amount_cents === cents, 'Stripe refund differs from its retained Pantry instruction', 409)
    if (row) requireThat(refund.payment_id === row.payment_id, 'Stripe refund belongs to a different original receipt', 409)
  } else {
    if (!row) { await finish(); return }
    requireThat(row.payment_id && row.status !== 'returned', 'Stripe refund is waiting for its successful invoice receipt', 409)
    const payment = await one(c.db, 'SELECT * FROM pt_payments WHERE id=?', row.payment_id)
    requireThat(payment && !payment.reversal_id && cents <= payment.amount_cents, 'Stripe refund source is no longer an unreversed customer payment', 409)
    const id = uid(), day = providerDay(outcome.created), reason = `Refund issued in Stripe: ${safe(outcome.reason ?? 'provider refund')}`
    await run(c.db, [accountFence(c), q(`INSERT INTO pt_customer_refunds(id,source_kind,source_id,customer_id,invoice_id,payment_id,amount_cents,refund_date,bank_account_id,method,reason,status,revision,prepared_by,approved_by,provider_account,provider_id,provider_status,provider_created,payment_intent,created_at,updated_at)
      VALUES(?,'payment',?,?,?,?,?,?,?,'stripe',?,'pending',?,?,?,?,?,?,?,?,?,?)`, id, row.payment_id, payment.contact_id, row.invoice_id, row.payment_id, cents, day, payment.bank_account_id, reason, uid(), pantry('stripe').email, pantry('stripe').email, c.settings.account_id, outcome.id, outcome.status, outcome.created, intent, now(), now()),
    audit(pantry('stripe'), 'stripe.refund-observed', 'invoice', row.invoice_id, { refundId: id, providerId: outcome.id, amount: cents })])
    refund = (await one(c.db, 'SELECT * FROM pt_customer_refunds WHERE id=?', id))!
  }
  const statusWrites: Sql[] = row ? [q(`UPDATE pt_stripe_payments SET refunded_cents=(SELECT COALESCE(SUM(amount_cents),0) FROM pt_customer_refunds WHERE payment_id=? AND status='succeeded')+?,charge_id=?,updated_at=? WHERE id=?`, row.payment_id, outcome.status === 'succeeded' && refund.status !== 'succeeded' ? cents : 0, charge.id, now(), row.id),
    q("UPDATE pt_stripe_payments SET status=CASE WHEN refunded_cents>=amount_cents THEN 'refunded' ELSE status END WHERE id=? AND status NOT IN ('returned','disputed')", row.id)] : []
  if (['succeeded','failed','canceled'].includes(refund.status)) {
    requireThat(refund.status === outcome.status, 'Stripe changed a terminal refund outcome; reconcile the refund and its retained journal', 409)
    await finish([accountFence(c), ...await ownership(c, outcome, refund), ...statusWrites], row?.id)
    return
  }
  const release = outcome.status === 'succeeded' && refund.source_kind === 'payment' && row ? await releaseAllocations(c, row, refund) : []
  // refundOutcome commits the journal first, these release/ownership/event statements,
  // then its status update. A retry can never expose a refund without its correction.
  const posted = await refundOutcome(c.db, refund.id, outcome, [accountFence(c), ...release, ...await ownership(c, outcome, refund), ...statusWrites, ...completeStatements(row?.id)])
  // A person can finish an approved refund between our read and refundOutcome's
  // read. Its terminal fast path then has no extras to commit; retain our event
  // and ownership without adding the refund amount to the payment twice.
  const marker = await one(c.db, 'SELECT status FROM pt_stripe_events WHERE account_id=? AND id=?', c.settings.account_id, c.event.id)
  if (marker && ['pending','held'].includes(marker.status) && ['succeeded','failed','canceled'].includes(posted.status)) {
    requireThat(posted.status === outcome.status, 'Stripe refund changed while its outcome was being recorded; reconcile its retained journal', 409)
    await finish([accountFence(c), ...await ownership(c, outcome, posted), ...(row ? [q("UPDATE pt_stripe_payments SET refunded_cents=(SELECT COALESCE(SUM(amount_cents),0) FROM pt_customer_refunds WHERE payment_id=? AND status='succeeded') WHERE id=?", row.payment_id, row.id), q("UPDATE pt_stripe_payments SET status='refunded' WHERE id=? AND refunded_cents>=amount_cents AND status NOT IN ('returned','disputed')", row.id)] : [])], row?.id)
  }
}
