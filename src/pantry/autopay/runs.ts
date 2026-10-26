import type { Bindings } from '../../auth.server'
import { pantry } from '../access'
import { addDays, now, requireThat, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run } from '../db'
import { businessDay, sendingSettings } from '../delivery'
import { offerState } from '../early-payment'
import { invoice } from '../invoices'
import { notifyPayment } from '../payment-notices'
import { methodDetail } from '../stripe-events/provider'
import { recordSucceeded, stripeSettings } from '../stripe'
import { managedInstall, stripeCall, unseal } from '../stripe-api'
import { policyFence, policyState } from './policy'
import { createAutopayIntent } from './provider'
import { queueFailureNotice, sendAutopayNotices } from './notices'

export async function isAutopayPayment(db: D1Database, id: string) { return !!await one(db, 'SELECT 1 FROM pt_autopay_attempts WHERE id=?', id) }

/** Reconcile only known provider identity. Never submit again after an uncertain response. */
export async function syncAutopayPayment(env: Bindings, db: D1Database, id: string) {
  const a = await one(db, 'SELECT * FROM pt_autopay_attempts WHERE id=?', id), row = await one(db, 'SELECT * FROM pt_stripe_payments WHERE id=?', id)
  if (!a?.payment_intent || !row || ['returned', 'refunded', 'disputed'].includes(row.status)) return row
  const settings = await stripeSettings(db), setup = await one(db, 'SELECT * FROM pt_autopay_setups WHERE id=?', a.setup_id)
  if (!settings || !setup || setup.stripe_account !== settings.account_id || managedInstall(env)) return row
  const key = await unseal(env, settings.key_sealed), pi = await stripeCall(key, 'GET', `/payment_intents/${encodeURIComponent(a.payment_intent)}`, { expand: ['latest_charge.balance_transaction'] })
  requireThat(pi.id === a.payment_intent && pi.customer === setup.stripe_customer && pi.metadata?.pantry_autopay_attempt === a.id && pi.currency === 'usd' && Number(pi.amount) === a.amount_cents && Number(pi.livemode) === settings.livemode, 'Stripe automatic payment does not match its retained attempt', 409)
  if (pi.status === 'succeeded') {
    await recordSucceeded(env, db, row, pi, key, settings)
    await run(db, [q("UPDATE pt_autopay_attempts SET status='succeeded',updated_at=? WHERE id=?", now(), a.id)])
    await notifyPayment(env, db, a.id, 'receipt', methodDetail(pi.latest_charge ?? {}))
  } else if (pi.status === 'processing') {
    await run(db, [q("UPDATE pt_stripe_payments SET status='processing',updated_at=? WHERE id=? AND status NOT IN('succeeded','returned','refunded','disputed')", now(), a.id), q("UPDATE pt_autopay_attempts SET status='processing',updated_at=? WHERE id=? AND status<>'succeeded'", now(), a.id)])
    await notifyPayment(env, db, a.id, 'processing', methodDetail(pi.latest_charge ?? {}))
  } else if (['requires_payment_method', 'requires_action', 'canceled'].includes(pi.status) && row.status !== 'succeeded') {
    const code = String(pi.last_payment_error?.code ?? pi.status).slice(0, 100)
    await run(db, [q("UPDATE pt_stripe_payments SET status='failed',updated_at=? WHERE id=? AND status<>'succeeded'", now(), a.id), q("UPDATE pt_autopay_attempts SET status='failed',failure_code=?,updated_at=? WHERE id=? AND status<>'succeeded'", code, now(), a.id), audit(pantry('stripe'), 'autopay.failed', 'invoice', row.invoice_id, { attemptId: a.id, failureCode: code })])
    await queueFailureNotice(db, a.id)
  }
  return one(db, 'SELECT * FROM pt_stripe_payments WHERE id=?', id)
}

async function attempt(env: Bindings, db: D1Database, inv: Data, today: string) {
  const state = await policyState(env, db, inv.customer_id)
  if (!state.valid || !state.consented || inv.recurring_id !== state.policy!.recurring_id) return
  const prior = await all(db, 'SELECT * FROM pt_autopay_attempts WHERE invoice_id=? ORDER BY sequence', inv.id), last = prior.at(-1)
  if (last && last.status !== 'failed') return
  const days = JSON.parse(state.policy!.retry_days), sequence = prior.length
  if (sequence > days.length) return
  if (prior.some(a => a.policy_revision !== state.policy!.revision || a.setup_id !== state.c.autopay_setup_id)) return
  const scheduled = sequence === 0 ? inv.due_date : addDays(prior[0].attempted_on, days[sequence - 1])
  if (scheduled > today) return
  if (await one(db, "SELECT 1 FROM pt_stripe_payments WHERE invoice_id=? AND status IN('open','processing','disputed')", inv.id)) return
  const early = await offerState(db, inv, today), amount = early?.state === 'live' && early.due > 0 ? Math.min(inv.open_cents, early.due) : inv.open_cents
  if (amount <= 0) return
  const id = uid(), at = now()
  let submitted = false
  try {
    await run(db, [policyFence(state), guard('EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND autopay_setup_id=? AND autopay_revoked_at IS NULL)', inv.customer_id, state.c.autopay_setup_id),
      guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND revision=? AND status='issued' AND void_date IS NULL)", inv.id, inv.revision),
      guard("NOT EXISTS(SELECT 1 FROM pt_stripe_payments WHERE invoice_id=? AND status IN('open','processing','disputed'))", inv.id),
      q("INSERT INTO pt_autopay_attempts(id,invoice_id,customer_id,policy_revision,setup_id,sequence,scheduled_on,attempted_on,amount_cents,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,'claiming',?,?)", id, inv.id, inv.customer_id, state.policy!.revision, state.c.autopay_setup_id, sequence, scheduled, today, amount, at, at),
      q("INSERT INTO pt_stripe_payments(id,invoice_id,method,amount_cents,status,created_at,updated_at,early_window_end) VALUES(?,?,?,?,'open',?,?,?)", id, inv.id, state.c.autopay_method, amount, at, at, early?.state === 'live' ? early.offer.windowEnd : null),
      audit(pantry('stripe'), 'autopay.claim', 'invoice', inv.id, { attemptId: id, customerId: inv.customer_id, sequence, scheduledOn: scheduled, policyRevision: state.policy!.revision, approvalOwner: state.policy!.approved_by, purpose: state.policy!.purpose })])
  } catch (error) { if (await one(db, 'SELECT 1 FROM pt_autopay_attempts WHERE invoice_id=? AND sequence=?', inv.id, sequence)) return; throw error }
  try {
    const fresh = await policyState(env, db, inv.customer_id), current = await invoice(db, inv.id)
    requireThat(fresh.valid && fresh.consented && fresh.policy!.revision === state.policy!.revision && fresh.c.autopay_setup_id === state.c.autopay_setup_id && current.status === 'issued' && !current.void_date && current.open_cents === inv.open_cents, 'Autopay authority or balance changed before submission', 409)
    await run(db, [policyFence(fresh)])
    if (fresh.c.autopay_method === 'us_bank_account') {
      const mandate = await stripeCall(await unseal(env, fresh.stripe!.key_sealed), 'GET', `/mandates/${encodeURIComponent(fresh.c.autopay_mandate_id)}`)
      requireThat(mandate.status === 'active', 'The ACH mandate is no longer active', 409)
    }
    const providerKey = await unseal(env, fresh.stripe!.key_sealed)
    submitted = true
    const pi = await createAutopayIntent(providerKey, { amount, currency: 'usd', customer: fresh.c.autopay_stripe_customer, payment_method: fresh.c.autopay_payment_method, allowed_payment_method_types: [fresh.c.autopay_method], confirm: true, off_session: true, ...(fresh.c.autopay_mandate_id ? { mandate: fresh.c.autopay_mandate_id } : {}), description: `Invoice ${inv.number}`, metadata: { pantry_invoice: inv.id, pantry_number: inv.number, pantry_autopay_attempt: id } }, id)
    await run(db, [q('UPDATE pt_autopay_attempts SET payment_intent=?,updated_at=? WHERE id=?', pi.id, now(), id), q('UPDATE pt_stripe_payments SET payment_intent=?,updated_at=? WHERE id=?', pi.id, now(), id)])
    await syncAutopayPayment(env, db, id)
  } catch (error) {
    const current = await one(db, 'SELECT payment_intent FROM pt_autopay_attempts WHERE id=?', id)
    if (!current?.payment_intent) await run(db, [q('UPDATE pt_autopay_attempts SET status=?,updated_at=? WHERE id=? AND status=\'claiming\'', submitted ? 'uncertain' : 'cancelled', now(), id), ...(!submitted ? [q("UPDATE pt_stripe_payments SET status='expired',updated_at=? WHERE id=? AND status='open'", now(), id)] : []), audit(pantry('stripe'), submitted ? 'autopay.uncertain' : 'autopay.cancelled', 'invoice', inv.id, { attemptId: id, reason: submitted ? 'Review in Stripe; automatic resubmission is disabled' : 'Authority or mandate changed before submission' })])
    throw error
  }
}

export async function runDueAutopay(env: Bindings, db: D1Database, today?: string) {
  if (managedInstall(env) || !await stripeSettings(db)) return
  const day = today ?? businessDay((await sendingSettings(db)).time_zone)
  for (const a of await all(db, "SELECT id FROM pt_autopay_attempts WHERE payment_intent IS NOT NULL AND status IN('claiming','processing') LIMIT 100")) await syncAutopayPayment(env, db, a.id)
  const due = await all(db, "SELECT i.id FROM pt_invoices i JOIN pt_autopay_policies p ON p.customer_id=i.customer_id AND p.recurring_id=i.recurring_id WHERE i.kind='invoice' AND i.status='issued' AND i.void_date IS NULL AND i.due_date<=? AND p.enabled=1 ORDER BY i.due_date,i.id LIMIT 200", day)
  for (const row of due) { const inv = await invoice(db, row.id); if (inv.open_cents > 0) await attempt(env, db, inv, day) }
  await sendAutopayNotices(env, db)
}

export async function autopayHolding(env: Bindings, db: D1Database, invoiceId: string) {
  const inv = await invoice(db, invoiceId), state = await policyState(env, db, inv.customer_id)
  const rows = await all(db, 'SELECT * FROM pt_autopay_attempts WHERE invoice_id=? ORDER BY sequence', invoiceId), last = rows.at(-1)
  if (last && ['claiming', 'processing', 'uncertain'].includes(last.status)) return true
  return !!(state.valid && state.consented && inv.recurring_id === state.policy!.recurring_id && (!last || last.status === 'failed' && rows.length <= JSON.parse(state.policy!.retry_days).length))
}
