// Recurring invoices. A template names the customer, lines, schedule and what
// each occurrence becomes: a draft that waits for approval as any invoice does,
// or (once a second person approves the template's exact revision) an invoice
// issued and sent on its own for exactly the template's amounts. Due work runs
// from Cron and from ordinary requests; each occurrence is claimed once by its
// (template, date) key, so nothing is created twice.
import type { Bindings } from '../auth.server'
import { authority, pantry, who } from './access'
import { addDays, date, Fault, longDay, monthName, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, approval, audit, changed, guard, one, periodOpen, q, run, type Sql } from './db'
import { contact } from './contacts'
import { documentSelectionStatements } from './invoice-documents'
import { discountColumns, issueStatements, lineStatements, nextNumber, parseInvoice } from './invoices'
import { deliver } from './delivery'
import { customerRecipients } from './customer-profile'
import type { Command } from './context'
import { amountSnapshot, priceFence, pricesFor, recurringPriceCommands } from './recurring-prices'
import { depositInput, discountInput } from './discounts'

type Unit = 'week' | 'month' | 'year'

/** The nth occurrence from the start; a month-end start stays at month end. */
export function occurrence(start: string, unit: Unit, every: number, n: number) {
  if (unit === 'week') return addDays(start, 7 * every * n)
  const [y, m, d] = start.split('-').map(Number), months = (unit === 'year' ? 12 : 1) * every * n
  const target = new Date(Date.UTC(y, m - 1 + months, 1)), last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate()
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10)
}

export async function template(db: D1Database, id: string) {
  const row = await one(db, 'SELECT r.*, c.name AS customer_name, c.email AS customer_email FROM pt_recurring r JOIN pt_contacts c ON c.id = r.customer_id WHERE r.id = ?', id)
  requireThat(row, 'Recurring invoice not found', 404)
  row.lines = JSON.parse(row.lines)
  row.discounts = JSON.parse(row.discounts ?? '[]')
  row.deposit = row.deposit ? JSON.parse(row.deposit) : null
  row.prices = await pricesFor(db, id)
  return row
}

async function parseTemplate(db: D1Database, b: Data) {
  const start = date(b.startDate, 'First invoice date')
  requireThat(!b.deposit?.date, "A recurring invoice's deposit is received on each invoice's issue date; leave its date out")
  const p = await parseInvoice(db, { customerId: b.customerId, issueDate: start, lines: b.lines, memo: b.memo, discounts: b.discounts, deposit: b.deposit })
  const untaxed = p.lines.map((l, i) => l.taxCode ? 0 : i + 1).filter(Boolean)
  requireThat(!untaxed.length, `Choose a sales tax code or exemption for line ${untaxed.join(', ')}`)
  const unit = text(b.unit, 'Repeats every') as Unit
  requireThat(['week', 'month', 'year'].includes(unit), 'Repeat weekly, monthly or yearly')
  const every = Number(b.every ?? 1)
  requireThat(Number.isInteger(every) && every >= 1 && every <= 12, 'Repeat every 1 to 12 weeks, months or years')
  const end = b.endDate ? date(b.endDate, 'Last invoice date') : null
  requireThat(!end || end >= start, 'The last invoice date is on or after the first')
  const terms = b.termsDays === undefined || b.termsDays === '' ? p.customer.terms_days : Number(b.termsDays)
  requireThat(Number.isInteger(terms) && terms >= 0 && terms <= 365, 'Payment terms are 0–365 days')
  const mode = text(b.mode, 'Each invoice')
  requireThat(mode === 'draft' || mode === 'send', 'Each invoice is created as a draft or sent automatically')
  requireThat(mode === 'draft' || customerRecipients(p.customer).length, `${p.customer.name} has no billing email address; add one to send invoices automatically`)
  // The template keeps the lines as parsed, so an item's defaults are fixed at the approved revision.
  const lines = p.lines.map(l => ({ description: l.description, quantity: String(l.qty / 1000), rate: (l.unit / 100).toFixed(2), accountId: l.accountId, taxCode: l.chosenTaxCode, ...(l.itemId ? { itemId: l.itemId } : {}), ...(l.kind === 'delivery' ? { kind: 'delivery' } : {}) }))
  return { p, start, end, unit, every, terms, mode, lines, discounts: JSON.stringify(p.discounts.map(discountInput)), deposit: depositInput(p.deposit), memo: p.memo }
}

const save: Command = { need: 'record', async run(c, b) {
  const t = await parseTemplate(c.db, b)
  const revision = uid(), status = t.mode === 'send' ? 'awaiting-approval' : 'active'
  if (b.id) {
    const current = await template(c.db, text(b.id, 'Recurring invoice'))
    requireThat(current.revision === b.revision, 'Recurring invoice changed; reload', 409)
    requireThat(current.status !== 'ended', 'This recurring invoice has ended; start a new one', 409)
    const next = occurrence(t.start, t.unit, t.every, current.runs), ended = !!t.end && next > t.end
    // An edit returns a sending template to approval: the approval covered the earlier revision.
    await run(c.db, [authority(c.actor, 'record'),
      q('UPDATE pt_recurring SET customer_id = ?, lines = ?, discounts = ?, deposit = ?, memo = ?, every = ?, unit = ?, start_date = ?, end_date = ?, next_date = ?, terms_days = ?, mode = ?, status = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, prepared_by = ?, approved_by = NULL, approved_revision = NULL, revision = ? WHERE id = ? AND revision = ?',
        t.p.customer.id, JSON.stringify(t.lines), t.discounts, t.deposit, t.memo, t.every, t.unit, t.start, t.end, ended ? null : next, t.terms, t.mode, ended ? 'ended' : current.status === 'paused' ? 'paused' : status, t.p.subtotal, t.p.tax, t.p.total, c.actor.email, revision, current.id, b.revision), changed(),
      q('UPDATE pt_recurring SET amount_snapshot = ? WHERE id = ?', amountSnapshot(t.p), current.id),
      audit(who(c.actor), 'recurring.edit', 'recurring', current.id, { total: t.p.total, mode: t.mode })])
    return template(c.db, current.id)
  }
  const id = uid(), rows = await all<{ number: string }>(c.db, 'SELECT number FROM pt_recurring')
  const number = 'REC-' + String(rows.map(r => Number(r.number.slice(4))).filter(Number.isInteger).reduce((m, x) => Math.max(m, x), 0) + 1).padStart(4, '0')
  await run(c.db, [authority(c.actor, 'record'),
    q('INSERT INTO pt_recurring (id, number, customer_id, lines, discounts, deposit, memo, every, unit, start_date, end_date, runs, next_date, terms_days, mode, status, subtotal_cents, tax_cents, total_cents, prepared_by, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, number, t.p.customer.id, JSON.stringify(t.lines), t.discounts, t.deposit, t.memo, t.every, t.unit, t.start, t.end, t.start, t.terms, t.mode, status, t.p.subtotal, t.p.tax, t.p.total, c.actor.email, revision, now()),
    q('UPDATE pt_recurring SET amount_snapshot = ? WHERE id = ?', amountSnapshot(t.p), id),
    audit(who(c.actor), 'recurring.create', 'recurring', id, { number, total: t.p.total, mode: t.mode })])
  return template(c.db, id)
} }

/** A second person (or the owner) approves the exact revision of a template that sends on its own. */
const approve: Command = { need: 'post', async run(c, b) {
  const current = await template(c.db, text(b.id, 'Recurring invoice'))
  requireThat(current.status === 'awaiting-approval', 'Only a recurring invoice waiting for approval is approved', 409)
  requireThat(current.revision === b.revision, 'Recurring invoice changed since you reviewed it; review it again', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || current.prepared_by !== c.actor.email), 'Someone other than the preparer approves this recurring invoice', 403)
  const p = await parseInvoice(c.db, { customerId: current.customer_id, issueDate: current.start_date, lines: current.lines, memo: current.memo, discounts: current.discounts, deposit: current.deposit })
  requireThat(p.total === current.total_cents && p.tax === current.tax_cents && (!current.amount_snapshot || amountSnapshot(p) === current.amount_snapshot), 'The template amounts changed; edit and review it again', 409)
  await run(c.db, [authority(c.actor, 'post'), approval(who(c.actor), 'recurring', current.id, current.revision, 'approve', 'approved', optionalText(b.note, 'Note', 500)),
    q("UPDATE pt_recurring SET status = 'active', approved_by = ?, approved_revision = revision, amount_snapshot = ? WHERE id = ? AND revision = ? AND status = 'awaiting-approval'", c.actor.email, amountSnapshot(p), current.id, b.revision), changed(),
    audit(who(c.actor), 'recurring.approve', 'recurring', current.id)])
  return template(c.db, current.id)
} }

const setStatus: Command = { need: 'record', async run(c, b) {
  const current = await template(c.db, text(b.id, 'Recurring invoice'))
  const to = text(b.status, 'Status')
  requireThat(['paused', 'active', 'ended'].includes(to) && current.status !== 'ended', 'Pause, resume or end a recurring invoice that has not ended', 409)
  const resumed = to === 'active' ? (current.mode === 'send' && current.approved_revision !== current.revision ? 'awaiting-approval' : 'active') : to
  await run(c.db, [authority(c.actor, 'record'), q(`UPDATE pt_recurring SET status = ?${to === 'ended' ? ', next_date = NULL' : ''} WHERE id = ? AND status = ?`, resumed, current.id, current.status), changed(),
    audit(who(c.actor), `recurring.${to === 'active' ? 'resume' : to === 'paused' ? 'pause' : 'end'}`, 'recurring', current.id)])
  return template(c.db, current.id)
} }

export const recurringCommands: Record<string, Command> = {
  ...recurringPriceCommands,
  'recurring.save': save,
  'recurring.approve': approve,
  'recurring.status': setStatus,
}

const approverStillPosts = (email: string) => guard("EXISTS (SELECT 1 FROM oa_operators WHERE lower(email) = ? AND role = 'owner' AND status = 'active') OR EXISTS (SELECT 1 FROM pt_members WHERE email = ? AND active = 1 AND can_post = 1 AND role <> 'viewer')", email, email)

const claimed = (error: unknown) => String((error as Error)?.message ?? error).includes('pt_recurring_runs')

/** Create (and for an approved sending template, issue and send) one occurrence. */
async function runOccurrence(env: Bindings, db: D1Database, t: Data) {
  const occ: string = t.next_date, next = occurrence(t.start_date, t.unit, t.every, t.runs + 1), ended = !!t.end_date && next > t.end_date
  const price: Data | undefined = t.prices.filter((p: Data) => p.effective_date <= occ).at(-1)
  const amounts = price ?? t, approvedBy = price?.approved_by ?? t.approved_by
  const priceApproved = !price || (price.approved_revision === price.revision && price.template_revision === t.revision)
  const advance: Sql[] = [q('UPDATE pt_recurring SET runs = ?, next_date = ?, status = ? WHERE id = ? AND runs = ? AND revision = ? AND status = ?', t.runs + 1, ended ? null : next, ended ? 'ended' : 'active', t.id, t.runs, t.revision, 'active'), changed()]
  const claim = (invoiceId: string | null, status: string, detail: string) => q('INSERT INTO pt_recurring_runs (recurring_id, occurrence, invoice_id, status, detail, at) VALUES (?, ?, ?, ?, ?, ?)', t.id, occ, invoiceId, status, detail, now())
  const fail = async (reason: string) => {
    try { await run(db, [claim(null, 'failed', reason), ...advance, audit(pantry('recurring'), 'recurring.failed', 'recurring', t.id, { occurrence: occ, reason })]) } catch (error) { if (!claimed(error) && !(error instanceof Fault)) throw error }
  }
  let p: Awaited<ReturnType<typeof parseInvoice>>
  try {
    const customer = await contact(db, t.customer_id, 'customer')
    p = await parseInvoice(db, { customerId: customer.id, issueDate: occ, dueDate: addDays(occ, t.terms_days), lines: amounts.lines, memo: t.memo, discounts: t.discounts, deposit: t.deposit })
  } catch (error) { if (error instanceof Fault) return fail(error.message); throw error }
  const locked = await one(db, "SELECT id FROM pt_periods WHERE status = 'locked' AND ? BETWEEN start_date AND end_date", occ)
  if (locked) return fail(`${longDay(occ)} is in ${monthName(locked.id)}, which is locked`)
  const approverPosts = approvedBy && await one(db, "SELECT 1 AS ok WHERE EXISTS (SELECT 1 FROM oa_operators WHERE lower(email) = ? AND role = 'owner' AND status = 'active') OR EXISTS (SELECT 1 FROM pt_members WHERE email = ? AND active = 1 AND can_post = 1 AND role <> 'viewer')", approvedBy, approvedBy)
  const sameAmounts = p.total === amounts.total_cents && p.tax === amounts.tax_cents && amountSnapshot(p) === amounts.amount_snapshot
  const discountAccount = !p.discounts.length || !!p.discountAccountId
  const automatic = t.mode === 'send' && t.approved_revision === t.revision && priceApproved && sameAmounts && discountAccount && !!approverPosts
  const why = t.mode === 'draft' ? 'Created as a draft for approval'
    : !discountAccount ? "No discounts account is chosen in Settings; it waits for a person's approval"
    : !priceApproved ? 'The price changed from ' + price!.effective_date + "; it waits for a person's approval"
    : !sameAmounts ? "The amounts differ from the approved template; it waits for a person's approval"
    : 'The approver no longer holds the posting grant; it waits for approval'
  const id = uid(), revision = uid(), number = await nextNumber(db, 'invoice')
  // The invoice goes in first so the run's claim can refer to it; the batch is atomic either way.
  const statements: Sql[] = [periodOpen(occ), priceFence(t, price, occ),
    q("INSERT INTO pt_invoices (id, kind, number, customer_id, issue_date, due_date, status, memo, subtotal_cents, tax_cents, total_cents, discounts, discount_cents, after_tax_discount_cents, discount_account_id, deposit, opening, prepared_by, approved_by, approved_revision, revision, created_at, recurring_id) VALUES (?, 'invoice', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?)",
      id, number, p.customer.id, occ, p.dueDate, automatic ? 'approved' : 'draft', p.memo, p.subtotal, p.tax, p.total, ...discountColumns(p), amounts.prepared_by, automatic ? approvedBy : null, automatic ? revision : null, revision, now(), t.id),
    ...documentSelectionStatements(id, p), ...lineStatements(id, p.lines), claim(id, automatic ? 'issued' : 'drafted', automatic ? 'Issued under the approved template' : why), ...advance]
  if (automatic) {
    try {
      const issued = await issueStatements(db, { id, kind: 'invoice', number, customer_id: p.customer.id, customer_name: p.customer.name, issue_date: occ, total_cents: p.total, revision,
        discount_cents: p.discount, after_tax_discount_cents: p.afterTax, discount_account_id: p.discountAccountId, deposit: p.deposit,
        lines: p.lines.map(l => ({ account_id: l.accountId, amount_cents: l.amount, description: l.description, tax_code: l.taxCode, tax_cents: l.tax })) }, pantry('recurring'), amounts.prepared_by, p)
      statements.push(approverStillPosts(approvedBy), approval({ email: approvedBy, kind: 'person' }, 'invoice', id, revision, 'approve', 'approved', `Approved through recurring invoice ${t.number}, revision ${t.approved_revision}${price ? ', price revision ' + price.approved_revision : ''}`), ...issued.statements)
    } catch (error) { if (error instanceof Fault) return fail(error.message); throw error }
  }
  statements.push(audit(pantry('recurring'), 'recurring.run', 'recurring', t.id, { occurrence: occ, invoice: number, issued: automatic }))
  try { await run(db, statements) } catch (error) {
    if (claimed(error)) return
    if (error instanceof Fault) {
      const fresh = await template(db, t.id)
      // Another run, edit or approval won the race. Reload on the next due
      // iteration instead of claiming a failed occurrence at a stale price.
      if (fresh.revision !== t.revision || fresh.runs !== t.runs || fresh.status !== 'active' || JSON.stringify(fresh.prices) !== JSON.stringify(t.prices)) return
      return fail(error.message)
    }
    throw error
  }
  if (automatic) await sendRun(env, db, t.id, occ)
}

/** Send an issued occurrence once: the run moves from issued to sent before the message goes. */
async function sendRun(env: Bindings, db: D1Database, templateId: string, occ: string) {
  const r = await db.prepare("UPDATE pt_recurring_runs SET status = 'sent', at = ? WHERE recurring_id = ? AND occurrence = ? AND status = 'issued'").bind(now(), templateId, occ).run()
  if (r.meta.changes !== 1) return
  const row = (await one(db, 'SELECT r.invoice_id, c.* FROM pt_recurring_runs r JOIN pt_invoices i ON i.id = r.invoice_id JOIN pt_contacts c ON c.id = i.customer_id WHERE r.recurring_id = ? AND r.occurrence = ?', templateId, occ))!
  const failures: string[] = []
  try {
    const recipients = customerRecipients(row)
    requireThat(recipients.length, 'The customer has no billing email address')
    for (const recipient of recipients) {
      const d = (await deliver(env, db, pantry('recurring'), row.invoice_id, recipient, 'invoice'))!
      if (d.status !== 'accepted') failures.push(`Issued, but sending was ${d.status}${d.detail ? `: ${d.detail}` : ''} (${recipient})`)
    }
  } catch (error) { if (!(error instanceof Fault)) throw error; failures.push(`Issued, but not sent: ${error.message}`) }
  if (failures.length) await db.prepare("UPDATE pt_recurring_runs SET status = 'failed', detail = ? WHERE recurring_id = ? AND occurrence = ?").bind(failures.join('; '), templateId, occ).run()
}

/** Every occurrence due by `today` (a late run catches up, at most twelve per template), then any issued run not yet sent. */
export async function runDueRecurring(env: Bindings, db: D1Database, today: string) {
  const due = await all(db, "SELECT id FROM pt_recurring WHERE status = 'active' AND next_date IS NOT NULL AND next_date <= ?", today)
  for (const { id } of due) {
    for (let i = 0; i < 12; i++) {
      const t = await template(db, id)
      if (t.status !== 'active' || !t.next_date || t.next_date > today) break
      await runOccurrence(env, db, t)
    }
  }
  for (const r of await all(db, "SELECT recurring_id, occurrence FROM pt_recurring_runs WHERE status = 'issued'")) await sendRun(env, db, r.recurring_id, r.occurrence)
}

export async function recurringView(db: D1Database) {
  const templates = await all(db, 'SELECT r.*, c.name AS customer_name FROM pt_recurring r JOIN pt_contacts c ON c.id = r.customer_id ORDER BY r.number DESC LIMIT 200')
  const runs = await all(db, 'SELECT r.*, i.number AS invoice_number FROM pt_recurring_runs r LEFT JOIN pt_invoices i ON i.id = r.invoice_id ORDER BY r.occurrence DESC')
  for (const t of templates) { t.lines = JSON.parse(t.lines); t.discounts = JSON.parse(t.discounts ?? '[]'); t.deposit = t.deposit ? JSON.parse(t.deposit) : null; t.prices = await pricesFor(db, t.id); t.runs_list = runs.filter(r => r.recurring_id === t.id).slice(0, 24) }
  return templates
}
