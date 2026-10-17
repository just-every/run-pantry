// The demo's Stripe payout: 23 card sales (workshop seats, brand audits and
// print sets) paid out together, as Stripe lists them for a payout
// (https://docs.stripe.com/api/balance_transactions). Pantry's own split books it.
import type { Data } from '../pantry/core'

const SALES = [...Array(13).fill(18500), ...Array(6).fill(32500), 14950, 14950, 14950, 15000]
const fee = (amount: number) => Math.round(amount * 0.029) + 30

export const PAYOUT_ID = 'po_1QJuniperLaneDemo'
export const payoutNet = SALES.reduce((s, a) => s + a - fee(a), 0)

export function demoPayout(arrival: string): { payout: Data; items: Data[] } {
  const items = SALES.map((amount, i) => ({ id: `txn_demo_${i + 1}`, type: 'charge', reporting_category: 'charge', amount, fee: fee(amount), net: amount - fee(amount), currency: 'usd', source: { id: `ch_demo_${i + 1}`, payment_intent: `pi_demo_${i + 1}` } }))
  return { payout: { id: PAYOUT_ID, amount: payoutNet, currency: 'usd', automatic: true, status: 'paid', arrival_date: Math.floor(Date.parse(`${arrival}T00:00:00Z`) / 1000) }, items }
}
