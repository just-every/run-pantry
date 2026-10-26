import type { Bindings } from '../../auth.server'
import { authority, must, pantry, who } from '../access'
import type { Command } from '../context'
import { now, requireThat, text, uid, type Data } from '../core'
import { all, approval, audit, changed, guard, one, q, run } from '../db'
import { customerRecipients } from '../customer-profile'
import { offeredMethods, stripeSettings } from '../stripe'

export const binding = (customer: Data) => JSON.stringify({ address: customer.billing_address ?? '', serviceAddress: customer.service_address ?? '', recipients: customerRecipients(customer).sort() })
export const schedule = (template: Data) => JSON.stringify({ every: template.every, unit: template.unit, startDate: template.start_date, endDate: template.end_date, termsDays: template.terms_days, prices: template.autopay_prices ?? [] })
async function prices(db: D1Database, id: string) { return all(db, 'SELECT id,revision,approved_revision,template_revision,effective_date FROM pt_recurring_prices WHERE recurring_id=? ORDER BY effective_date,id', id) }

export async function customer(db: D1Database, id: string) {
  const row = await one(db, "SELECT * FROM pt_contacts WHERE id=? AND kind='customer' AND erased_at IS NULL", id)
  requireThat(row, 'Customer not found', 404)
  return row
}

export async function policyState(env: Bindings, db: D1Database, customerId: string) {
  const c = await customer(db, customerId), policy = await one(db, 'SELECT * FROM pt_autopay_policies WHERE customer_id=?', c.id)
  const t = policy ? await one(db, 'SELECT * FROM pt_recurring WHERE id=?', policy.recurring_id) : null
  if (t) t.autopay_prices = await prices(db, t.id)
  const s = await stripeSettings(db)
  const owner = policy ? await one(db, "SELECT 1 FROM oa_operators WHERE id=? AND email=? AND role='owner' AND status='active'", policy.owner_id, policy.approved_by) : null
  const valid = !!(policy?.enabled && ['active','ended'].includes(t?.status) && t!.mode === 'send' && t!.revision === policy.template_revision && t!.approved_revision === t!.revision && t!.customer_id === c.id && schedule(t!) === policy.schedule && binding(c) === policy.customer_binding && owner && s?.account_id === policy.stripe_account)
  const methods = (await offeredMethods(env, db, customerId)).filter(m => m !== 'offline')
  const consented = valid && c.autopay_setup_id && !c.autopay_revoked_at && methods.includes(c.autopay_method)
    ? await one(db, "SELECT * FROM pt_autopay_setups WHERE id=? AND policy_revision=? AND status='succeeded' AND stripe_account=?", c.autopay_setup_id, policy.revision, s!.account_id) : null
  return { c, policy, template: t, stripe: s, valid, consented, methods }
}

export function policyFence(state: Awaited<ReturnType<typeof policyState>>) {
  const { c, policy, template: t } = state
  requireThat(policy && t, 'Autopay has no approved standing policy', 409)
  return guard(`EXISTS(SELECT 1 FROM pt_autopay_policies p JOIN pt_recurring r ON r.id=p.recurring_id JOIN pt_contacts c ON c.id=p.customer_id JOIN oa_operators o ON o.id=p.owner_id JOIN pt_stripe s ON s.id=1
    WHERE p.customer_id=? AND p.revision=? AND p.enabled=1 AND r.revision=? AND r.approved_revision=r.revision AND r.status IN('active','ended') AND r.mode='send' AND c.revision=? AND c.erased_at IS NULL AND s.account_id=p.stripe_account AND s.revision=? AND o.email=p.approved_by AND o.role='owner' AND o.status='active')`, c.id, policy.revision, t.revision, c.revision, state.stripe!.revision)
}

export async function autopayView(env: Bindings, db: D1Database, customerId: string): Promise<Data> {
  const state = await policyState(env, db, customerId), { c, policy, valid, consented, methods } = state
  return { policy: policy ? { ...policy, retryDays: JSON.parse(policy.retry_days), schedule: JSON.parse(policy.schedule), enabled: !!policy.enabled, valid } : null,
    methods, saved: c.autopay_setup_id ? { method: c.autopay_method, last4: c.autopay_last4, acceptedAt: c.autopay_accepted_at, acceptedIP: c.autopay_accepted_ip, mandateText: c.autopay_mandate_text, revokedAt: c.autopay_revoked_at, active: !!consented } : null,
    attempts: await all(db, 'SELECT a.*,i.number AS invoice_number FROM pt_autopay_attempts a JOIN pt_invoices i ON i.id=a.invoice_id WHERE a.customer_id=? ORDER BY a.created_at DESC LIMIT 100', customerId),
    notices: await all(db, 'SELECT n.* FROM pt_autopay_notices n JOIN pt_autopay_attempts a ON a.id=n.attempt_id WHERE a.customer_id=? ORDER BY n.at DESC LIMIT 200', customerId) }
}

export async function revokeCustomer(db: D1Database, customerId: string, actor = pantry('customer')) {
  await run(db, [q('UPDATE pt_contacts SET autopay_revoked_at=?,revision=? WHERE id=?', now(), uid(), customerId), changed(),
    q("UPDATE pt_autopay_setups SET status='revoked' WHERE customer_id=? AND status IN('creating','open','succeeded')", customerId),
    audit(actor, 'autopay.revoke', 'customer', customerId)])
}

const policy: Command = { need: 'owner', async run(c, b) {
  must(c.actor, 'owner')
  const row = await customer(c.db, text(b.customerId, 'Customer'))
  if (b.enabled === false) {
    await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_autopay_policies SET enabled=0,revision=? WHERE customer_id=?', uid(), row.id), audit(who(c.actor), 'autopay.disable', 'customer', row.id)])
    return autopayView(c.env, c.db, row.id)
  }
  requireThat(b.enabled === true && b.consent === true, 'Explicit owner approval is required for scheduled charges and retry notices', 409)
  const t = await one(c.db, 'SELECT * FROM pt_recurring WHERE id=? AND customer_id=?', text(b.recurringId, 'Recurring template'), row.id)
  requireThat(t && t.status === 'active' && t.mode === 'send' && t.approved_revision === t.revision, 'Choose a currently approved automatic recurring template', 409)
  t.autopay_prices = await prices(c.db, t.id)
  requireThat(customerRecipients(row).length && row.billing_address, 'Add the billing address and billing email before approving autopay', 409)
  const purpose = text(b.purpose, 'Purpose of these scheduled charges', 500), days = b.retryDays ?? [1, 3, 7]
  requireThat(Array.isArray(days) && days.length <= 12 && days.every((d, i) => Number.isInteger(d) && d > 0 && d <= 90 && (i === 0 || d > days[i - 1])), 'Retry days must increase, between 1 and 90 days after the first attempt')
  const stripe = await stripeSettings(c.db)
  requireThat(stripe && (await offeredMethods(c.env, c.db, row.id)).some(m => m !== 'offline'), 'An offered online payment method is required', 409)
  const revision = uid()
  await run(c.db, [authority(c.actor, 'owner'), guard("EXISTS(SELECT 1 FROM pt_recurring WHERE id=? AND revision=? AND approved_revision=revision AND status='active')", t.id, t.revision),
    guard('EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND revision=?)', row.id, row.revision),
    q(`INSERT INTO pt_autopay_policies(customer_id,recurring_id,enabled,purpose,retry_days,template_revision,schedule,customer_binding,stripe_account,approved_by,owner_id,approved_at,revision) VALUES(?,?,1,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(customer_id) DO UPDATE SET recurring_id=excluded.recurring_id,enabled=1,purpose=excluded.purpose,retry_days=excluded.retry_days,template_revision=excluded.template_revision,schedule=excluded.schedule,customer_binding=excluded.customer_binding,stripe_account=excluded.stripe_account,approved_by=excluded.approved_by,owner_id=excluded.owner_id,approved_at=excluded.approved_at,revision=excluded.revision`, row.id, t.id, purpose, JSON.stringify(days), t.revision, schedule(t), binding(row), stripe.account_id, c.actor.email, c.actor.id, now(), revision),
    approval(who(c.actor), 'autopay', row.id, revision, 'scheduled-charge', 'approved', purpose), audit(who(c.actor), 'autopay.approve', 'customer', row.id, { recurringId: t.id, templateRevision: t.revision, revision, purpose, retryDays: days, schedule: JSON.parse(schedule(t)) })])
  return autopayView(c.env, c.db, row.id)
} }
const revoke: Command = { need: 'owner', async run(c, b) {
  must(c.actor, 'owner')
  const row = await customer(c.db, text(b.customerId, 'Customer'))
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_contacts SET autopay_revoked_at=?,revision=? WHERE id=?', now(), uid(), row.id), changed(), q("UPDATE pt_autopay_setups SET status='revoked' WHERE customer_id=? AND status IN('creating','open','succeeded')", row.id), audit(who(c.actor), 'autopay.revoke', 'customer', row.id)])
  return autopayView(c.env, c.db, row.id)
} }
export const autopayCommands: Record<string, Command> = { 'autopay.policy': policy, 'autopay.revoke': revoke }
