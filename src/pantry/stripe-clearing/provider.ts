import type { Data } from '../core'
import { stripeCall } from '../stripe-api'

export const dayOf = (epoch: number) => new Date(epoch * 1000).toISOString().slice(0, 10)
export const objectId = (value: unknown): string | null => typeof value === 'string' ? value : value && typeof value === 'object' && 'id' in value ? String(value.id) : null
export const sourceOf = (bt: Data): Data | null => bt.source && typeof bt.source === 'object' ? bt.source : null
export const intentOf = (bt: Data) => objectId(sourceOf(bt)?.payment_intent)
export const categoryOf = (bt: Data) => String(bt.reporting_category ?? bt.type)
export const isPayout = (bt: Data) => ['payout', 'payout_cancel', 'payout_failure'].includes(String(bt.type)) || ['payout', 'payout_reversal'].includes(categoryOf(bt))

/** Bounded enumeration explicitly reports truncation and malformed/repeated cursors. */
export async function listAll(key: string, path: string, params: Data = {}) {
  const items: Data[] = [], cursors = new Set<string>()
  let after: string | null = null
  for (let page = 0; page < 100; page++) {
    let r: Data
    try { r = await stripeCall(key, 'GET', path, { limit: 100, ...params, ...(after ? { starting_after: after } : {}) }) }
    catch (error) { return { items, complete: false, reason: `Stripe ${path} inventory is incomplete: ${error instanceof Error ? error.message : 'provider request failed'}` } }
    if (!Array.isArray(r.data) || typeof r.has_more !== 'boolean') return { items, complete: false, reason: `Stripe returned an invalid list for ${path}; the provider inventory is incomplete.` }
    items.push(...r.data)
    if (!r.has_more) return { items, complete: true, reason: '' }
    const cursor = objectId(r.data.at(-1))
    if (!cursor || cursors.has(cursor)) return { items, complete: false, reason: `Stripe ${path} pagination did not advance; the provider inventory is incomplete.` }
    cursors.add(cursor); after = cursor
  }
  return { items, complete: false, reason: `Stripe ${path} exceeded 100 pages; the provider inventory is incomplete.` }
}

export function balanceCents(balance: Data): number | null {
  if (!Array.isArray(balance.available) || !Array.isArray(balance.pending)) return null
  let cents = 0
  for (const item of [...balance.available, ...balance.pending]) {
    if (item.currency !== 'usd') continue
    if (!Number.isSafeInteger(item.amount)) return null
    cents += item.amount
  }
  return Number.isSafeInteger(cents) ? cents : null
}
