import type { Bindings } from '../../auth.server'
import { runtimeBindings } from '../../auth.server'
import { pantry } from '../access'
import { now, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, one, q, run } from '../db'
import { customerLink, sendingSettings } from '../delivery'
import { invoiceByLink } from '../invoice-links'
import { stripeCall, unseal } from '../stripe-api'
import { autopayView, policyFence, policyState, revokeCustomer } from './policy'

const objectId = (value: any) => typeof value === 'string' ? value : value?.id

export async function mandateText(db: D1Database, state: Awaited<ReturnType<typeof policyState>>) {
  const entity = await one(db, 'SELECT legal_name FROM pt_entity WHERE id=1'), p = state.policy, t = state.template
  if (!p || !t) return ''
  const settings = await sendingSettings(db)
  return `I authorize ${String(entity?.legal_name ?? 'the business')} to save and debit my selected method for recurring template ${t.number}: every ${t.every} ${t.unit}(s), on each invoice due date, for ${p.purpose} at ${state.c.billing_address}. Invoices state the amount and date; amounts may vary. Failed payments may be retried on days ${JSON.parse(p.retry_days).join(', ') || 'none'} after the first attempt, with failure emails. For ACH I authorize electronic debits and credits to correct erroneous debits. This continues until revoked from this invoice's autopay controls or by contacting the business${settings.reply_to ? ' at ' + settings.reply_to : ''}; allow 3 business days to stop a bank debit. Revocation stops future submissions; submitted payments may complete. I accept Stripe's bank debit mandate in Checkout and can keep this authorization.`
}

async function linked(db: D1Database, token: string) {
  const inv = await invoiceByLink(db, token)
  requireThat(inv, 'Invoice not found', 404)
  return inv
}

export async function publicAutopay(env: Bindings, db: D1Database, token: string) {
  const inv = await linked(db, token), state = await policyState(env, db, inv.customer_id), view = await autopayView(env, db, inv.customer_id)
  const saved = view.saved ? {method:view.saved.method,active:view.saved.active,revoked:!!view.saved.revokedAt} : null
  return { invoiceId: inv.id, customerName: inv.customer_name, policy: view.policy ? { revision: view.policy.revision, purpose: view.policy.purpose, enabled: view.policy.enabled, valid: view.policy.valid, retryDays: view.policy.retryDays, schedule: view.policy.schedule, recurringId: view.policy.recurring_id } : null,
    mandateText: await mandateText(db, state), methods: view.methods, saved }
}

export async function startAutopaySetup(env: Bindings, db: D1Database, token: string, body: Data, request: Request) {
  requireThat(request.headers.get('origin') === runtimeBindings(env).AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site', 'Invalid origin', 403)
  const inv = await linked(db, token), state = await policyState(env, db, inv.customer_id)
  requireThat(state.valid, 'The owner must approve the current recurring template and schedule before autopay can be authorized', 409)
  requireThat(body.accepted === true && body.policyRevision === state.policy!.revision, 'Accept the current authorization before continuing to Stripe', 409)
  const method = text(body.method, 'Payment method')
  requireThat((method === 'card' || method === 'us_bank_account') && state.methods.includes(method), 'That payment method is not offered for this customer', 409)
  const ip = request.headers.get('cf-connecting-ip')
  requireThat(ip && ip.length <= 64 && /^[0-9a-f:.]+$/i.test(ip), 'The platform did not supply a trusted customer IP address; authorization cannot be recorded', 409)
  const key = await unseal(env, state.stripe!.key_sealed), id = uid(), at = now(), wording = await mandateText(db, state)
  const stripeCustomer = await stripeCall(key, 'POST', '/customers', { name: state.c.name, ...(state.c.email ? { email: state.c.email } : {}), metadata: { pantry_customer: state.c.id } }, `pantry-autopay-customer-${id}`)
  requireThat(stripeCustomer.id, 'Stripe did not return the customer identity', 502)
  await run(db, [policyFence(state), q("INSERT INTO pt_autopay_setups(id,customer_id,policy_revision,stripe_account,stripe_customer,method,mandate_text,accepted_at,accepted_ip,status) VALUES(?,?,?,?,?,?,?,?,?,'creating')", id, state.c.id, state.policy!.revision, state.stripe!.account_id, stripeCustomer.id, method, wording, at, ip)])
  let session: Data
  try {
    const link = customerLink(env, token)
    session = await stripeCall(key, 'POST', '/checkout/sessions', { mode: 'setup', currency: 'usd', customer: stripeCustomer.id, allowed_payment_method_types: [method], client_reference_id: id,
      setup_intent_data: { metadata: { pantry_autopay_setup: id, pantry_customer: state.c.id, pantry_policy: state.policy!.revision } }, metadata: { pantry_autopay_setup: id },
      custom_text: { submit: { message: `Save this method for automatic payment of recurring invoices, under the purpose, address, due dates and retry schedule you accepted on the Pantry invoice page. You may revoke future submissions from that page. For bank debits, also accept Stripe's mandate displayed here.` } }, success_url: `${link}?autopay_setup={CHECKOUT_SESSION_ID}`, cancel_url: link }, `pantry-autopay-setup-${id}`)
    requireThat(session.id && session.url, 'Stripe did not return hosted Checkout', 502)
  } catch (error) {
    await run(db, [q("UPDATE pt_autopay_setups SET status='uncertain' WHERE id=? AND status='creating'", id)])
    throw error
  }
  try {
    await run(db, [policyFence(state), guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND link_token=? AND status='issued' AND void_date IS NULL)", inv.id, token), q("UPDATE pt_autopay_setups SET session_id=?,status='open' WHERE id=? AND status='creating'", session.id, id), changed(), audit(pantry('customer'), 'autopay.setup', 'customer', state.c.id, { setupId: id, policyRevision: state.policy!.revision, method, acceptedAt: at })])
  } catch (error) { await stripeCall(key, 'POST', `/checkout/sessions/${encodeURIComponent(session.id)}/expire`); throw error }
  return { url: String(session.url), sessionId: session.id }
}

export async function confirmAutopaySetup(env: Bindings, db: D1Database, token: string, sessionId: string) {
  const inv = await linked(db, token), state = await policyState(env, db, inv.customer_id)
  const setup = await one(db, 'SELECT * FROM pt_autopay_setups WHERE session_id=? AND customer_id=?', text(sessionId, 'Setup session', 200), inv.customer_id)
  requireThat(state.valid && setup && setup.policy_revision === state.policy!.revision && ['open', 'succeeded'].includes(setup.status), 'This authorization expired or was revoked; start again', 409)
  if (setup.status === 'succeeded') return publicAutopay(env, db, token)
  const key = await unseal(env, state.stripe!.key_sealed)
  const session = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ['setup_intent.payment_method', 'setup_intent.mandate'] })
  const intent = typeof session.setup_intent === 'object' ? session.setup_intent : await stripeCall(key, 'GET', `/setup_intents/${encodeURIComponent(objectId(session.setup_intent) ?? '')}`, { expand: ['payment_method', 'mandate'] })
  requireThat(session.mode === 'setup' && session.status === 'complete' && session.client_reference_id === setup.id && objectId(session.customer) === setup.stripe_customer && Number(session.livemode) === state.stripe!.livemode, 'Stripe has not completed this setup for this customer', 409)
  requireThat(intent.status === 'succeeded' && intent.usage === 'off_session' && objectId(intent.customer) === setup.stripe_customer && intent.metadata?.pantry_autopay_setup === setup.id, 'Stripe has not confirmed this saved method', 409)
  const method = typeof intent.payment_method === 'object' ? intent.payment_method : await stripeCall(key, 'GET', `/payment_methods/${encodeURIComponent(objectId(intent.payment_method))}`)
  requireThat(method?.id && method.type === setup.method && state.methods.includes(method.type) && objectId(method.customer) === setup.stripe_customer, 'This saved payment method is no longer offered or belongs to another customer', 409)
  const mandate = typeof intent.mandate === 'object' ? intent.mandate : intent.mandate ? await stripeCall(key, 'GET', `/mandates/${encodeURIComponent(intent.mandate)}`) : null
  requireThat(method.type !== 'us_bank_account' || (mandate?.status === 'active' && mandate.customer_acceptance?.type === 'online'), 'Stripe has not confirmed an active online ACH mandate', 409)
  const last4 = method[method.type]?.last4
  requireThat(/^\d{4}$/.test(last4), 'Stripe did not supply the saved method summary', 409)
  await run(db, [policyFence(state), guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND link_token=? AND status='issued' AND void_date IS NULL)", inv.id, token),
    q("UPDATE pt_autopay_setups SET setup_intent=?,status='succeeded' WHERE id=? AND status='open'", intent.id, setup.id), changed(),
    q('UPDATE pt_contacts SET autopay_setup_id=?,autopay_mandate_text=?,autopay_accepted_at=?,autopay_accepted_ip=?,autopay_payment_method=?,autopay_stripe_customer=?,autopay_mandate_id=?,autopay_method=?,autopay_last4=?,autopay_revoked_at=NULL,revision=? WHERE id=?', setup.id, setup.mandate_text, setup.accepted_at, setup.accepted_ip, method.id, setup.stripe_customer, mandate?.id ?? null, method.type, last4, uid(), state.c.id), changed(),
    audit(pantry('customer'), 'autopay.authorize', 'customer', state.c.id, { setupId: setup.id, policyRevision: setup.policy_revision, method: method.type, acceptedAt: setup.accepted_at })])
  return publicAutopay(env, db, token)
}

export async function revokeAutopay(db: D1Database, token: string) { const inv = await linked(db, token); await revokeCustomer(db, inv.customer_id); return { revoked: true } }
