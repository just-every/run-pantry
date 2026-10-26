// PAY-002: webhook, customer return and daily comparison share provider-authoritative
// settlement paths. Event identities are retained independently of ledger identities.
import type { Bindings } from '../auth.server'
import { Fault, now, requireThat, type Data } from './core'
import { audit, changed, one, q, run, type Sql } from './db'
import { pantry } from './access'
import { notifyPayment } from './payment-notices'
import { managedInstall, stripeCall, unseal } from './stripe-api'
import { stripeSettings, syncCheckout } from './stripe'
import { accountFence, methodDetail, objectId, paymentForIntent, readCharge, type EventContext } from './stripe-events/provider'
import { recordDispute, returnPayment, type CompleteEvent } from './stripe-events/returns'
import { recordRefund } from './stripe-events/refunds'

export { compareStripeEvents, stripeEventsView } from './stripe-events/comparison'
export { adoptStripeEventMovement } from './stripe-events/clearing'

export const STRIPE_PAYMENT_EVENTS = [
  'checkout.session.completed', 'checkout.session.async_payment_succeeded', 'checkout.session.async_payment_failed', 'checkout.session.expired',
  'payment_intent.processing', 'payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.succeeded', 'charge.failed',
  'charge.refunded', 'refund.created', 'refund.updated', 'refund.failed',
  'charge.dispute.created', 'charge.dispute.updated', 'charge.dispute.closed', 'charge.dispute.funds_withdrawn', 'charge.dispute.funds_reinstated',
]

async function notifyRecorded(env: Bindings, db: D1Database, record: Data | null) {
  if (!record?.notice_kind || !record.session_id) return
  const row = await one(db, 'SELECT status FROM pt_stripe_payments WHERE id=?', record.session_id)
  const valid = record.notice_kind === 'returned' ? row?.status === 'returned' : record.notice_kind === 'processing' ? row?.status === 'processing' : row?.status === 'succeeded'
  if (valid) await notifyPayment(env, db, record.session_id, record.notice_kind)
}

/** The signature is verified by the HTTP door. Even then, read the event and object back. */
export async function processStripeEvent(env: Bindings, db: D1Database, received: Data) {
  const id = String(received?.id ?? '')
  requireThat(/^evt_[A-Za-z0-9_]+$/.test(id), 'Stripe event identity is invalid', 400)
  const settings = await stripeSettings(db)
  requireThat(settings && !managedInstall(env), 'Stripe event cannot be read on this installation', 409)
  let saved = await one(db, 'SELECT * FROM pt_stripe_events WHERE account_id=? AND id=?', settings.account_id, id)
  if (saved && ['processed','ignored'].includes(saved.status)) { await notifyRecorded(env, db, saved); return saved }
  const key = await unseal(env, settings.key_sealed), event = await stripeCall(key, 'GET', `/events/${encodeURIComponent(id)}`)
  requireThat(event.id === id && typeof event.type === 'string' && Number.isSafeInteger(event.created) && event.created > 0 && event.data?.object?.id, 'Stripe returned an incomplete event', 409)
  requireThat(typeof event.livemode === 'boolean' && Number(event.livemode) === settings.livemode && (!event.account || event.account === settings.account_id), 'Stripe event belongs to a different account or mode', 409)
  const c: EventContext = { env, db, settings, key, event }
  await run(db, [accountFence(c), q(`INSERT INTO pt_stripe_events(account_id,id,type,provider_created,object_id,status,first_seen_at) VALUES(?,?,?,?,?,'pending',?) ON CONFLICT(account_id,id) DO NOTHING`, settings.account_id, id, event.type, event.created, event.data.object.id, now())])
  const completed = (sessionId?: string, notice?: 'processing' | 'receipt' | 'returned', ignored = false): Sql[] => [accountFence(c),
    q("UPDATE pt_stripe_events SET status=?,session_id=?,notice_kind=?,reason='',processed_at=? WHERE account_id=? AND id=? AND status IN ('pending','held')", ignored ? 'ignored' : 'processed', sessionId ?? null, notice ?? null, now(), settings.account_id, id), changed()]
  const finish: CompleteEvent = async (statements = [], sessionId, notice) => { await run(db, [...statements, ...completed(sessionId, notice)]) }
  try {
    if (!STRIPE_PAYMENT_EVENTS.includes(event.type)) await run(db, completed(undefined, undefined, true))
    else await dispatch(c, completed, finish)
  } catch (error) {
    saved = await one(db, 'SELECT * FROM pt_stripe_events WHERE account_id=? AND id=?', settings.account_id, id)
    // A concurrent delivery committed its linked movements and event marker first.
    if (!saved || !['processed','ignored'].includes(saved.status)) {
      const reason = error instanceof Fault ? error.message.slice(0, 500) : 'Stripe event could not be applied; compare again after the underlying provider or ledger issue is resolved'
      await run(db, [q("UPDATE pt_stripe_events SET status='held',reason=? WHERE account_id=? AND id=? AND status IN ('pending','held')", reason, settings.account_id, id)])
      throw error
    }
  }
  saved = await one(db, 'SELECT * FROM pt_stripe_events WHERE account_id=? AND id=?', settings.account_id, id)
  await notifyRecorded(env, db, saved)
  return saved
}

async function dispatch(c: EventContext, completed: (sessionId?: string) => Sql[], finish: CompleteEvent) {
  const { event, db, env } = c, type = event.type as string, object = event.data.object
  if (type.startsWith('checkout.session.')) {
    const row = await syncCheckout(env, db, object.id)
    if (!row) { await finish(); return }
    // syncCheckout reads the current expanded intent and persists payer details itself.
    await finish([], row.id, row.status === 'processing' ? 'processing' : row.status === 'succeeded' ? 'receipt' : undefined)
    return
  }
  if (type.startsWith('payment_intent.')) {
    const pi = await stripeCall(c.key, 'GET', `/payment_intents/${encodeURIComponent(object.id)}`, { expand: ['latest_charge'] })
    let row = await paymentForIntent(c, pi.id)
    if (!row) { await finish(); return }
    if (type === 'payment_intent.payment_failed' && row.method === 'us_bank_account' && row.payment_id) {
      const charge = await readCharge(c, pi.latest_charge ?? pi.last_payment_error?.charge)
      requireThat(pi.status !== 'succeeded' || charge.status === 'failed', 'Stripe has not confirmed this late payment failure', 409)
      await returnPayment(c, row, charge, finish)
    } else {
      row = await syncCheckout(env, db, row.id)
      await finish([], row!.id, row!.status === 'processing' ? 'processing' : row!.status === 'succeeded' ? 'receipt' : undefined)
    }
    return
  }
  if (type.startsWith('refund.')) {
    const outcome = await stripeCall(c.key, 'GET', `/refunds/${encodeURIComponent(object.id)}`), charge = await readCharge(c, outcome.charge)
    await recordRefund(c, await paymentForIntent(c, objectId(charge.payment_intent)), charge, outcome, completed, finish)
    return
  }
  if (type.startsWith('charge.dispute.')) {
    const dispute = await stripeCall(c.key, 'GET', `/disputes/${encodeURIComponent(object.id)}`, { expand: ['balance_transactions'] }), charge = await readCharge(c, dispute.charge)
    const row = await paymentForIntent(c, objectId(charge.payment_intent))
    if (!row) { await finish(); return }
    requireThat(row.payment_id, 'Stripe dispute is waiting for its original invoice receipt', 409)
    await recordDispute(c, row, charge, dispute, finish)
    return
  }
  const charge = await readCharge(c, object.id), row = await paymentForIntent(c, objectId(charge.payment_intent))
  if (type === 'charge.refunded') {
    // A charge can contain many refunds; each financial identity is independent.
    // Commit the event marker only after every page has been read and reconciled.
    let cursor: string | undefined
    const seen = new Set<string>()
    let complete = false
    for (let pageNumber = 0; pageNumber < 100; pageNumber++) {
      const page = await stripeCall(c.key, 'GET', '/refunds', { charge: charge.id, limit: 100, ...(cursor ? { starting_after: cursor } : {}) })
      requireThat(Array.isArray(page.data) && typeof page.has_more === 'boolean', 'Stripe refund inventory is incomplete', 409)
      for (const refund of page.data) {
        const outcome = await stripeCall(c.key, 'GET', `/refunds/${encodeURIComponent(refund.id)}`)
        await recordRefund(c, row, charge, outcome, () => [], async statements => { if (statements?.length) await run(db, statements) })
      }
      if (!page.has_more) { complete = true; break }
      const next = objectId(page.data.at(-1))
      requireThat(next && !seen.has(next), 'Stripe refund pagination did not advance', 409)
      seen.add(next); cursor = next
    }
    requireThat(complete, 'Stripe refund inventory exceeded the bounded scan; reconcile its retained refund identities', 409)
    await finish([], row?.id)
    return
  }
  if (!row) { await finish(); return }
  if (type === 'charge.failed' && row.method === 'us_bank_account' && row.payment_id) {
    requireThat(charge.status === 'failed', 'Stripe charge has not confirmed this failure', 409)
    await returnPayment(c, row, charge, finish)
  } else {
    const current = await syncCheckout(env, db, row.id), detail = methodDetail(charge)
    await finish([q("UPDATE pt_stripe_payments SET charge_id=?,method_brand=?,method_bank=?,method_last4=?,payer_email=CASE WHEN ?<>'' THEN ? ELSE payer_email END WHERE id=?", charge.id, detail.brand, detail.bank, detail.last4, detail.payerEmail, detail.payerEmail, row.id),
      audit(pantry('stripe'), 'stripe.status', 'invoice', row.invoice_id, { eventId: event.id, status: current?.status })], row.id, current?.status === 'processing' ? 'processing' : current?.status === 'succeeded' ? 'receipt' : undefined)
  }
}
