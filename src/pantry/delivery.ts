// Sending invoices. An issued invoice goes to the customer by email with its
// PDF attached and a link to its customer page; every message is a delivery
// row written before the send and finished with the provider's answer, so a
// reminder step is claimed once. Reminders follow the business's schedule
// (days before or after the due date) and stop once the invoice is paid.
import { runtimeBindings, type Bindings } from '../auth.server'
import { operatorMail } from '../mail.server.mjs'
import { authority, pantry, who } from './access'
import { addDays, daysBetween, longDay, now, optionalText, requireThat, sha256, text, uid, usd, type Data } from './core'
import { all, audit, changed, one, q, run, type AuditActor } from './db'
import { invoice } from './invoices'
import { invoicePdf } from './invoice-pdf'
import type { Command } from './context'

type MailResult = { status: 'accepted' | 'rejected' | 'rate_limited' | 'uncertain' | 'development'; provider: string; providerMessageId: string | null; code?: string }
type InvoiceMailer = { send(message: Data): Promise<MailResult> }

type Sending = { reminders_on: number; reminder_days: number[]; time_zone: string; reply_to: string; revision: string; updated_by: string | null; updated_at: string | null }

export async function sendingSettings(db: D1Database): Promise<Sending> {
  const s = (await one(db, 'SELECT * FROM pt_sending WHERE id = 1'))!
  return { ...s, reminder_days: JSON.parse(s.reminder_days) } as Sending
}

/** Today on the business's calendar. */
export function businessDay(timeZone: string, at = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).format(at)
}

export const customerLink = (env: Bindings, token: string) => `${runtimeBindings(env).AUTH_ORIGIN}/i/${token}`

function newToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** The invoice's customer link token, made on first send. */
export async function ensureLink(db: D1Database, invoiceId: string) {
  const token = newToken()
  await db.prepare('UPDATE pt_invoices SET link_token = ? WHERE id = ? AND link_token IS NULL').bind(token, invoiceId).run()
  return (await one<{ link_token: string }>(db, 'SELECT link_token FROM pt_invoices WHERE id = ?', invoiceId))!.link_token
}

/** The PDF and the customer page show the same facts. */
export async function invoiceDocument(db: D1Database, inv: Data) {
  const e = await one(db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  const paid = inv.total_cents - inv.open_cents
  return {
    business: e?.legal_name ?? 'Pantry',
    title: `Invoice ${inv.number}`,
    facts: [['Billed to', inv.customer_name], ['Issued', longDay(inv.issue_date)], ['Due', longDay(inv.due_date)]] as [string, string][],
    lines: inv.lines.map((l: Data) => ({ description: l.description, quantity: String(l.quantity_milli / 1000), amount: usd(l.amount_cents) })),
    totals: [['Subtotal', usd(inv.subtotal_cents)], ['Sales tax', usd(inv.tax_cents)], ['Total', usd(inv.total_cents)], ...(paid ? [['Paid', usd(paid)] as [string, string]] : []), ['Amount due', usd(inv.open_cents)]] as [string, string][],
    notes: inv.memo ? [inv.memo] : [],
  }
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
export async function deliver(env: Bindings, db: D1Database, actor: AuditActor, invoiceId: string, recipient: string, kind: 'invoice' | 'reminder', step: number | null = null): Promise<Data | null> {
  const mailer = operatorMail(runtimeBindings(env)) as unknown as InvoiceMailer | undefined
  requireThat(mailer, 'No mail provider is set up for this installation, so Pantry cannot send email. Set MAIL_PROVIDER and MAIL_API_KEY when you deploy.', 409)
  const inv = await invoice(db, invoiceId)
  requireThat(inv.kind === 'invoice' && inv.status === 'issued', 'Issue the invoice before sending it', 409)
  const token = await ensureLink(db, inv.id), link = customerLink(env, token)
  const doc = await invoiceDocument(db, inv), pdf = invoicePdf(doc), settings = await sendingSettings(db)
  const subject = kind === 'invoice' ? `Invoice ${inv.number} from ${doc.business}: ${usd(inv.open_cents)} due ${longDay(inv.due_date)}` : reminderSubject(inv.number, step!, doc.business)
  const id = uid()
  try {
    await db.prepare("INSERT INTO pt_deliveries (id, invoice_id, kind, step, recipient, subject, status, attachment_sha256, sent_by, at) VALUES (?, ?, ?, ?, ?, ?, 'sending', ?, ?, ?)")
      .bind(id, inv.id, kind, step, recipient, subject, await sha256(pdf), actor.email, now()).run()
  } catch (error) {
    if (kind === 'reminder' && String((error as Error).message).includes('UNIQUE')) return null
    throw error
  }
  const lead = kind === 'invoice' ? `${doc.business} has sent you invoice ${inv.number} for ${usd(inv.total_cents)}, due ${longDay(inv.due_date)}.` : `This is a reminder that invoice ${inv.number} from ${doc.business} ${step! < 0 ? `is due on ${longDay(inv.due_date)}` : step === 0 ? 'is due today' : `was due on ${longDay(inv.due_date)}`}. ${usd(inv.open_cents)} is still open.`
  const textBody = `${lead}\n\nView the invoice and pay: ${link}\n\nThe invoice is attached as a PDF. Reply to this email to reach ${doc.business}.\n`
  const html = `<p>${escapeHtml(lead)}</p><p><a href="${escapeHtml(link)}">View invoice ${escapeHtml(inv.number)}</a></p><p>The invoice is attached as a PDF. Reply to this email to reach ${escapeHtml(doc.business)}.</p>`
  const fromName = doc.business.replace(/[<>"\\,;:@()[\]]/g, '').trim()
  const from = String(env.MAIL_FROM ?? '').trim()
  let result: MailResult | null = null, detail = ''
  try {
    requireThat(from, 'MAIL_FROM is not set for this installation', 409)
    result = await mailer.send({
      deliveryId: id, from: fromName ? `${fromName} <${from.replace(/^.*<([^>]+)>.*$/, '$1')}>` : from, to: [recipient], subject, text: textBody, html,
      replyTo: settings.reply_to || runtimeBindings(env).OWNER_EMAIL, attachments: [{ filename: `${inv.number}.pdf`, contentType: 'application/pdf', content: pdf }],
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

function recipients(raw: unknown, fallback: string) {
  const list = (typeof raw === 'string' ? raw.split(/[,;\s]+/) : Array.isArray(raw) ? raw : []).map(x => String(x).trim().toLowerCase()).filter(Boolean)
  const out = list.length ? list : fallback ? [fallback] : []
  requireThat(out.length, "Add the customer's email address, or name who should receive the invoice")
  requireThat(out.length <= 5, 'Send to at most five addresses at a time')
  for (const r of out) requireThat(/^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(r), `${r} is not an email address`)
  return [...new Set(out)]
}

const sendInvoice: Command = { need: 'record', async run(c, b) {
  const inv = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(inv.kind === 'invoice' && inv.status === 'issued', 'Issue the invoice before sending it', 409)
  requireThat(inv.open_cents > 0, 'This invoice is paid; there is nothing to send', 409)
  const to = recipients(b.to, inv.customer_email)
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
  const days = (typeof b.reminderDays === 'string' ? b.reminderDays.split(/[,\s]+/).filter(Boolean) : Array.isArray(b.reminderDays) ? b.reminderDays : []).map(Number)
  requireThat(days.length <= 8 && days.every(d => Number.isInteger(d) && d >= -60 && d <= 120), 'Reminder days are whole numbers from -60 (before the due date) to 120 (after it), at most eight')
  const zone = text(b.timeZone, 'Time zone')
  requireThat(ZONES.includes(zone), 'Choose a US time zone')
  const replyTo = optionalText(b.replyTo, 'Reply-to address', 254).toLowerCase()
  requireThat(!replyTo || /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(replyTo), 'Enter a valid reply-to address')
  const on = b.remindersOn === true || b.remindersOn === 'true' || b.remindersOn === 'on'
  const sorted = [...new Set(days)].sort((x, y) => x - y)
  await run(c.db, [authority(c.actor, 'owner'),
    q('UPDATE pt_sending SET reminders_on = ?, reminder_days = ?, time_zone = ?, reply_to = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?', on ? 1 : 0, JSON.stringify(sorted), zone, replyTo, uid(), c.actor.email, now(), current.revision), changed(),
    audit(who(c.actor), 'sending.update', 'sending', '1', { remindersOn: on, reminderDays: sorted, timeZone: zone })])
  return sendingView(c.env, c.db)
} }

export const deliveryCommands: Record<string, Command> = {
  'invoice.send': sendInvoice,
  'invoice.reminders': pauseReminders,
  'sending.save': saveSending,
}

export async function sendingView(env: Bindings, db: D1Database) {
  const e = runtimeBindings(env), mailer = operatorMail(e)
  const mail = !mailer ? 'none' : e.MAIL_PROVIDER === 'development' || e.RER_DEMO === '1' ? 'local' : 'ready'
  return { ...(await sendingSettings(db)), zones: ZONES, mail, from: mail === 'ready' ? e.MAIL_FROM ?? '' : '', ownerEmail: e.OWNER_EMAIL }
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
  const sent = await all<{ invoice_id: string; step: number }>(db, "SELECT invoice_id, step FROM pt_deliveries WHERE kind = 'reminder'")
  for (const inv of await all(db, "SELECT id, due_date FROM pt_invoices WHERE kind = 'invoice' AND status = 'issued' AND sent_at IS NOT NULL AND reminders_paused = 0")) {
    const steps = sent.filter(r => r.invoice_id === inv.id).map(r => r.step)
    if (dueStep(inv.due_date, today, settings.reminder_days, steps) !== null) { plans[inv.id] = today; continue }
    plans[inv.id] = settings.reminder_days.filter(d => !steps.some(x => x >= d)).map(d => addDays(inv.due_date, d)).filter(d => d > today).sort()[0] ?? null
  }
  return { today, on: true, days: settings.reminder_days, plans }
}

/** Send every reminder due today. Paid, paused and never-sent invoices get none; an ACH payment in flight pauses them. */
export async function sendDueReminders(env: Bindings, db: D1Database, today: string) {
  const settings = await sendingSettings(db)
  if (!settings.reminders_on || !settings.reminder_days.length || !operatorMail(runtimeBindings(env))) return []
  const open = await all(db, `SELECT i.id, i.due_date, c.email FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id
    WHERE i.kind = 'invoice' AND i.status = 'issued' AND i.sent_at IS NOT NULL AND i.reminders_paused = 0 AND c.email <> ''
      AND NOT EXISTS (SELECT 1 FROM pt_stripe_payments sp WHERE sp.invoice_id = i.id AND sp.status = 'processing')`)
  const sent: Data[] = []
  for (const row of open) {
    const inv = await invoice(db, row.id)
    if (inv.open_cents <= 0) continue
    const steps = (await all<{ step: number }>(db, "SELECT step FROM pt_deliveries WHERE invoice_id = ? AND kind = 'reminder'", inv.id)).map(r => r.step)
    const step = dueStep(inv.due_date, today, settings.reminder_days, steps)
    if (step === null || daysBetween(inv.due_date, today) - step > 30) continue
    const d = await deliver(env, db, pantry('reminders'), inv.id, row.email, 'reminder', step)
    if (d) sent.push(d)
  }
  return sent
}
