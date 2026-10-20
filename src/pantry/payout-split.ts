// Payout itemization is a provider summary. Recognition belongs to individual
// balance transactions; this summary never supplies journal posting lines.
import type { Data } from './core'

export type Split = {
  ok: boolean; reason: string; currency: string
  /** Amounts in the payout's currency, cents. */
  net: number; gross: number; invoiced: number; fees: number; refunds: number; charges: number; refundCount: number
}

const REFUNDS = new Set(['refund', 'refund_failure', 'payment_refund', 'payment_failure_refund', 'dispute', 'dispute_reversal', 'partial_capture_reversal'])
const FEES = new Set(['fee', 'stripe_fee', 'stripe_fx_fee', 'fee_refund'])
const PAYOUTS = new Set(['payout', 'payout_cancel', 'payout_failure', 'payout_reversal'])
const intentOf = (bt: Data) => typeof bt.source === 'object' && bt.source ? (typeof bt.source.payment_intent === 'object' ? bt.source.payment_intent?.id : bt.source.payment_intent) ?? null : null

export function splitPayout(payout: Data, transactions: Data[], recorded: ReadonlyMap<string, unknown> | ReadonlySet<string>): Split {
  const currency = String(payout.currency ?? '').toLowerCase()
  const s: Split = { ok: false, reason: '', currency, net: Number(payout.amount), gross: 0, invoiced: 0, fees: 0, refunds: 0, charges: 0, refundCount: 0 }
  if (!payout.automatic) return { ...s, reason: 'Stripe itemizes only automatic payouts. Review this manual payout as a transfer from Stripe balance.' }
  let itemized = 0
  const reasons: string[] = []
  for (const bt of transactions) {
    const category = String(bt.reporting_category ?? bt.type), type = String(bt.type)
    if (PAYOUTS.has(category) || PAYOUTS.has(type)) continue
    if (String(bt.currency).toLowerCase() !== currency) reasons.push(`Stripe item ${bt.id} is in ${String(bt.currency).toUpperCase()}, not the payout's ${currency.toUpperCase()}.`)
    const amount = Number(bt.amount), fee = Number(bt.fee ?? 0), net = Number(bt.net)
    if (![amount, fee, net].every(Number.isSafeInteger) || amount - fee !== net) { reasons.push(`Stripe item ${bt.id} has invalid amounts.`); continue }
    itemized += net
    if (category === 'charge' || type === 'charge' || type === 'payment') {
      s.charges++; s.gross += amount; s.fees += fee
      const intent = intentOf(bt)
      if (intent && recorded.has(intent)) s.invoiced += amount
    } else if (REFUNDS.has(category) || REFUNDS.has(type)) {
      if (category.startsWith('refund') || type.includes('refund') || category === 'partial_capture_reversal') s.refundCount++
      s.refunds -= amount; s.fees += fee
    } else if (FEES.has(category) || FEES.has(type)) s.fees -= net
    else reasons.push(`Stripe item ${bt.id} is a ${category.replace(/_/g, ' ')}; review this unsupported item.`)
  }
  if (itemized !== s.net) reasons.push(`Stripe's items add up to ${(itemized / 100).toFixed(2)} but the payout is ${(s.net / 100).toFixed(2)}; review the provider inventory.`)
  return { ...s, ok: reasons.length === 0, reason: reasons.join(' ') }
}
