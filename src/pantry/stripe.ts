import { isAutopayPayment, syncAutopayPayment } from './autopay'
import { notifyPayment } from './payment-notices'
import { STRIPE_PAYMENT_EVENTS } from './stripe-events'
import { methodDetail } from './stripe-events/provider'
import { processorDimensions } from './dimensions/processor'
// Card and ACH payment from the invoice link, through the business's own Stripe
// account. The owner connects a key in Settings; Pantry creates its webhook and
// two ledger accounts (the Stripe balance money lands in, and Stripe fees). A
// customer pays in Stripe Checkout; Pantry reads the outcome back from Stripe
// (on return, by webhook and in due work), records the payment against the
// invoice and books Stripe's fee. Card and bank numbers never reach Pantry.
import { invoiceByLink } from './invoice-links'
import { runtimeBindings, type Bindings } from '../auth.server'
import { authority, pantry, who } from './access'
import { Fault, now, requireThat, text, uid, usd, type Data } from './core'
import { all, audit, changed, guard, one, q, run, type Sql } from './db'
import { accountInsert } from './accounts'
import { entryStatements } from './journal'
import { paymentStatements } from './payables'
import { invoice } from './invoices'
import { customerPaymentMethods } from './customer-profile'
import { businessDay, customerLink, sendingSettings } from './delivery'
import { managedInstall, seal, STRIPE_VERSION, stripeCall, unseal } from './stripe-api'
import { offerState } from './early-payment'

/** The UTC instant (ms) at which `day` ends in `timeZone`. */
function dayEnd(day: string, timeZone: string) {
  const guess = Date.parse(day + 'T23:59:59Z')
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }).formatToParts(new Date(guess)).map(p => [p.type, p.value]))
  const local = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return guess - (local - guess) + 999
}

/** What Checkout charges now (INVOICE-010 R10): while an early-payment offer is live with at least 30 minutes of its last day left,
 *  the amount still due for the discount, expiring by the end of that day; otherwise the open balance. */
export async function checkoutAmount(db: D1Database, inv: Data) {
  const tz = (await sendingSettings(db)).time_zone, early = await offerState(db, inv, businessDay(tz))
  if (early?.state === 'live' && early.due > 0 && early.due <= inv.open_cents) {
    const end = dayEnd(early.offer.windowEnd, tz)
    if (end - Date.now() >= 30 * 60000) return { amount: early.due, windowEnd: early.offer.windowEnd, expiresAt: Math.floor(Math.min(end, Date.now() + 23.9 * 3600000) / 1000), early }
  }
  return { amount: inv.open_cents, windowEnd: null, expiresAt: null, early }
}
import type { Command } from './context'

export const METHODS = { card: 'Card', us_bank_account: 'Bank account (ACH)' } as const
export type Method = keyof typeof METHODS

export async function stripeSettings(db: D1Database) {
  return one(db, 'SELECT * FROM pt_stripe WHERE id = 1')
}

/** Why online payment is unavailable on this install, or null when customers can pay. */
export async function paymentBlock(env: Bindings, db: D1Database) {
  if (managedInstall(env)) return 'Online card and ACH payment is not available yet on RER Managed installs: they cannot reach Stripe until RER adds a provider relay.'
  if (!await stripeSettings(db)) return 'This business has not connected Stripe, so the invoice cannot be paid online yet.'
  return null
}

/** The first free account code from `from` up. */
export async function nextCode(db: D1Database, from: number) {
  const codes = new Set((await all<{ code: string }>(db, 'SELECT code FROM pt_accounts')).map(a => a.code))
  let n = from
  while (codes.has(String(n))) n++
  return String(n)
}

const connect: Command = { need: 'owner', async run(c, b) {
  requireThat(!managedInstall(c.env), 'RER Managed installs cannot reach Stripe yet, so online payment cannot be connected here', 409)
  const key = text(b.secretKey, 'Stripe secret key', 300)
  // Stripe authenticates the credential. Local prefix guesses reject valid
  // credential formats without adding security; the account read is the check.
  requireThat(!/\s/.test(key), 'Paste one Stripe API key without spaces')
  const account = await stripeCall(key, 'GET', '/account')
  const existing = await stripeSettings(c.db), origin = runtimeBindings(c.env).AUTH_ORIGIN
  if (existing?.webhook_id) await stripeCall(await unseal(c.env, existing.key_sealed), 'DELETE', `/webhook_endpoints/${existing.webhook_id}`).catch(() => null)
  // Stripe calls back only to a public https address; a computer-local install reads outcomes on return and in due work.
  const hook = origin.startsWith('https://') ? await stripeCall(key, 'POST', '/webhook_endpoints', {
    url: `${origin}/api/pantry/stripe/webhook`, description: 'Pantry invoice payments', api_version: STRIPE_VERSION,
    enabled_events: STRIPE_PAYMENT_EVENTS,
  }) : null
  const statements: Sql[] = [authority(c.actor, 'owner')]
  let bankId = existing?.bank_account_id, feeId = existing?.fee_account_id
  if (!bankId) {
    const ledger = uid()
    bankId = uid()
    statements.push(accountInsert(ledger, { code: await nextCode(c.db, 1050), name: 'Stripe balance', type: 'asset', subtype: 'bank', description: 'Money collected through Stripe before it is paid out to the bank' }),
      q('INSERT INTO pt_bank_accounts (id, name, account_id, institution, number_last4, routing, opening_date, opening_cents, revision) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)', bankId, 'Stripe balance', ledger, 'Stripe', '0000', '', businessDay((await sendingSettings(c.db)).time_zone), uid()))
  }
  if (!feeId) {
    feeId = uid()
    statements.push(accountInsert(feeId, { code: await nextCode(c.db, 6450), name: 'Stripe fees', type: 'expense', subtype: 'other', description: 'Card and ACH processing fees Stripe deducts' }))
  }
  // Stripe offers ACH bank debit only to US accounts.
  const country = String(account.country ?? 'US').toUpperCase(), us = country === 'US'
  const name = account.settings?.dashboard?.display_name || account.business_profile?.name || account.email || account.id
  statements.push(q(`INSERT INTO pt_stripe (id, key_sealed, key_hint, livemode, account_id, account_name, settlement_currency, country, webhook_id, webhook_secret_sealed, card, ach, bank_account_id, fee_account_id, connected_by, connected_at, revision)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET key_sealed = excluded.key_sealed, key_hint = excluded.key_hint, livemode = excluded.livemode, account_id = excluded.account_id, account_name = excluded.account_name, settlement_currency = excluded.settlement_currency, country = excluded.country, ach = excluded.ach, webhook_id = excluded.webhook_id, webhook_secret_sealed = excluded.webhook_secret_sealed, connected_by = excluded.connected_by, connected_at = excluded.connected_at, revision = excluded.revision`,
    await seal(c.env, key), `…${key.slice(-4)}`, key.includes('_live_') ? 1 : 0, account.id, String(name), String(account.default_currency ?? 'usd').toLowerCase(), country, hook?.id ?? null, hook ? await seal(c.env, hook.secret) : null, us ? 1 : 0, bankId, feeId, c.actor.email, now(), uid()),
    audit(who(c.actor), 'stripe.connect', 'stripe', '1', { account: account.id, livemode: key.includes('_live_'), webhook: !!hook }))
  await run(c.db, statements)
  return stripeView(c.env, c.db)
} }

const methods: Command = { need: 'owner', async run(c, b) {
  const on = (v: unknown) => v === true || v === 'true' || v === 'on' ? 1 : 0
  const s = await stripeSettings(c.db)
  requireThat(s, 'Connect Stripe first', 409)
  requireThat(!on(b.ach) || s.country === 'US', `Stripe offers ACH bank debit only to US accounts; this account is in ${s.country}`, 409)
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_stripe SET card = ?, ach = ?, revision = ? WHERE id = 1', on(b.card), on(b.ach), uid()), changed(), audit(who(c.actor), 'stripe.methods', 'stripe', '1', { card: !!on(b.card), ach: !!on(b.ach) })])
  return stripeView(c.env, c.db)
} }

const disconnect: Command = { need: 'owner', async run(c) {
  const s = await stripeSettings(c.db)
  requireThat(s, 'Stripe is not connected', 409)
  if (s.webhook_id) await stripeCall(await unseal(c.env, s.key_sealed), 'DELETE', `/webhook_endpoints/${s.webhook_id}`).catch(() => null)
  await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_stripe WHERE id = 1'), changed(), audit(who(c.actor), 'stripe.disconnect', 'stripe', '1')])
  return stripeView(c.env, c.db)
} }

export const stripeCommands: Record<string, Command> = {
  'stripe.connect': connect,
  'stripe.methods': methods,
  'stripe.disconnect': disconnect,
}

export async function stripeView(env: Bindings, db: D1Database) {
  const s = await stripeSettings(db), origin = runtimeBindings(env).AUTH_ORIGIN
  return {
    managed: managedInstall(env), publicOrigin: origin.startsWith('https://'),
    connected: s ? { keyHint: s.key_hint, livemode: !!s.livemode, account: s.account_name, accountId: s.account_id, settlementCurrency: s.settlement_currency, webhook: !!s.webhook_id, card: !!s.card, ach: !!s.ach, country: s.country, connectedBy: s.connected_by, connectedAt: s.connected_at } : null,
  }
}

/** The methods a customer may use now on this invoice. */
export async function offeredMethods(env: Bindings, db: D1Database, customerId: string): Promise<(Method | 'offline')[]> {
  const customer = await one(db, "SELECT * FROM pt_contacts WHERE id = ? AND kind = 'customer'", customerId)
  requireThat(customer, 'Customer not found', 404)
  const allowed = customerPaymentMethods(customer)
  const s = await paymentBlock(env, db) ? null : await stripeSettings(db)
  const available: (Method | 'offline')[] = [...(s?.card ? ['card' as const] : []), ...(s?.ach && s.country === 'US' ? ['us_bank_account' as const] : []), 'offline']
  return available.filter(method => allowed.includes(method))
}

/** Start Stripe Checkout for the invoice's open balance; returns the address to send the customer to. */
export async function startCheckout(env: Bindings, db: D1Database, token: string, method: string) {
  const inv = await invoiceByLink(db, token)
  requireThat(inv, 'Invoice not found', 404)
  requireThat(inv.open_cents > 0, 'This invoice is already paid', 409)
  const offered = await offeredMethods(env, db, inv.customer_id)
  requireThat((method === 'card' || method === 'us_bank_account') && (offered as string[]).includes(method), 'That payment method is not offered for this invoice', 409)
  const s = (await stripeSettings(db))!, link = customerLink(env, token)
  const e = await one(db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  const charge = await checkoutAmount(db, inv)
  const session = await stripeCall(await unseal(env, s.key_sealed), 'POST', '/checkout/sessions', {
    mode: 'payment', allowed_payment_method_types: [method], client_reference_id: inv.id, ...(inv.customer_email ? { customer_email: inv.customer_email } : {}), ...(charge.expiresAt ? { expires_at: charge.expiresAt } : {}),
    line_items: [{ quantity: 1, price_data: { currency: 'usd', unit_amount: charge.amount, product_data: { name: `Invoice ${inv.number}`, description: `${e?.legal_name ?? 'Pantry'} · ${inv.customer_name}${charge.windowEnd ? ' · early-payment discount' : ''}` } } }],
    metadata: { pantry_invoice: inv.id, pantry_number: inv.number }, payment_intent_data: { description: `Invoice ${inv.number}`, metadata: { pantry_invoice: inv.id, pantry_number: inv.number } },
    success_url: `${link}?checkout={CHECKOUT_SESSION_ID}`, cancel_url: link,
  })
  try { await run(db, [guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND status='issued' AND void_date IS NULL AND revision=? AND link_token=?)",inv.id,inv.revision,token), q("INSERT INTO pt_stripe_payments (id, invoice_id, method, amount_cents, status, created_at, updated_at, early_window_end) VALUES (?, ?, ?, ?, 'open', ?, ?, ?)", session.id, inv.id, method, charge.amount, now(), now(), charge.windowEnd),
    audit(pantry('customer'), 'stripe.checkout', 'invoice', inv.id, { method, amount: charge.amount, earlyPaymentWindowEnd: charge.windowEnd })]) } catch (error) {
    await stripeCall(await unseal(env,s.key_sealed),'POST',`/checkout/sessions/${encodeURIComponent(session.id)}/expire`)
    throw error
  }
  return String(session.url)
}

const dollars = (c: number) => (c / 100).toFixed(2)

/** Read a Checkout Session back from Stripe and record what it says; safe to repeat. */
export async function syncCheckout(env: Bindings, db: D1Database, sessionId: string) {
  if (await isAutopayPayment(db, sessionId)) return syncAutopayPayment(env, db, sessionId)
  const row = await one(db, 'SELECT * FROM pt_stripe_payments WHERE id = ?', sessionId)
  if (!row || (row.status === 'succeeded' && row.fee_entry_id) || ['failed', 'expired', 'returned', 'disputed', 'refunded'].includes(row.status)) return row
  const s = await stripeSettings(db)
  if (!s) return row
  const key = await unseal(env, s.key_sealed)
  const session = await stripeCall(key, 'GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`, { expand: ['payment_intent.latest_charge.balance_transaction'] })
  const pi: Data | null = typeof session.payment_intent === 'object' ? session.payment_intent : null
  const set = (status: string) => db.prepare('UPDATE pt_stripe_payments SET status = ?, payment_intent = ?, updated_at = ? WHERE id = ? AND status <> ?').bind(status, pi?.id ?? null, now(), sessionId, 'succeeded').run()
  if (session.status === 'expired') { await set('expired'); return one(db, 'SELECT * FROM pt_stripe_payments WHERE id = ?', sessionId) }
  if (!pi) return row
  if (pi.status === 'processing') await set('processing')
  else if (session.status === 'complete' && ['requires_payment_method', 'canceled'].includes(pi.status)) await set('failed')
  else if (pi.status === 'succeeded') await recordSucceeded(env, db, row, pi, key, s)
  const current = await one(db, 'SELECT * FROM pt_stripe_payments WHERE id = ?', sessionId)
  if (current && ['processing','succeeded'].includes(current.status)) await notifyPayment(env,db,sessionId,current.status === 'processing' ? 'processing' : 'receipt',methodDetail(pi.latest_charge ?? {},session.customer_details?.email ?? session.customer_email ?? pi.receipt_email))
  return current
}

export async function recordSucceeded(env: Bindings, db: D1Database, row: Data, pi: Data, key: string, s: Data) {
  const charge = typeof pi.latest_charge === 'object' ? pi.latest_charge : null
  let bt = charge && typeof charge.balance_transaction === 'object' ? charge.balance_transaction : null
  if (!bt && charge && typeof charge.balance_transaction === 'string') bt = await stripeCall(key, 'GET', `/balance_transactions/${charge.balance_transaction}`)
  const inv = await invoice(db, row.invoice_id), day = bt?.created ? new Date(Number(bt.created) * 1000).toISOString().slice(0, 10) : businessDay((await sendingSettings(db)).time_zone)
  const dimensions = await processorDimensions(db)
  const statements: Sql[] = []
  if (row.status !== 'succeeded') {
    const imported = await one(db, "SELECT id FROM pt_stripe_clearing_items WHERE payment_intent = ? AND status IN ('posted', 'legacy-covered') AND entry_id IS NOT NULL", pi.id)
    requireThat(!imported, `Stripe charge ${imported?.id} was already imported; review its sales entry before recording this invoice receipt`, 409)
    const amount = Number(pi.amount_received)
    const p = await paymentStatements(db, pantry('stripe'), {
      direction: 'received', contactId: inv.customer_id, date: day, amount: dollars(amount), bankAccountId: s.bank_account_id, reference: pi.id,
      memo: `Paid ${row.method === 'card' ? 'by card' : 'by ACH bank debit'} through the invoice link`,
      allocations: inv.open_cents > 0 ? [{ targetId: inv.id, amount: dollars(Math.min(amount, inv.open_cents)) }] : [],
    }, { sessionCounts: !!row.early_window_end, bankCoding:dimensions.coding('clearing'), controlCoding:dimensions.coding('receivable') })
    statements.push(guard("NOT EXISTS (SELECT 1 FROM pt_stripe_clearing_items WHERE payment_intent = ? AND status IN ('posted', 'legacy-covered') AND entry_id IS NOT NULL)", pi.id), ...p.statements, q("UPDATE pt_stripe_payments SET status = 'succeeded', payment_intent = ?, payment_id = ?, updated_at = ? WHERE id = ? AND status <> 'succeeded'", pi.id, p.id, now(), row.id), changed())
  }
  // Pantry keeps USD books. An account that settles in another currency reports its fee in that
  // currency; the fee is booked in dollars at Stripe's own conversion rate for the charge.
  const usdFee = !bt || !(Number(bt.fee) > 0) ? 0 : bt.currency === 'usd' ? Number(bt.fee) : bt.exchange_rate ? Math.round(Number(bt.fee) / Number(bt.exchange_rate)) : 0
  if (usdFee > 0 && !row.fee_entry_id) {
    const feeEntry = uid(), fee = usdFee
    const converted = bt.currency === 'usd' ? '' : `, ${String(bt.currency).toUpperCase()} ${(Number(bt.fee) / 100).toFixed(2)} at Stripe's rate ${bt.exchange_rate}`
    statements.push(...entryStatements({ id: feeEntry, date: day, memo: `Stripe fee on invoice ${inv.number} (${usd(fee)}${converted})`, sourceKind: 'bank', sourceId: row.id, preparedBy: pantry('stripe').email, preparedKind: 'import', lines: [
      { ...dimensions.coding('fees'), accountId: s.fee_account_id, debit: fee, credit: 0, memo: `Stripe fee ${pi.id}` }, { ...dimensions.coding('clearing'), accountId: (await one(db, 'SELECT account_id FROM pt_bank_accounts WHERE id = ?', s.bank_account_id))!.account_id, debit: 0, credit: fee, memo: `Stripe fee ${pi.id}` }] }, pantry('stripe').email),
      q('UPDATE pt_stripe_payments SET fee_cents = ?, fee_entry_id = ?, updated_at = ? WHERE id = ? AND fee_entry_id IS NULL', fee, feeEntry, now(), row.id), changed())
  }
  if (!statements.length) return
  statements.unshift(...dimensions.guards)
  statements.push(audit(pantry('stripe'), 'stripe.payment', 'invoice', inv.id, { session: row.id, paymentIntent: pi.id, method: row.method, amount: Number(pi.amount_received), fee: usdFee || null, feeCurrency: bt?.currency ?? null }))
  try { await run(db, statements) } catch (error) {
    // Another confirmation (return, webhook or due work) may have recorded it first.
    const now_ = await one(db, 'SELECT status, fee_entry_id FROM pt_stripe_payments WHERE id = ?', row.id)
    if (error instanceof Fault && now_?.status === 'succeeded' && (now_.fee_entry_id || !usdFee)) return
    throw error
  }
}

/** Due work: follow Checkout Sessions still open or processing, and fees not yet booked. */
export async function syncPendingCheckouts(env: Bindings, db: D1Database) {
  if (managedInstall(env) || !await stripeSettings(db)) return
  const pending = await all<{ id: string }>(db, "SELECT id FROM pt_stripe_payments WHERE status IN ('open', 'processing') OR (status = 'succeeded' AND fee_entry_id IS NULL AND updated_at > ?) ORDER BY created_at DESC LIMIT 20", new Date(Date.now() - 3 * 86400000).toISOString())
  for (const p of pending) await syncCheckout(env, db, p.id)
}

export async function invoicePayments(db: D1Database, invoiceId: string) {
  return all(db, 'SELECT id, method, amount_cents, status, fee_cents, created_at, updated_at, refunded_cents, disputed_cents, evidence_due_by, return_entry_id, return_code, return_reason FROM pt_stripe_payments WHERE invoice_id = ? ORDER BY created_at DESC', invoiceId)
}
