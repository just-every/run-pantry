// How one Stripe payout splits, from the balance transactions Stripe says it
// paid out (https://docs.stripe.com/api/balance_transactions, `payout=`).
// Charges are gross sales and their fees; refunds and disputes reduce sales;
// Stripe's own fees are fees. A charge Pantry already recorded from an invoice
// link sits in the Stripe balance account, so the payout moves it out of there
// instead of booking the sale twice. The result is one balanced set of lines,
// or the plain reason Pantry leaves the payout for a person.
import type { Data } from './core'

/** What Pantry already booked for a payment made from an invoice link. */
export type Recorded = { feeBooked: boolean }

export type Split = {
  ok: boolean; reason: string; currency: string
  /** Amounts in the payout's currency, cents. */
  net: number; gross: number; invoiced: number; fees: number; refunds: number; charges: number; refundCount: number
  /** Signed amounts per role, debit positive; they sum to zero when ok. */
  lines: { bank: number; fees: number; refunds: number; sales: number; balance: number }
  /** Invoice-link payments whose fee this payout books (their own confirmation never did). */
  feesFor: { intent: string; fee: number }[]
}

const SALES = new Set(['charge'])
const REFUNDS = new Set(['refund', 'refund_failure', 'dispute', 'dispute_reversal', 'partial_capture_reversal'])

const intentOf = (bt: Data) => typeof bt.source === 'object' && bt.source ? (typeof bt.source.payment_intent === 'object' ? bt.source.payment_intent?.id : bt.source.payment_intent) ?? null : null

export function splitPayout(payout: Data, transactions: Data[], recorded: Map<string, Recorded>): Split {
  const currency = String(payout.currency ?? '').toLowerCase()
  const s: Split = { ok: false, reason: '', currency, net: Number(payout.amount), gross: 0, invoiced: 0, fees: 0, refunds: 0, charges: 0, refundCount: 0, lines: { bank: Number(payout.amount), fees: 0, refunds: 0, sales: 0, balance: 0 }, feesFor: [] }
  const hold = (reason: string) => ({ ...s, ok: false, reason })
  if (!payout.automatic) return hold('Stripe itemizes only automatic payouts. Record this manual payout by hand as a transfer from Stripe balance.')
  let itemized = 0
  for (const bt of transactions) {
    const category = String(bt.reporting_category ?? bt.type)
    if (category === 'payout' || bt.type === 'payout') continue
    if (String(bt.currency).toLowerCase() !== currency) return hold(`Stripe item ${bt.id} is in ${String(bt.currency).toUpperCase()}, not the payout's ${currency.toUpperCase()}.`)
    const amount = Number(bt.amount), fee = Number(bt.fee ?? 0)
    itemized += Number(bt.net)
    if (SALES.has(category)) {
      s.charges++; s.gross += amount; s.fees += fee
      const intent = intentOf(bt), known = intent ? recorded.get(intent) : undefined
      if (known) {
        // Already in Stripe balance from the invoice link: moved out, net of the fee it booked.
        s.invoiced += amount
        s.lines.balance -= known.feeBooked ? amount - fee : amount
        if (!known.feeBooked) { s.lines.fees += fee; s.feesFor.push({ intent: intent!, fee }) }
      } else { s.lines.sales -= amount; s.lines.fees += fee }
    } else if (REFUNDS.has(category)) {
      if (category.startsWith('refund') || category === 'partial_capture_reversal') s.refundCount++
      s.refunds -= amount; s.fees += fee
      s.lines.refunds -= amount; s.lines.fees += fee
    } else if (category === 'fee' || category === 'stripe_fee') {
      s.fees -= amount; s.lines.fees -= amount
    } else return hold(`Stripe item ${bt.id} is a ${category.replace(/_/g, ' ')}, which Pantry does not book by itself; book this payout by hand.`)
  }
  if (itemized !== s.net) return hold(`Stripe's items add up to ${(itemized / 100).toFixed(2)} but the payout is ${(s.net / 100).toFixed(2)}; book this payout by hand.`)
  const l = s.lines
  if (l.bank + l.fees + l.refunds + l.sales + l.balance !== 0) return hold('The split does not balance; book this payout by hand.')
  return { ...s, ok: true }
}
