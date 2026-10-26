// Payment communications use the installation's single mail route. A durable
// claim precedes transport; uncertain outcomes are retained and never replayed.
import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { authority, must, ownerEmail, pantry, who, type Actor } from './access'
import { bankAuthority } from './access-policy/banks'
import { now, requireThat, text, uid, usd, type Data } from './core'
import { all, audit, guard, one, q, run, type Sql } from './db'
import { customerRecipients } from './customer-profile'
import { sendingSettings } from './delivery'
import { invoice } from './invoices'
import type { Command } from './context'

type Kind = 'processing' | 'receipt' | 'returned'
export type PaymentNoticeDetail = { brand?: string; bank?: string; last4?: string; payerEmail?: string; returnCode?: string; returnReason?: string }
type Source = { sourceId: string; invoiceId: string; paymentId: string | null; sessionId: string | null; kind: Kind; actor?: Actor }
type PaymentMailer = { send(message: Data): Promise<{ status: string; provider: string; providerMessageId?: string | null; code?: string }> }
const email = (value: unknown) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(String(value ?? '')) ? String(value).trim().toLowerCase() : ''
const safe = (value: unknown, max: number) => String(value ?? '').replace(/[\r\n\x00-\x1f\x7f]/g, ' ').slice(0, max)

async function current(db: D1Database, source: Source) {
  const inv = await invoice(db, source.invoiceId)
  const customer = await one(db, 'SELECT * FROM pt_contacts WHERE id=?', inv.customer_id)
  requireThat(customer && !customer.erased_at, 'The customer is no longer available for payment mail', 409)
  requireThat(inv.kind === 'invoice' && inv.status === 'issued', 'Payment mail requires an issued invoice', 409)
  const payment = source.paymentId ? await one(db, 'SELECT p.*, e.status AS entry_status, e.reversed_by_id FROM pt_payments p JOIN pt_journal_entries e ON e.id=p.journal_id WHERE p.id=?', source.paymentId) : null
  const session = source.sessionId ? await one(db, 'SELECT * FROM pt_stripe_payments WHERE id=? AND invoice_id=?', source.sessionId, inv.id) : null
  if (source.sessionId) requireThat(session && session.payment_id === source.paymentId, 'The provider payment changed', 409)
  if (source.kind === 'processing') requireThat(session?.status === 'processing', 'This payment is no longer processing', 409)
  else {
    requireThat(payment && payment.direction === 'received' && payment.contact_id === inv.customer_id && payment.entry_status === 'posted', 'A posted customer payment is required', 409)
    const reversed = payment.reversal_id || payment.reversed_by_id
    requireThat(source.kind === 'returned' ? reversed && inv.open_cents > 0 : !reversed, source.kind === 'returned' ? 'The returned payment must have a linked reversal and an open invoice' : 'A reversed payment cannot receive a receipt', 409)
    requireThat(await one(db, "SELECT 1 FROM pt_allocations WHERE source_kind='payment' AND source_id=? AND target_kind='invoice' AND target_id=?", payment.id, inv.id), 'The payment is not allocated to this invoice', 409)
  }
  const settings = await one(db, 'SELECT * FROM pt_sending WHERE id=1')
  const enabled = source.kind !== 'receipt' || !!(settings?.payment_receipts_on && customer.payment_receipts_on)
  const payer = email(session?.payer_email) || customerRecipients(customer)[0] || ''
  const fences: Sql[] = [guard("EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND erased_at IS NULL AND revision=?)", customer.id, customer.revision), guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND revision=? AND status='issued')", inv.id, inv.revision)]
  if (source.kind === 'receipt') fences.push(guard('EXISTS(SELECT 1 FROM pt_sending WHERE id=1 AND payment_receipts_on=1) AND EXISTS(SELECT 1 FROM pt_contacts WHERE id=? AND payment_receipts_on=1)', customer.id))
  if (session) fences.push(guard('EXISTS(SELECT 1 FROM pt_stripe_payments WHERE id=? AND status=? AND updated_at=? AND payment_id IS ?)', session.id, session.status, session.updated_at, source.paymentId))
  if (payment) fences.push(guard('EXISTS(SELECT 1 FROM pt_payments p JOIN pt_journal_entries e ON e.id=p.journal_id WHERE p.id=? AND p.reversal_id IS ? AND e.reversed_by_id IS ?)', payment.id, payment.reversal_id, payment.reversed_by_id))
  if (source.actor) fences.push(authority(source.actor, 'record'), ...bankAuthority(source.actor, payment ? [payment.bank_account_id] : []))
  return { inv, customer, payment, session, enabled, payer, fences }
}

async function sendNotice(env: Bindings, db: D1Database, source: Source, recipient: string) {
  const state = await current(db, source)
  if (!state.enabled || !email(recipient)) return null
  const owner = source.kind === 'returned' ? await ownerEmail(db, env) : ''
  if (recipient !== state.payer && recipient !== owner) return null
  const existing = await one(db, 'SELECT * FROM pt_payment_notices WHERE source_id=? AND kind=? AND recipient=?', source.sourceId, source.kind, recipient)
  if (existing) return existing
  const entity = await one(db, 'SELECT legal_name FROM pt_entity WHERE id=1')
  const business = safe(entity?.legal_name, 200), { inv, payment, session } = state
  const amount = payment?.amount_cents ?? session?.amount_cents
  const method = session ? `${session.method === 'card' ? safe(session.method_brand, 60) || 'Card' : safe(session.method_bank, 100) || 'Bank account (ACH)'}${/^\d{4}$/.test(session.method_last4) ? ` ending ${session.method_last4}` : ''}` : `${safe(payment?.method, 60) || 'Recorded payment'}${/^\d{4}$/.test(payment?.card_last4) ? ` ending ${payment!.card_last4}` : ''}`
  const discounts = await all(db, 'SELECT number,total_cents,early_reversal_id FROM pt_invoices WHERE credit_for=? AND early_discount=1', inv.id)
  const discount = discounts.filter(d => source.kind === 'returned' ? d.early_reversal_id : !d.early_reversal_id).map(d => `Early-payment discount ${source.kind === 'returned' ? 'reversed' : 'applied'}: ${usd(d.total_cents)} (${d.number}).`).join('\n')
  const title = source.kind === 'receipt' ? 'Payment receipt' : source.kind === 'processing' ? 'Payment received, processing' : 'Payment returned: invoice open again'
  const subject = `${title}: invoice ${inv.number} from ${business}`
  const body = `${business}\nInvoice ${inv.number}\n\n${title}.\nAmount: ${usd(amount)}\nMethod: ${method}\nDate: ${payment?.payment_date ?? session?.updated_at?.slice(0, 10)}\n${discount ? discount + '\n' : ''}Remaining balance: ${usd(inv.open_cents)}\n${source.kind === 'processing' ? '\nYour bank payment is processing. It does not count as paid until it succeeds.\n' : ''}${source.kind === 'returned' ? `\nYour bank payment was returned${session?.return_code ? ` (${safe(session.return_code, 20)})` : ''}${session?.return_reason ? ': ' + safe(session.return_reason, 300) : '.'} The invoice is open again. Please contact ${business} to arrange payment.\n` : ''}`
  const id = uid(), actor = source.actor ? who(source.actor) : pantry('stripe')
  try {
    await run(db, [...state.fences, q("INSERT INTO pt_payment_notices(id,source_id,invoice_id,payment_id,kind,recipient,subject,status,sent_by,at) VALUES(?,?,?,?,?,?,?,'sending',?,?)", id, source.sourceId, inv.id, source.paymentId, source.kind, recipient, subject, actor.email, now())])
  } catch (error) {
    const duplicate = await one(db, 'SELECT * FROM pt_payment_notices WHERE source_id=? AND kind=? AND recipient=?', source.sourceId, source.kind, recipient)
    if (duplicate) return duplicate
    throw error
  }
  let status = 'failed', provider = '', providerId: string | null = null, detail = ''
  try {
    // Check the live source and native session again immediately before outbound.
    const fresh = await current(db, source)
    const currentOwner = source.kind === 'returned' ? await ownerEmail(db, env) : ''
    requireThat(fresh.enabled && (recipient === fresh.payer || recipient === currentOwner), 'Payment mail consent or recipient changed', 409)
    requireThat(fresh.inv.revision === inv.revision && fresh.inv.open_cents === inv.open_cents && fresh.customer.revision === state.customer.revision, 'Payment mail facts changed before sending', 409)
    await run(db, fresh.fences)
    const mailer = operatorMail(runtimeBindings(env)) as unknown as PaymentMailer | undefined
    requireThat(mailer, 'No mail provider is set up for this installation', 409)
    requireThat(env.MAIL_FROM, 'MAIL_FROM is not set for this installation', 409)
    const settings = await sendingSettings(db)
    const result = await mailer.send({ deliveryId: id, from: String(env.MAIL_FROM), to: [recipient], subject, text: body, replyTo: settings.reply_to || await ownerEmail(db, env) })
    status = result.status === 'development' ? 'suppressed' : result.status
    provider = result.provider; providerId = result.providerMessageId ?? null; detail = result.code ?? ''
    if (status === 'suppressed') detail = 'Local runs send no email; deploy with a mail provider to send it'
  } catch (error) {
    // A transport exception may have happened after acceptance. Never retry it.
    status = error instanceof Error && 'status' in error ? 'cancelled' : 'uncertain'
    detail = status === 'cancelled' ? 'Payment mail source, permission or configuration is no longer available' : 'Mail delivery outcome is unknown; this notice will not be sent again automatically'
  }
  await run(db, [q('UPDATE pt_payment_notices SET status=?,provider=?,provider_message_id=?,detail=?,finished_at=? WHERE id=?', status, provider, providerId, detail, now(), id), audit(actor, `payment.${source.kind}`, 'invoice', inv.id, { noticeId: id, paymentId: source.paymentId, status })])
  return one(db, 'SELECT * FROM pt_payment_notices WHERE id=?', id)
}

export async function notifyPayment(env: Bindings, db: D1Database, sessionId: string, kind: Kind, detail?: PaymentNoticeDetail) {
  if (detail) {
    const row = await one(db, 'SELECT * FROM pt_stripe_payments WHERE id=?', sessionId)
    requireThat(row, 'Provider payment not found', 404)
    const last4 = detail.last4 === undefined ? row.method_last4 : /^\d{4}$/.test(detail.last4) ? detail.last4 : ''
    await run(db, [guard("EXISTS(SELECT 1 FROM pt_stripe_payments s JOIN pt_invoices i ON i.id=s.invoice_id JOIN pt_contacts c ON c.id=i.customer_id WHERE s.id=? AND s.updated_at=? AND c.erased_at IS NULL AND i.status='issued')", sessionId, row.updated_at), q('UPDATE pt_stripe_payments SET method_brand=?,method_bank=?,method_last4=?,payer_email=?,return_code=?,return_reason=? WHERE id=?', detail.brand === undefined ? row.method_brand : safe(detail.brand, 60), detail.bank === undefined ? row.method_bank : safe(detail.bank, 100), last4, detail.payerEmail === undefined ? row.payer_email : email(detail.payerEmail), detail.returnCode === undefined ? row.return_code : safe(detail.returnCode, 20), detail.returnReason === undefined ? row.return_reason : safe(detail.returnReason, 300), sessionId)])
  }
  const session = await one(db, 'SELECT * FROM pt_stripe_payments WHERE id=?', sessionId)
  requireThat(session, 'Provider payment not found', 404)
  const source: Source = { sourceId: sessionId, sessionId, invoiceId: session.invoice_id, paymentId: session.payment_id, kind }
  const state = await current(db, source)
  const recipients = [state.payer, ...(kind === 'returned' ? [await ownerEmail(db, env)] : [])].filter(Boolean)
  const deliveries = []
  for (const recipient of [...new Set(recipients)]) deliveries.push(await sendNotice(env, db, source, recipient))
  return { deliveries: deliveries.filter(Boolean) }
}

const preference: Command = { need: 'owner', async run(c, b) {
  must(c.actor, 'owner')
  requireThat(typeof b.enabled === 'boolean', 'Choose whether payment receipts are enabled')
  const customerId = b.customerId ? text(b.customerId, 'Customer') : null
  if (customerId) requireThat(await one(c.db, "SELECT 1 FROM pt_contacts WHERE id=? AND kind='customer' AND erased_at IS NULL", customerId), 'Customer not found', 404)
  await run(c.db, [authority(c.actor, 'owner'), customerId ? q("UPDATE pt_contacts SET payment_receipts_on=?,revision=? WHERE id=? AND kind='customer' AND erased_at IS NULL", b.enabled ? 1 : 0, uid(), customerId) : q('UPDATE pt_sending SET payment_receipts_on=?,revision=? WHERE id=1', b.enabled ? 1 : 0, uid()), audit(who(c.actor), 'payment.receipts-preference', customerId ? 'customer' : 'sending', customerId ?? '1', { enabled: b.enabled })])
  return { customerId, enabled: b.enabled }
} }

const manual: Command = { need: 'record', async run(c, b) {
  must(c.actor, 'record')
  const paymentId = text(b.paymentId ?? b.id, 'Payment'), invoiceId = text(b.invoiceId, 'Invoice')
  const session = await one(c.db, 'SELECT id FROM pt_stripe_payments WHERE payment_id=? AND invoice_id=?', paymentId, invoiceId)
  const source: Source = { sourceId: session?.id ?? `payment:${paymentId}:${invoiceId}`, sessionId: session?.id ?? null, paymentId, invoiceId, kind: 'receipt', actor: c.actor }
  const state = await current(c.db, source)
  requireThat(state.enabled, 'Payment receipts are turned off for this business or customer', 409)
  requireThat(state.payer, 'Add the customer billing email before sending a receipt', 409)
  return { deliveries: [await sendNotice(c.env, c.db, source, state.payer)] }
} }

export const paymentNoticeCommands: Record<string, Command> = { 'payment.receipts-preference': preference, 'payment.receipt': manual }
export async function paymentNoticesView(db: D1Database, invoiceId?: string) {
  return all(db, `SELECT * FROM pt_payment_notices${invoiceId ? ' WHERE invoice_id=?' : ''} ORDER BY at DESC,id LIMIT 500`, ...(invoiceId ? [invoiceId] : []))
}
