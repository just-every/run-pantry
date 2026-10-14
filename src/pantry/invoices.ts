// Receivables: draft → approved → issued invoices, and credits that reduce them.
// A line without a decided tax treatment stops the invoice at review; Pantry
// never assumes zero tax.
import { authority, who } from './access'
import { addDays, date, list, now, optionalText, quantity, requireThat, scale, text, uid, cents, type Data } from './core'
import { all, approval, assertOpen, audit, changed, one, periodOpen, q, run, type Sql } from './db'
import { controlAccount } from './accounts'
import { contact } from './contacts'
import { entryStatements, type Line } from './journal'
import type { Command } from './context'

export async function invoice(db: D1Database, id: string) {
  const row = await one(db, 'SELECT i.*, c.name AS customer_name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.id = ?', id)
  requireThat(row, 'Invoice not found', 404)
  row.lines = await all(db, 'SELECT * FROM pt_invoice_lines WHERE invoice_id = ? ORDER BY line_no', id)
  row.open_cents = await openBalance(db, 'invoice', id, row.total_cents)
  return row
}

/** Amount still owed: total less allocations from payments that stand and from credits. */
export async function openBalance(db: D1Database, kind: 'invoice' | 'bill', id: string, total: number, asOf = '9999-12-31') {
  const r = await one<{ applied: number }>(db, `SELECT COALESCE(SUM(a.amount_cents), 0) AS applied FROM pt_allocations a
    LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
    WHERE a.target_kind = ? AND a.target_id = ? AND a.allocation_date <= ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)`, kind, id, asOf)
  return total - Number(r?.applied ?? 0)
}

async function parseInvoice(db: D1Database, b: Data) {
  const customer = await contact(db, text(b.customerId, 'Customer'), 'customer')
  requireThat(customer.active, 'Customer is inactive')
  const issueDate = date(b.issueDate, 'Issue date')
  const dueDate = b.dueDate ? date(b.dueDate, 'Due date') : addDays(issueDate, customer.terms_days)
  requireThat(dueDate >= issueDate, 'Due date is on or after the issue date')
  const taxCodes = new Map((await all(db, 'SELECT * FROM pt_tax_codes WHERE active = 1')).map(t => [t.id, t]))
  const accounts = new Map((await all(db, "SELECT id, type, active FROM pt_accounts")).map(a => [a.id, a]))
  const lines = list<Data>(b.lines, 'Invoice lines', 100).map((l, i) => {
    const label = `Line ${i + 1}`
    const qty = quantity(l.quantity ?? '1', `${label} quantity`), unit = cents(l.rate, `${label} rate`, { zero: true })
    const amount = scale(qty, unit, 1000)
    requireThat(amount > 0, `${label} amount must be positive`)
    const account = accounts.get(text(l.accountId, `${label} income account`))
    requireThat(account && account.active && account.type === 'income', `${label}: choose an active income account`)
    const code = typeof l.taxCode === 'string' && l.taxCode ? l.taxCode : null
    requireThat(code === null || code === 'exempt' || taxCodes.has(code), `${label}: unknown sales tax code`)
    const tax = code && code !== 'exempt' ? scale(amount, taxCodes.get(code)!.rate_milli_percent, 100000) : 0
    return { description: text(l.description, `${label} description`, 500), qty, unit, amount, accountId: account.id, taxCode: code, tax }
  })
  const subtotal = lines.reduce((s, l) => s + l.amount, 0), tax = lines.reduce((s, l) => s + l.tax, 0)
  return { customer, issueDate, dueDate, lines, subtotal, tax, total: subtotal + tax, memo: optionalText(b.memo, 'Memo', 1000) }
}

const lineStatements = (invoiceId: string, lines: Awaited<ReturnType<typeof parseInvoice>>['lines']) => lines.map((l, i) =>
  q('INSERT INTO pt_invoice_lines (id, invoice_id, line_no, description, quantity_milli, unit_cents, amount_cents, account_id, tax_code, tax_cents) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    uid(), invoiceId, i + 1, l.description, l.qty, l.unit, l.amount, l.accountId, l.taxCode, l.tax))

async function nextNumber(db: D1Database, kind: 'invoice' | 'credit') {
  const prefix = kind === 'invoice' ? 'INV-' : 'CR-'
  const rows = await all<{ number: string }>(db, 'SELECT number FROM pt_invoices WHERE number LIKE ?', prefix + '%')
  const n = rows.map(r => Number(r.number.slice(prefix.length))).filter(Number.isInteger).reduce((m, x) => Math.max(m, x), 0)
  return prefix + String(n + 1).padStart(4, '0')
}

const saveDraft: Command = { need: 'record', async run(c, b) {
  const kind = b.kind === 'credit' ? 'credit' : 'invoice'
  const p = await parseInvoice(c.db, b)
  // A locked month refuses drafts dated in it, as journals do (PAN-13).
  await assertOpen(c.db, p.issueDate)
  let creditFor: string | null = null
  if (kind === 'credit') {
    const target = await invoice(c.db, text(b.creditFor, 'Invoice being credited'))
    requireThat(target.kind === 'invoice' && target.status === 'issued' && target.customer_id === p.customer.id, 'A credit applies to an issued invoice of the same customer')
    creditFor = target.id
  }
  if (b.id) {
    const current = await invoice(c.db, text(b.id, 'Invoice'))
    requireThat(current.status !== 'issued', 'An issued invoice cannot change; issue a credit', 409)
    requireThat(current.revision === b.revision, 'Invoice changed; reload', 409)
    await assertOpen(c.db, current.issue_date)
    // Editing an approved invoice returns it to draft: approval covered the earlier revision.
    // The editor becomes the preparer, so whoever last changed it cannot approve it.
    await run(c.db, [authority(c.actor, 'record'), periodOpen(current.issue_date), periodOpen(p.issueDate),
      q("UPDATE pt_invoices SET customer_id = ?, issue_date = ?, due_date = ?, status = 'draft', memo = ?, credit_for = ?, subtotal_cents = ?, tax_cents = ?, total_cents = ?, approved_by = NULL, approved_revision = NULL, prepared_by = ?, revision = ? WHERE id = ? AND revision = ? AND status <> 'issued'",
        p.customer.id, p.issueDate, p.dueDate, p.memo, creditFor, p.subtotal, p.tax, p.total, c.actor.email, uid(), current.id, b.revision), changed(),
      q('DELETE FROM pt_invoice_lines WHERE invoice_id = ?', current.id), ...lineStatements(current.id, p.lines),
      audit(who(c.actor), `${kind}.edit`, kind, current.id, { total: p.total })])
    return invoice(c.db, current.id)
  }
  const id = uid(), number = b.number ? text(b.number, 'Number', 40) : await nextNumber(c.db, kind)
  await run(c.db, [authority(c.actor, 'record'), periodOpen(p.issueDate),
    q("INSERT INTO pt_invoices (id, kind, number, customer_id, issue_date, due_date, status, memo, credit_for, subtotal_cents, tax_cents, total_cents, opening, prepared_by, revision, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, 0, ?, ?, ?)",
      id, kind, number, p.customer.id, p.issueDate, p.dueDate, p.memo, creditFor, p.subtotal, p.tax, p.total, c.actor.email, uid(), now()),
    ...lineStatements(id, p.lines), audit(who(c.actor), `${kind}.draft`, kind, id, { number, total: p.total })])
  return invoice(c.db, id)
} }

const approve: Command = { need: 'post', async run(c, b) {
  const current = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(current.status === 'draft', 'Only a draft is approved', 409)
  requireThat(current.revision === b.revision, 'Invoice changed since you reviewed it; review it again', 409)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || current.prepared_by !== c.actor.email), 'Someone other than the preparer approves this invoice', 403)
  const untaxed = current.lines.filter((l: Data) => !l.tax_code)
  requireThat(!untaxed.length, `Tax treatment needed before approval: line ${untaxed.map((l: Data) => l.line_no).join(', ')}`, 409)
  await assertOpen(c.db, current.issue_date)
  const revision = uid()
  await run(c.db, [authority(c.actor, 'post'), periodOpen(current.issue_date), approval(who(c.actor), current.kind, current.id, current.revision, 'approve', 'approved', optionalText(b.note, 'Note', 500)),
    q("UPDATE pt_invoices SET status = 'approved', approved_by = ?, approved_revision = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'draft'", c.actor.email, revision, revision, current.id, b.revision), changed(),
    audit(who(c.actor), `${current.kind}.approve`, current.kind, current.id)])
  return invoice(c.db, current.id)
} }

/** Issue posts the approved revision: receivable against income and sales tax (reversed for a credit). */
const issue: Command = { need: 'record', async run(c, b) {
  const current = await invoice(c.db, text(b.id, 'Invoice'))
  requireThat(current.status === 'approved' && current.approved_revision === current.revision, 'Approve the current version before issuing', 409)
  await assertOpen(c.db, current.issue_date)
  const receivable = await controlAccount(c.db, 'receivable')
  const taxAccounts = new Map((await all(c.db, 'SELECT id, account_id FROM pt_tax_codes')).map(t => [t.id, t.account_id]))
  const credit = current.kind === 'credit'
  const side = (amount: number, debit: boolean) => debit ? { debit: amount, credit: 0 } : { debit: 0, credit: amount }
  const lines: Line[] = [{ accountId: receivable.id, ...side(current.total_cents, !credit), memo: `${current.number} ${current.customer_name}`, contactId: current.customer_id }]
  for (const l of current.lines) lines.push({ accountId: l.account_id, ...side(l.amount_cents, credit), memo: l.description })
  const tax = new Map<string, number>()
  for (const l of current.lines) if (l.tax_cents) tax.set(taxAccounts.get(l.tax_code)!, (tax.get(taxAccounts.get(l.tax_code)!) ?? 0) + l.tax_cents)
  for (const [accountId, amount] of tax) lines.push({ accountId, ...side(amount, credit), memo: `Sales tax ${current.number}` })
  const journalId = uid(), statements: Sql[] = [authority(c.actor, 'record'),
    ...entryStatements({ id: journalId, date: current.issue_date, memo: `${credit ? 'Credit' : 'Invoice'} ${current.number} — ${current.customer_name}`, sourceKind: current.kind, sourceId: current.id, preparedBy: c.actor.email, preparedKind: 'person', lines }, c.actor.email),
    q("UPDATE pt_invoices SET status = 'issued', journal_id = ?, issued_by = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'approved'", journalId, c.actor.email, uid(), current.id, current.revision), changed()]
  if (credit) {
    const target = await invoice(c.db, current.credit_for)
    const applied = Math.min(current.total_cents, target.open_cents)
    if (applied > 0) statements.push(q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'credit', ?, 'invoice', ?, ?, ?, ?, ?)", uid(), current.id, target.id, applied, current.issue_date, c.actor.email, now()))
  }
  statements.push(audit(who(c.actor), `${current.kind}.issue`, current.kind, current.id, { journal: journalId, total: current.total_cents }))
  await run(c.db, statements)
  return invoice(c.db, current.id)
} }

export const invoiceCommands: Record<string, Command> = {
  'invoice.save-draft': saveDraft,
  'invoice.approve': approve,
  'invoice.issue': issue,
}

export async function invoicesView(db: D1Database) {
  const rows = await all(db, 'SELECT i.*, c.name AS customer_name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id ORDER BY i.issue_date DESC, i.number DESC, i.id LIMIT 500')
  const lines = await all(db, 'SELECT * FROM pt_invoice_lines ORDER BY invoice_id, line_no')
  for (const r of rows) {
    r.lines = lines.filter(l => l.invoice_id === r.id)
    r.open_cents = r.kind === 'invoice' && r.status === 'issued' ? await openBalance(db, 'invoice', r.id, r.total_cents) : r.kind === 'credit' && r.status === 'issued' ? r.total_cents - Number((await one(db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_allocations WHERE source_kind = 'credit' AND source_id = ?", r.id))?.n ?? 0) : r.total_cents
  }
  return rows
}
