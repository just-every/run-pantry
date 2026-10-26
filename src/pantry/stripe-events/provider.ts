import type { Bindings } from '../../auth.server'
import { requireThat, type Data } from '../core'
import { guard, one, type Sql } from '../db'
import { stripeCall } from '../stripe-api'
import { syncCheckout } from '../stripe'

export type EventContext = { env: Bindings; db: D1Database; settings: Data; key: string; event: Data }
export const objectId = (v: unknown): string | null => typeof v === 'string' ? v : v && typeof v === 'object' && 'id' in v ? String(v.id) : null
export const safe = (v: unknown, length = 300) => String(v ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ').replace(/\d{8,}/g, '[redacted]').slice(0, length)
export function providerDay(epoch: unknown) {
  requireThat(Number.isSafeInteger(epoch) && Number(epoch) > 0, 'Stripe event has no valid provider date', 409)
  return new Date(Number(epoch) * 1000).toISOString().slice(0, 10)
}
export function amount(value: unknown) {
  requireThat(Number.isSafeInteger(value) && Number(value) > 0, 'Stripe returned an invalid payment amount', 409)
  return Number(value)
}
export const accountFence = (c: EventContext) => guard('EXISTS(SELECT 1 FROM pt_stripe WHERE id=1 AND account_id=? AND revision=?)', c.settings.account_id, c.settings.revision)

/** Resolve the exact provider intent to a locally-created session, never by invoice alone. */
export async function paymentForIntent(c: EventContext, intent: string | null) {
  if (!intent) return null
  let row = await one(c.db, 'SELECT * FROM pt_stripe_payments WHERE payment_intent=?', intent)
  if (row) return row
  const sessions = await stripeCall(c.key, 'GET', '/checkout/sessions', { payment_intent: intent, limit: 100 })
  requireThat(Array.isArray(sessions.data) && sessions.has_more === false, 'Stripe session lookup is incomplete', 409)
  for (const session of sessions.data) {
    const local = await one(c.db, 'SELECT * FROM pt_stripe_payments WHERE id=?', objectId(session))
    if (!local) continue
    await syncCheckout(c.env, c.db, local.id)
    row = await one(c.db, 'SELECT * FROM pt_stripe_payments WHERE id=? AND payment_intent=?', local.id, intent)
    if (row) return row
  }
  return null
}

export async function readCharge(c: EventContext, value: unknown) {
  const id = objectId(value)
  requireThat(id, 'Stripe event has no charge identity', 409)
  return stripeCall(c.key, 'GET', `/charges/${encodeURIComponent(id)}`, { expand: ['balance_transaction'] })
}

/** Money already imported generically cannot be booked again as an invoice movement. */
export async function movementStatements(c: EventContext, sourceId: string, balance: unknown, kind: 'return' | 'refund', cents: number, entryId: string): Promise<Sql[]> {
  const id = objectId(balance)
  requireThat(id, 'Stripe has not exposed the balance transaction yet; compare again after it is available', 409)
  const bt = await stripeCall(c.key, 'GET', `/balance_transactions/${encodeURIComponent(id)}`)
  requireThat(bt.currency === 'usd' && bt.amount === -cents, 'Stripe balance movement differs from the invoice payment movement', 409)
  const existing = await one(c.db, 'SELECT entry_id FROM pt_stripe_clearing_items WHERE id=? AND entry_id IS NOT NULL', id)
  requireThat(!existing || existing.entry_id === entryId, 'Stripe movement was already imported; reconcile its existing journal before updating this invoice', 409)
  return [guard('NOT EXISTS(SELECT 1 FROM pt_stripe_clearing_items WHERE id=? AND entry_id IS NOT NULL AND entry_id<>?)', id, entryId),
    qMovement(c.settings.account_id, id, sourceId, kind, cents, entryId)]
}
const qMovement = (account: string, id: string, source: string, kind: string, cents: number, entry: string): Sql => ({
  sql: 'INSERT INTO pt_stripe_event_movements(account_id,balance_transaction,source_id,kind,amount_cents,entry_id) VALUES(?,?,?,?,?,?)',
  params: [account, id, source, kind, -cents, entry],
})

/** Persist only the safe method labels the payer can recognize. */
export function methodDetail(charge: Data, payerEmail?: unknown) {
  const detail = charge.payment_method_details ?? {}, method = detail[detail.type] ?? {}
  return { brand: safe(method.brand, 60), bank: safe(method.bank_name, 100), last4: /^\d{4}$/.test(String(method.last4 ?? '')) ? String(method.last4) : '', payerEmail: safe(payerEmail ?? charge.billing_details?.email, 254) }
}

