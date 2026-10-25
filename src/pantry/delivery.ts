// Sending invoices. An issued invoice goes to the customer by email with its
// PDF attached and a link to its customer page; every message is a delivery
// row written before the send and finished with the provider's answer, so a
// reminder step is claimed once. Reminders follow the business's schedule
// (days before or after the due date) and stop once the invoice is paid.
import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { authority, ownerEmail, pantry, who } from './access'
import { addDays, daysBetween, longDay, now, optionalText, requireThat, sha256, text, uid, usd, type Data } from './core'
import { all, audit, changed, guard, one, q, run, type AuditActor, type Sql } from './db'
import { invoice } from './invoices'
import { customerRecipients } from './customer-profile'
import { ensureLink, invoiceLinkCommands } from './invoice-links'
export { ensureLink } from './invoice-links'
import { buildInvoiceDocument, issuedDocument } from './invoice-documents'
import { customerReminderDays, reminderDays, reminderWording, renderReminder } from './reminder-content'
import { claimReminderBatch, reminderBatchClaim, reminderEligible, type ReminderBatch } from './reminder-claims'
import type { Command } from './context'

type MailResult = { status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain' | 'development'; provider: string; providerMessageId: string | null; code?: string }
type InvoiceMailer = { send(message: Data): Promise<MailResult> }

type Sending = { reminder_subject: string; reminder_body: string; reminders_on: number; reminder_days: number[]; time_zone: string; reply_to: string; revision: string; updated_by: string | null; updated_at: string | null }

export async function sendingSettings(db: D1Database): Promise<Sending> {
  const s = (await one(db, 'SELECT * FROM pt_sending WHERE id = 1'))!
  return { ...s, reminder_days: JSON.parse(s.reminder_days) } as Sending
}

/** Today on the business's calendar. */
export function businessDay(timeZone: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export const customerLink = (env: Bindings, token: string) => `${runtimeBindings(env).AUTH_ORIGIN}/i/${token}`

/** The PDF and the customer page show the same facts. */
export async function invoiceDocument(db: D1Database, inv: Data) {
  return inv.status === 'issued' ? (await issuedDocument(db, inv.id)).document : buildInvoiceDocument(db, inv)
}

function reminderSubject(number: string, step: number, business: string) {
  const when = step < 0 ? `is due in ${-step} day${step === -1 ? '' : 's'}` : step === 0 ? 'is due today' : `is ${step} day${step === 1 ? '' : 's'} overdue`
  return `Reminder: invoice ${number} from ${business} ${when}`
}

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!))

/**
 * Send one message about an issued invoice to one recipient and record it.
 * Returns the delivery row. A reminder whose step (or day) is already claimed
 * returns null without sending.
 */
export async function deliver(env: Bindings, db: D1Database, actor: AuditActor, invoiceId: string, recipient: string, kind: 'invoice' | 'reminder', step: number | null = null, approved?:{subject:string;body:string;claim:Sql[];onClaim:(id:string)=>Sql[]}, batch?: ReminderBatch): Promise<Data | null> {
  recipient = recipient.trim().toLowerCase()
  const mailer = operatorMail(runtimeBindings(env)) as unknown as InvoiceMailer | undefined
  requireThat(mailer, 'No mail provider is set up for this installation, so Pantry cannot send email. Set MAIL_PROVIDER and MAIL_API_KEY when you deploy.', 409)
  const inv = await invoice(db, invoiceId)
  requireThat(inv.kind === 'invoice' && inv.status === 'issued', 'Issue the invoice before sending it', 409)
  const token = await ensureLink(db, inv.id), link = customerLink(env, token)
  const retained = await issuedDocument(db, inv.id), doc = retained.document, pdf = retained.pdf, settings = await sendingSettings(db)
  const customer = (await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', inv.customer_id))!
  const merge = (value: string) => renderReminder(value, inv, doc.business, customer.name, link)
  const subject = approved?.subject ?? (kind === 'reminder' && settings.reminder_subject ? merge(settings.reminder_subject) : null) ?? (kind === 'invoice' ? `Invoice ${inv.number} from ${doc.business}: ${usd(inv.open_cents)} due ${longDay(inv.due_date)}` : reminderSubject(inv.number, step!, doc.business))
  const id = uid(), reminderBatch = batch ?? { id: uid(), day: businessDay(settings.time_zone) }
  try {
    const claim=q("INSERT INTO pt_deliveries (id, invoice_id, kind, step, recipient, subject, status, attachment_sha256, sent_by, at,reminder_day) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?,?)",id,inv.id,kind,step,recipient,subject,retained.sha256,actor.email,now(),kind==='reminder'?reminderBatch.day:null)
    const fence = kind === 'reminder' ? [guard(reminderEligible, inv.id), ...(batch ? [guard('EXISTS(SELECT 1 FROM pt_reminder_batches WHERE invoice_id=? AND day=? AND id=?) AND EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND reminders_paused=0)', inv.id, batch.day, batch.id, inv.id)] : [reminderBatchClaim(inv.id, reminderBatch), changed()])] : []
    await run(db, [...(approved?.claim ?? []), ...fence, claim, ...(approved?.onClaim(id) ?? [])])
  } catch (error) {
    if (kind === 'reminder' && (/UNIQUE/i.test(String((error as Error).message)) || String((error as Error).message).startsWith('That record already exists: '))) return null
    throw error
  }
  const lead = approved?.body ?? (kind === 'reminder' && settings.reminder_body ? merge(settings.reminder_body) : null) ?? (kind === 'invoice' ? `${doc.business} has sent you invoice ${inv.number} for ${usd(inv.total_cents)}, due ${longDay(inv.due_date)}.` : `This is a reminder that invoice ${inv.number} from ${doc.business} ${step! < 0 ? `is due on ${longDay(inv.due_date)}` : step === 0 ? 'is due today' : `was due on ${longDay(inv.due_date)}`}. ${usd(inv.open_cents)} is still open.`)
  const textBody = `${lead}\n\nView the invoice and pay: ${link}\n\nThe invoice is attached as a PDF. Reply to this email to reach ${doc.business}.\n`
  const html = `<p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(link)}">View invoice ${escapeHtml(inv.number)}</a></p><p>The invoice is attached as a PDF. Reply to this email to reach ${escapeHtml(doc.business)}.</p>`
  const fromName = doc.business.replace(/[<>"\\,;:@()[\]]/g, '').trim()
  const from = String(env.MAIL_FROM ?? '').trim()
  let result: MailResult | null = null, detail = ''
  try {
    requireThat(from, 'MAIL_FROM is not set for this installation', 409)
    result = await mailer.send({
      deliveryId: id, from: fromName ? `${fromName} <${from.replace(/^.*<([^>]+)>.*$/, '$1')}>` : from, to: [recipient], subject, text: textBody, html,
      replyTo: settings.reply_to || await ownerEmail(db, env), attachments: [{ filename: `${inv.number}.pdf`, contentType: 'application/pdf', content: pdf }],
    })
    detail = result.code ?? ''
  } catch (error) {
    // The mail module refuses a malformed message with a MailValidationError naming its code.
    const mailCode = (error as Error)?.name === 'MailValidationError' ? (error as Data).code : null
    if (!mailCode && !(error instanceof Error && 'status' in error)) throw error
    detail = mailCode ? `The message was refused before sending (${mailCode})` : (error as Error).message
  }
  const status = !result ? 'failed' : result.status === 'development' ? 'suppressed' : result.status
  if (status === 'suppressed') detail = 'Local runs send no email; deploy with a mail provider to send it'
  await run(db, [
    q('UPDATE pt_deliveries SET status = ?, provider = ?, provider_message_id = ?, detail = ?, finished_at = ? WHERE id = ?', status, result?.provider ?? '', result?.providerMessageId ?? null, detail, now(), id),
    ...(status === 'accepted' && kind === 'invoice' ? [q('UPDATE pt_invoices SET sent_at = COALESCE(sent_at, ?) WHERE id = ?', now(), inv.id)] : []),
    audit(actor, kind === 'invoice' ? 'invoice.send' : 'invoice.remind', 'invoice', inv.id, { recipient, status, step }),
  ])
  return (await one(db, 'SELECT * FROM pt_deliveries WHERE id = ?', id))!
}

function recipients(raw: unknown, defaults: string[]) {
  const list = (typeof raw === 'string' ? raw.split(/[,;\s]+/) : Array.isArray(raw) ? raw : []).map(x => String(x).trim().toLowerCase()).filter(Boolean)
  const out = [...new Set(list.length ? list : defaults.map(r => r.trim().toLowerCase()).filter(Boolean))]
  requireThat(out.length, "Add the customer's email address, or name who should receive the invoice")
  requireThat(!list.length || out.length <= 5, 'Send to at most five addresses at a time')
  for (const r of out) requireThat(/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(r), `${r} is not an email address`)
  return out
}

const sendInvoice: Command = { need: 'record', async run(c, b) {
  const inv = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(inv.kind === 'invoice' && inv.status === 'issued', 'Issue the invoice before sending it', 409)
  requireThat(inv.open_cents > 0, 'This invoice is paid; there is nothing to send', 409)
  const customer = (await one(c.db, 'SELECT * FROM pt_contacts WHERE id = ?', inv.customer_id))!
  const to = recipients(b.to, customerRecipients(customer))
  await run(c.db, [authority(c.actor, 'record')])
  const deliveries = []
  for (const r of to) deliveries.push(await deliver(c.env, c.db, who(c.actor), inv.id, r, 'invoice'))
  return { deliveries, invoice: await invoice(c.db, inv.id) }
} }

const pauseReminders: Command = { need: 'record', async run(c, b) {
  const inv = await invoice(c.db, text(b.id, 'Invoice'))
  const paused = b.paused === true || b.paused === 'true'
  await run(c.db, [authority(c.actor, 'record'), q('UPDATE pt_invoices SET reminders_paused = ? WHERE id = ?', paused ? 1 : 0, inv.id), changed(), audit(who(c.actor), paused ? 'invoice.reminders-paused' : 'invoice.reminders-resumed', 'invoice', inv.id)])
  return invoice(c.db, inv.id)
} }

const ZONES = ['America/New_York', 'America/Chicago', 'America/Denver', 'America/Phoenix', 'America/Los_Angeles', 'America/Anchorage', 'Pacific/Honolulu', 'America/Puerto_Rico']

const saveSending: Command = { need: 'owner', async run(c, b) {
  const current = await sendingSettings(c.db)
  requireThat(b.revision === current.revision, 'Sending settings changed; reload', 409)
  const days = reminderDays(b.reminderDays)
  const subject = reminderWording(b.reminderSubject, 'Reminder subject', 200, current.reminder_subject)
  const body = reminderWording(b.reminderBody, 'Reminder body', 5000, current.reminder_body)
  const zone = text(b.timeZone, 'Time zone')
  requireThat(ZONES.includes(zone), 'Choose a US time zone')
  const replyTo = optionalText(b.replyTo, 'Reply-to address', 254).toLowerCase()
  requireThat(!replyTo || /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(replyTo), 'Enter a valid reply-to address')
  const on = b.remindersOn === true || b.remindersOn === 'true' || b.remindersOn === 'on'
  const sorted = [...new Set(days)].sort((x, y) => x - y)
  await run(c.db, [authority(c.actor, 'owner'),
    q('UPDATE pt_sending SET reminders_on = ?, reminder_days = ?, time_zone = ?, reply_to = ?, reminder_subject = ?, reminder_body = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?', on ? 1 : 0, JSON.stringify(sorted), zone, replyTo, subject, body, uid(), c.actor.email, now(), current.revision), changed(),
    audit(who(c.actor), 'sending.update', 'sending', '1', { remindersOn: on, reminderDays: sorted, timeZone: zone, reminderSubject: subject, reminderBody: body })])
  return sendingView(c.env, c.db)
} }

export const deliveryCommands: Record<string, Command> = {
  ...invoiceLinkCommands,
  'invoice.send': sendInvoice,
  'invoice.reminders': pauseReminders,
  'sending.save': saveSending,
}

export async function sendingView(env: Bindings, db: D1Database) {
  const e = runtimeBindings(env), mailer = operatorMail(e)
  const mail = !mailer ? 'none' : e.MAIL_PROVIDER === 'development' || e.RER_DEMO === '1' ? 'local' : 'ready'
  return { ...(await sendingSettings(db)), zones: ZONES, mail, from: mail === 'ready' ? e.MAIL_FROM ?? '' : '', ownerEmail: await ownerEmail(db, env) }
}

export async function deliveriesView(db: D1Database) {
  return all(db, 'SELECT d.*, i.number, c.name AS customer_name FROM pt_deliveries d JOIN pt_invoices i ON i.id = d.invoice_id JOIN pt_contacts c ON c.id = i.customer_id ORDER BY d.at DESC, d.id LIMIT 500')
}

/** The reminder step due today for an invoice, if any: the latest step reached and not yet sent (a late run sends only the latest). */
export function dueStep(dueDate: string, today: string, steps: number[], sent: number[]) {
  const reached = steps.filter(s => addDays(dueDate, s) <= today)
  if (!reached.length) return null
  const latest = Math.max(...reached)
  return sent.some(s => s >= latest) ? null : latest
}

/** For the invoice screen: when each sent, open invoice's next reminder goes (today if one is due now). */
export async function reminderPlans(db: D1Database) {
  const settings = await sendingSettings(db), today = businessDay(settings.time_zone), plans: Record<string, string | null> = {}
  if (!settings.reminders_on) return { today, on: false, days: settings.reminder_days, plans }
  const sent = await all<{ invoice_id: string; step: number; recipient: string }>(db, "SELECT invoice_id, step, recipient FROM pt_deliveries WHERE kind = 'reminder' AND step IS NOT NULL")
  for (const inv of await all(db, "SELECT id, customer_id, due_date FROM pt_invoices WHERE kind = 'invoice' AND status = 'issued' AND sent_at IS NOT NULL AND reminders_paused = 0")) {
    const customer = (await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', inv.customer_id))!
    if (!await one(db, `SELECT 1 WHERE ${reminderEligible}`, inv.id)) { plans[inv.id] = null; continue }
    const batch = await one(db, 'SELECT 1 FROM pt_reminder_batches WHERE invoice_id=? AND day=?', inv.id, today)
    const schedule = customerReminderDays(customer, settings.reminder_days)
    const dates = customerRecipients(customer).flatMap(recipient => {
      const steps = sent.filter(r => r.invoice_id === inv.id && r.recipient.toLowerCase() === recipient.toLowerCase()).map(r => r.step)
      if (dueStep(inv.due_date, today, schedule, steps) !== null) return [batch ? addDays(today, 1) : today]
      return schedule.filter(d => !steps.some(x => x >= d)).map(d => addDays(inv.due_date, d)).filter(d => d > today)
    })
    plans[inv.id] = dates.sort()[0] ?? null
  }
  return { today, on: true, days: settings.reminder_days, plans }
}

/** Send every reminder due today. Paid, paused and never-sent invoices get none; an ACH payment in flight pauses them. */
export async function sendDueReminders(env: Bindings, db: D1Database, today: string) {
  const settings = await sendingSettings(db)
  if (!settings.reminders_on || !operatorMail(runtimeBindings(env))) return []
  const open = await all(db, `SELECT i.id, i.due_date, i.customer_id FROM pt_invoices i
    WHERE i.kind = 'invoice' AND i.status = 'issued' AND i.sent_at IS NOT NULL AND i.reminders_paused = 0
      AND NOT EXISTS (SELECT 1 FROM pt_stripe_payments sp WHERE sp.invoice_id = i.id AND sp.status = 'processing')`)
  const sent: Data[] = []
  for (const row of open) {
    const inv = await invoice(db, row.id)
    if (inv.open_cents <= 0) continue
    const customer = (await one(db, 'SELECT * FROM pt_contacts WHERE id = ?', row.customer_id))!
    const schedule = customerReminderDays(customer, settings.reminder_days)
    const prior = await all<{ step: number; recipient: string }>(db, "SELECT step, recipient FROM pt_deliveries WHERE invoice_id = ? AND kind = 'reminder' AND step IS NOT NULL", inv.id)
    const recipients = customerRecipients(customer)
    const due = recipients.map(recipient => {
      const steps = prior.filter(r => r.recipient.toLowerCase() === recipient.toLowerCase()).map(r => r.step)
      const step = dueStep(inv.due_date, today, schedule, steps)
      return {recipient, step}
    }).filter(d => d.step !== null && daysBetween(inv.due_date, today) - d.step <= 30)
    if (!due.length) continue
    const batch = await claimReminderBatch(db, inv.id, today)
    if (!batch) continue
    for (const {recipient, step} of due) {
      const d = await deliver(env, db, pantry('reminders'), inv.id, recipient, 'reminder', step, undefined, batch)
      if (d) sent.push(d)
    }
  }
  return sent
}

/** The installation mail route for an explicitly reviewed tax batch. */
export async function sendReviewedTaxMail(env: Bindings, recipient: string, subject: string, body: string, deliveryId: string) {
  const mailer = operatorMail(runtimeBindings(env)) as unknown as InvoiceMailer | undefined
  requireThat(mailer, 'No mail route is configured', 409)
  const result = await mailer.send({deliveryId, from: String(env.MAIL_FROM ?? ''), to:[recipient], subject, text:body})
  return {status:result.status === 'development' ? 'suppressed' : result.status, provider:result.provider, providerMessageId:result.providerMessageId, detail:result.status === 'development' ? 'Development mail suppressed; no email sent.' : result.code ?? ''}
}
