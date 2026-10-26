import { pantry } from '../access'
import { now, requireThat, type Data } from '../core'
import { audit, changed, guard, one, q, type Sql } from '../db'
import { reverseEarlyDiscounts } from '../early-payment'
import { entry, reversalStatements } from '../journal'
import { accountFence, amount, methodDetail, movementStatements, providerDay, safe, type EventContext } from './provider'

export type CompleteEvent = (statements?: Sql[], sessionId?: string, notice?: 'processing' | 'receipt' | 'returned') => Promise<void>

/** A settled ACH return reopens receivables and withdraws counted discounts atomically. */
export async function returnPayment(c: EventContext, row: Data, charge: Data, finish: CompleteEvent, dispute?: Data, extra: Sql[] = []) {
  requireThat(row.method === 'us_bank_account', 'Only an ACH failure reverses an ACH payment automatically', 409)
  const payment = row.payment_id ? await one(c.db, 'SELECT * FROM pt_payments WHERE id=?', row.payment_id) : null
  if (row.status === 'returned' && payment?.reversal_id) { await finish(extra, row.id, 'returned'); return }
  if (!payment) {
    await finish([...extra, q("UPDATE pt_stripe_payments SET status='failed',charge_id=?,updated_at=? WHERE id=? AND payment_id IS NULL AND status IN ('open','processing','failed')", charge.id, now(), row.id)], row.id)
    return
  }
  requireThat(!payment.reversal_id, 'This receipt already has a different reversal; reconcile the Stripe return', 409)
  const returned = amount(dispute?.amount ?? charge.amount)
  requireThat(returned === payment.amount_cents && !row.refunded_cents, 'A partial or previously refunded ACH return needs reconciliation before reversing the receipt', 409)
  const by = pantry('stripe'), day = providerDay(c.event.created)
  const error = charge.failure_code ?? dispute?.reason ?? 'bank_return'
  const rawCode = dispute?.network_reason_code ?? charge.failure_code
  const code = /^R\d{2}$/i.test(String(rawCode ?? '')) ? String(rawCode).toUpperCase() : safe(error, 20)
  const reason = safe(charge.failure_message ?? dispute?.reason ?? error)
  const reversal = await reversalStatements(c.db, by, await entry(c.db, payment.journal_id), day, `Stripe ACH return ${code}: ${reason}`)
  const balances = dispute?.balance_transactions
  let balance: unknown = charge.failure_balance_transaction
  if (Array.isArray(balances)) {
    const debits = balances.filter((b: Data) => Number(b.amount) < 0)
    requireThat(debits.length === 1, 'Stripe ACH dispute has no single identifiable withdrawal; reconcile its balance transactions', 409)
    balance = debits[0]
  }
  // On charge.failed Stripe can expose the withdrawal as balance_transaction.
  balance ??= charge.balance_transaction
  const detail = methodDetail(charge)
  const statements: Sql[] = [...extra, accountFence(c),
    guard('EXISTS(SELECT 1 FROM pt_payments WHERE id=? AND reversal_id IS NULL)', payment.id),
    ...reversal.statements, ...await reverseEarlyDiscounts(c.db, by, payment.id, day, `ACH payment returned: ${reason}`),
    q('UPDATE pt_payments SET reversal_id=? WHERE id=? AND reversal_id IS NULL', reversal.id, payment.id), changed(),
    q('UPDATE pt_allocations SET voided_on=?,voided_by=? WHERE source_kind=\'payment\' AND source_id=? AND voided_by IS NULL', day, reversal.id, payment.id),
    q('UPDATE pt_invoices SET reminder_cycle=? WHERE id=?',reversal.id,row.invoice_id),
    q("UPDATE pt_stripe_payments SET status='returned',charge_id=?,return_entry_id=?,return_code=?,return_reason=?,method_brand=?,method_bank=?,method_last4=?,payer_email=CASE WHEN ?<>'' THEN ? ELSE payer_email END,disputed_cents=0,evidence_due_by=NULL,updated_at=? WHERE id=? AND status<>'returned'", charge.id, reversal.id, code, reason, detail.brand, detail.bank, detail.last4, detail.payerEmail, detail.payerEmail, now(), row.id), changed(),
    ...await movementStatements(c, dispute?.id ?? charge.id, balance, 'return', returned, reversal.id),
    audit(by, 'stripe.returned', 'invoice', row.invoice_id, { session: row.id, paymentId: payment.id, reversalId: reversal.id, amount: returned, code, reason })]
  await finish(statements, row.id, 'returned')
}

export async function recordDispute(c: EventContext, row: Data, charge: Data, dispute: Data, finish: CompleteEvent) {
  const cents = amount(dispute.amount)
  requireThat(dispute.currency === 'usd' && cents <= row.amount_cents, 'Stripe dispute amount or currency differs from this invoice payment', 409)
  const ach = row.method === 'us_bank_account', due = Number.isSafeInteger(dispute.evidence_details?.due_by) ? dispute.evidence_details.due_by : null
  const statements = [q(`INSERT INTO pt_stripe_disputes(account_id,id,session_id,invoice_id,amount_cents,currency,status,reason,evidence_due_by,ach_return,observed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(account_id,id) DO UPDATE SET amount_cents=excluded.amount_cents,status=excluded.status,reason=excluded.reason,evidence_due_by=excluded.evidence_due_by,observed_at=excluded.observed_at`,
  c.settings.account_id, dispute.id, row.id, row.invoice_id, cents, 'usd', safe(dispute.status, 60), safe(dispute.reason), due, ach ? 1 : 0, now())]
  if (ach) return returnPayment(c, row, charge, finish, dispute, statements)
  statements.push(accountFence(c),
    q(`UPDATE pt_stripe_payments SET disputed_cents=(SELECT COALESCE(SUM(amount_cents),0) FROM pt_stripe_disputes WHERE session_id=? AND ach_return=0 AND status IN ('needs_response','under_review','warning_needs_response','warning_under_review','lost')),
    evidence_due_by=(SELECT MIN(evidence_due_by) FROM pt_stripe_disputes WHERE session_id=? AND ach_return=0 AND status IN ('needs_response','under_review','warning_needs_response','warning_under_review')),
    charge_id=?,updated_at=? WHERE id=?`, row.id, row.id, charge.id, now(), row.id),
    q("UPDATE pt_stripe_payments SET status=CASE WHEN disputed_cents>0 THEN 'disputed' WHEN refunded_cents>=amount_cents THEN 'refunded' ELSE 'succeeded' END WHERE id=? AND status<>'returned' AND payment_id IS NOT NULL", row.id),
    audit(pantry('stripe'), 'stripe.dispute', 'invoice', row.invoice_id, { disputeId: dispute.id, amount: cents, status: safe(dispute.status, 60), evidenceDueBy: due }))
  await finish(statements, row.id)
}
