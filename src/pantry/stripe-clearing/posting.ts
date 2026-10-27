import { adoptStripeEventMovement } from '../stripe-events'
import { processorDimensions } from '../dimensions/processor'
import type { Bindings } from '../../auth.server'
import { pantry } from '../access'
import { Fault, now, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type Sql } from '../db'
import { entryStatements, type Line } from '../journal'
import { syncCheckout } from '../stripe'
import { categoryOf, intentOf, isPayout, sourceOf } from './provider'
import { hold } from './store'

const REFUNDS = new Set(['refund', 'refund_failure', 'payment_refund', 'payment_failure_refund', 'dispute', 'dispute_reversal', 'partial_capture_reversal'])
const FEES = new Set(['fee', 'stripe_fee', 'stripe_fx_fee', 'fee_refund'])
const signedLine = (accountId: string, signed: number, memo: string): Line => ({ accountId, debit: Math.max(signed, 0), credit: Math.max(-signed, 0), memo })

/** Confirm every unresolved local session, including sessions whose intent is not known yet. */
export async function confirmInvoices(env: Bindings, db: D1Database) {
  const errors: string[] = []
  for (const p of await all(db, "SELECT id FROM pt_stripe_payments WHERE status IN ('open', 'processing') OR (status = 'succeeded' AND fee_entry_id IS NULL)")) {
    try { await syncCheckout(env, db, p.id) } catch { errors.push(p.id) }
  }
  return errors
}

export async function postItem(db: D1Database, s: Data, bt: Data, balanceLedger: string, bankLedger: string, invoiceErrors: string[]) {
  const item = await one(db, 'SELECT * FROM pt_stripe_clearing_items WHERE id = ?', bt.id)
  if (!item || item.entry_id) return false
  const defer = async (reason: string) => { await hold(db, bt.id, reason); return false }
  if (item.currency !== 'usd') return defer(`Stripe item is in ${item.currency.toUpperCase()}; Pantry keeps US-dollar books.`)
  if (!item.event_date) return defer('Stripe item has no event creation time.')
  if (item.amount_cents - item.fee_cents !== item.net_cents) return defer('Stripe amount less fees does not equal its net amount.')
  const owned=await adoptStripeEventMovement(db,s,item,balanceLedger)
  if(owned!==null)return owned
  if(item.reason)return false
  const dimensions = await processorDimensions(db)
  const category = categoryOf(bt), source = sourceOf(bt), intent = intentOf(bt)
  const isCharge = category === 'charge' || bt.type === 'charge' || bt.type === 'payment'
  let payment: Data | null = null
  if (isCharge) {
    if (!source || !Object.hasOwn(source, 'payment_intent')) return defer('Stripe charge has no expanded payment intent; invoice overlap cannot be checked.')
    const terminal = intent ? await one(db,'SELECT * FROM pt_terminal_payments WHERE payment_intent=?',intent) : null
    if(terminal && !terminal.invoice_id) {
      if(terminal.status!=='succeeded' || !terminal.journal_id) return defer('Waiting for the Terminal receipt to be confirmed.')
      if(terminal.amount_cents!==item.amount_cents || terminal.fee_cents!==item.fee_cents)return defer('Stripe activity differs from the Terminal receipt.')
      const entry=await one(db,"SELECT 1 FROM pt_journal_entries WHERE id=? AND status='posted' AND reversed_by_id IS NULL",terminal.journal_id)
      if(!entry)return defer('The Terminal receipt was reversed; review its Stripe activity.')
      await run(db,[q("UPDATE pt_stripe_clearing_items SET status='adopted',reason='',entry_id=? WHERE id=? AND entry_id IS NULL",terminal.journal_id,item.id),changed(),audit(pantry('stripe'),'stripe.terminal-adopt','stripe-item',item.id,{terminalId:terminal.id})])
      return true
    }
    if(!terminal && source.metadata?.pantry_terminal)return defer('Waiting for the Terminal record; this charge will not also be booked as sales.')
    payment = intent ? await one(db, `SELECT s.*, p.journal_id, p.amount_cents AS received_cents, p.reversal_id, e.reversed_by_id, e.status AS entry_status
      FROM pt_stripe_payments s LEFT JOIN pt_payments p ON p.id = s.payment_id LEFT JOIN pt_journal_entries e ON e.id = p.journal_id WHERE s.payment_intent = ?`, intent) : null
    if (payment) {
      if (!['succeeded','returned','disputed','refunded'].includes(payment.status) || !payment.journal_id) return defer(`Waiting for invoice payment ${payment.id} to be confirmed.`)
      if (((payment.reversal_id || payment.reversed_by_id) && (payment.status !== 'returned' || payment.return_entry_id !== payment.reversal_id)) || payment.entry_status !== 'posted') return defer('The invoice receipt was reversed or is not posted; review this Stripe item.')
      if (payment.received_cents !== item.amount_cents) return defer('Stripe charge differs from the existing invoice receipt.')
      return adoptInvoice(db, s, item, payment, balanceLedger)
    }
    if (source.metadata?.pantry_invoice) return defer(`Waiting for invoice ${source.metadata.pantry_invoice} to be confirmed; this charge will not also be booked as sales.`)
    if (intent && invoiceErrors.length) return defer(`Invoice overlap cannot be checked until Checkout sessions ${invoiceErrors.join(', ')} can be confirmed.`)
  }
  if (item.event_date < s.payouts_from) return defer(`Stripe item predates the configured activity start ${s.payouts_from}; review historical activity without an automatic opening adjustment.`)
  let lines: Line[]
  const memo = `Stripe ${category.replace(/_/g, ' ')} ${bt.id}`
  if (isPayout(bt)) {
    if (!source || source.automatic !== true) return defer('Stripe itemizes only automatic payouts; review this manual payout as a transfer from Stripe balance.')
    lines = [{...signedLine(balanceLedger, item.net_cents, memo),...dimensions.coding('clearing')}, {...signedLine(bankLedger, -item.amount_cents, memo),...dimensions.coding('bank')}, {...signedLine(s.fee_account_id, item.fee_cents, memo),...dimensions.coding('fees')}]
  } else if (isCharge || REFUNDS.has(category) || FEES.has(category) || REFUNDS.has(String(bt.type)) || FEES.has(String(bt.type))) {
    const counter = isCharge ? s.sales_account_id : REFUNDS.has(category) || REFUNDS.has(String(bt.type)) ? s.refunds_account_id : s.fee_account_id
    const role = isCharge ? 'sales' : counter === s.refunds_account_id ? 'refunds' : 'fees'
    lines = [{...signedLine(balanceLedger, item.net_cents, memo),...dimensions.coding('clearing')}, {...signedLine(counter, -item.amount_cents, memo),...dimensions.coding(role)}, {...signedLine(s.fee_account_id, item.fee_cents, memo),...dimensions.coding('fees')}]
  } else return defer(`Unsupported Stripe item ${bt.id} (${category}); review before posting.`)
  lines = lines.filter(l => l.debit || l.credit)
  if (lines.length < 2) return defer('Stripe item has no nonzero balanced movement to post.')
  const entryId = uid(), by = pantry('stripe')
  const statements = [...dimensions.guards,guard('EXISTS (SELECT 1 FROM pt_stripe_clearing_items WHERE id = ? AND entry_id IS NULL)', bt.id),
    guard('NOT EXISTS(SELECT 1 FROM pt_stripe_event_movements WHERE account_id=? AND balance_transaction=?)',s.account_id,bt.id),
    guard("NOT EXISTS(SELECT 1 FROM pt_customer_refunds WHERE provider_account=? AND provider_id=? AND status='succeeded')",s.account_id,item.source_id),
    ...(isCharge && intent ? [guard('NOT EXISTS (SELECT 1 FROM pt_stripe_payments WHERE payment_intent = ?)', intent), guard('NOT EXISTS(SELECT 1 FROM pt_terminal_payments WHERE payment_intent=?)',intent)] : []),
    ...entryStatements({ id: entryId, date: item.event_date, memo, sourceKind: 'bank', sourceId: isPayout(bt) && bt.type === 'payout' ? item.payout_id ?? bt.id : bt.id, preparedBy: by.email, preparedKind: 'import', lines }, by.email),
    q("UPDATE pt_stripe_clearing_items SET status = 'posted', reason = '', entry_id = ? WHERE id = ? AND entry_id IS NULL", entryId, bt.id), changed(),
    audit(by, 'stripe.clearing', 'stripe-item', bt.id, { type: category, net: item.net_cents, entryId })]
  try { await run(db, statements); return true } catch (error) {
    if (!(error instanceof Fault)) throw error
    await hold(db, bt.id, error.message); return false
  }
}

async function adoptInvoice(db: D1Database, s: Data, item: Data, payment: Data, balanceLedger: string) {
  const dimensions = await processorDimensions(db)
  const by = pantry('stripe'), statements: Sql[] = [...dimensions.guards]
  let feeEntry = payment.fee_entry_id
  if (feeEntry && Number(payment.fee_cents) !== item.fee_cents) { await hold(db, item.id, 'Stripe fee differs from the fee already booked for this invoice.'); return false }
  if (!feeEntry && item.fee_cents !== 0) {
    feeEntry = uid()
    statements.push(...entryStatements({ id: feeEntry, date: item.event_date, memo: `Stripe invoice fee ${item.id}`, sourceKind: 'bank', sourceId: payment.id,
      preparedBy: by.email, preparedKind: 'import', lines: [{...signedLine(s.fee_account_id, item.fee_cents, 'Stripe invoice fee'),...dimensions.coding('fees')}, {...signedLine(balanceLedger, -item.fee_cents, 'Stripe invoice fee'),...dimensions.coding('clearing')}] }, by.email),
    q('UPDATE pt_stripe_payments SET fee_entry_id = ?, fee_cents = ?, updated_at = ? WHERE id = ? AND fee_entry_id IS NULL', feeEntry, item.fee_cents, now(), payment.id), changed())
  }
  statements.push(q("UPDATE pt_stripe_clearing_items SET status = 'adopted', reason = '', entry_id = ?, fee_entry_id = ? WHERE id = ? AND entry_id IS NULL", payment.journal_id, feeEntry, item.id), changed(),
    audit(by, 'stripe.clearing-adopt', 'stripe-item', item.id, { paymentId: payment.payment_id, entryId: payment.journal_id, feeEntryId: feeEntry }))
  try { await run(db, statements); return true } catch (error) {
    if (!(error instanceof Fault)) throw error
    await hold(db, item.id, error.message); return false
  }
}
