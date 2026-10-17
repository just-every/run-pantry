// Payables and recorded money movement. Bills post expense against payables;
// payments record money that moved outside Pantry and allocate it to open items.
import { authority, who, type Actor } from './access'
import { addDays, cents, date, list, now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, assertOpen, audit, changed, one, periodOpen, q, run, type AuditActor, type Sql } from './db'
import { controlAccount } from './accounts'
import { contact } from './contacts'
import { entryStatements, type Line } from './journal'
import { invoice, openBalance } from './invoices'
import type { Command, Context } from './context'
import { METHODS } from './contractors'

export async function bill(db: D1Database, id: string) {
  const row = await one(db, 'SELECT b.*, c.name AS vendor_name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.id = ?', id)
  requireThat(row, 'Bill not found', 404)
  row.lines = await all(db, 'SELECT * FROM pt_bill_lines WHERE bill_id = ? ORDER BY line_no', id)
  row.documents = await all(db, "SELECT id, name, sha256 FROM pt_documents WHERE linked_kind = 'bill' AND linked_id = ?", id)
  row.open_cents = row.status === 'void' ? 0 : await openBalance(db, 'bill', id, row.total_cents)
  return row
}

async function parseBill(db: D1Database, b: Data) {
  const vendor = await contact(db, text(b.vendorId, 'Vendor'), 'vendor')
  requireThat(vendor.active, 'Vendor is inactive')
  const billDate = date(b.billDate, 'Bill date'), dueDate = b.dueDate ? date(b.dueDate, 'Due date') : addDays(billDate, vendor.terms_days)
  requireThat(dueDate >= billDate, 'Due date is on or after the bill date')
  const accounts = new Map((await all(db, 'SELECT id, type, subtype, active FROM pt_accounts')).map(a => [a.id, a]))
  const lines = list<Data>(b.lines, 'Bill lines', 100).map((l, i) => {
    const a = accounts.get(text(l.accountId, `Line ${i + 1} account`))
    requireThat(a && a.active && !['receivable', 'payable', 'bank'].includes(a.subtype), `Line ${i + 1}: choose an active expense or asset account`)
    return { description: text(l.description, `Line ${i + 1} description`, 500), accountId: a.id, amount: cents(l.amount, `Line ${i + 1} amount`) }
  })
  return { vendor, billDate, dueDate, lines, total: lines.reduce((s, l) => s + l.amount, 0), reference: text(b.reference, "Vendor's invoice number", 80), memo: optionalText(b.memo, 'Memo', 1000) }
}

/** Build one bill's complete write batch, also used by the idempotent integration API. */
export async function billStatements(c: Context, b: Data) {
  const p = await parseBill(c.db, b)
  const id = uid(), post = b.post === true || b.post === 'true'
  // A locked month refuses bills dated in it, drafts included (PAN-13).
  await assertOpen(c.db, p.billDate)
  const payable = post ? await controlAccount(c.db, 'payable') : null
  const journalId = uid()
  const statements: Sql[] = [authority(c.actor, 'record'), periodOpen(p.billDate),
    q("INSERT INTO pt_bills (id, vendor_id, reference, bill_date, due_date, status, memo, total_cents, opening, prepared_by, revision, created_at) VALUES (?, ?, ?, ?, ?, 'draft', ?, ?, 0, ?, ?, ?)",
      id, p.vendor.id, p.reference, p.billDate, p.dueDate, p.memo, p.total, c.actor.email, uid(), now()),
    ...p.lines.map((l, i) => q('INSERT INTO pt_bill_lines (id, bill_id, line_no, description, account_id, amount_cents) VALUES (?, ?, ?, ?, ?, ?)', uid(), id, i + 1, l.description, l.accountId, l.amount))]
  if (payable) statements.push(...postBill(c.actor, { id, journalId, payable: payable.id, vendor: p.vendor, reference: p.reference, date: p.billDate, lines: p.lines.map(l => ({ account_id: l.accountId, amount_cents: l.amount, description: l.description })), total: p.total }))
  statements.push(audit(who(c.actor), post ? 'bill.record' : 'bill.draft', 'bill', id, { vendor: p.vendor.name, reference: p.reference, total: p.total }))
  return { id, statements }
}

const saveBill: Command = { need: 'record', async run(c, b) {
  const prepared = await billStatements(c, b)
  await run(c.db, prepared.statements)
  return bill(c.db, prepared.id)
} }

function postBill(actor: Actor, b: { id: string; journalId: string; payable: string; vendor: Data; reference: string; date: string; lines: Data[]; total: number }): Sql[] {
  const lines: Line[] = [...b.lines.map(l => ({ accountId: l.account_id, debit: l.amount_cents, credit: 0, memo: l.description })), { accountId: b.payable, debit: 0, credit: b.total, memo: `${b.vendor.name} ${b.reference}`, contactId: b.vendor.id }]
  return [...entryStatements({ id: b.journalId, date: b.date, memo: `Bill ${b.reference} — ${b.vendor.name}`, sourceKind: 'bill', sourceId: b.id, preparedBy: actor.email, preparedKind: 'person', lines }, actor.email),
    q("UPDATE pt_bills SET status = 'posted', journal_id = ?, revision = ? WHERE id = ? AND status = 'draft'", b.journalId, uid(), b.id), changed()]
}

const recordBill: Command = { need: 'record', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  requireThat(current.status === 'draft' && current.revision === b.revision, 'Bill changed or is already recorded; reload', 409)
  await assertOpen(c.db, current.bill_date)
  const payable = await controlAccount(c.db, 'payable'), vendor = await contact(c.db, current.vendor_id)
  await run(c.db, [authority(c.actor, 'record'), ...postBill(c.actor, { id: current.id, journalId: uid(), payable: payable.id, vendor, reference: current.reference, date: current.bill_date, lines: current.lines, total: current.total_cents }), audit(who(c.actor), 'bill.record', 'bill', current.id)])
  return bill(c.db, current.id)
} }

/** A missing source document stays a close exception unless someone who can post records why. */
const waiveEvidence: Command = { need: 'post', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  const reason = text(b.reason, 'Reason the source document is unavailable', 500)
  await run(c.db, [authority(c.actor, 'post'), q('UPDATE pt_bills SET evidence_waived = ?, revision = ? WHERE id = ? AND revision = ?', `${reason} — ${c.actor.email}`, uid(), current.id, b.revision), changed(), audit(who(c.actor), 'bill.evidence-waived', 'bill', current.id, { reason })])
  return bill(c.db, current.id)
} }

type Allocation = { targetId: string; amount: number }

/** Validate allocations against the current open balances; the batch guards repeat the check. */
async function allocations(db: D1Database, direction: 'received' | 'paid', contactId: string, raw: unknown, available: number): Promise<{ list: Allocation[]; guards: Sql[] }> {
  const items = (Array.isArray(raw) ? raw : []).filter((a: Data) => a && (a.amount ?? '') !== '').map((a: Data, i: number) => ({ targetId: text(a.targetId, `Allocation ${i + 1} item`), amount: cents(a.amount, `Allocation ${i + 1} amount`) }))
  requireThat(items.reduce((s, a) => s + a.amount, 0) <= available, 'Allocations exceed the amount available')
  const kind = direction === 'received' ? 'invoice' : 'bill', guards: Sql[] = []
  for (const a of items) {
    const item = kind === 'invoice' ? await invoice(db, a.targetId) : await bill(db, a.targetId)
    requireThat(kind === 'bill' || item.kind === 'invoice', 'Allocate receipts to invoices')
    requireThat((kind === 'invoice' ? item.customer_id : item.vendor_id) === contactId, 'Allocate only to the same customer or vendor')
    requireThat(kind === 'invoice' ? item.status === 'issued' : item.status === 'posted' || item.opening, 'Only issued invoices and recorded bills take payments')
    requireThat(a.amount <= item.open_cents, `${item.number ?? item.reference} has ${(item.open_cents / 100).toFixed(2)} open`)
    guards.push(q(`INSERT INTO pt_guard SELECT CASE WHEN (SELECT total_cents FROM ${kind === 'invoice' ? 'pt_invoices' : 'pt_bills'} WHERE id = ?) - (SELECT COALESCE(SUM(a.amount_cents), 0) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id WHERE a.target_kind = ? AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)) >= 0 THEN 1 ELSE 0 END`, a.targetId, kind, a.targetId))
  }
  return { list: items, guards }
}

const allocationInsert = (actor: AuditActor, paymentId: string, kind: string, a: Allocation, day: string) =>
  q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'payment', ?, ?, ?, ?, ?, ?, ?)", uid(), paymentId, kind, a.targetId, a.amount, day, actor.email, now())

/** Statements recording one external payment and its allocations; used directly, from bank matching and by Pantry itself (Stripe, automatic matches). */
export async function paymentStatements(db: D1Database, actor: AuditActor, b: Data) {
  const direction = text(b.direction, 'Direction')
  requireThat(direction === 'received' || direction === 'paid', 'A payment is received or paid')
  const who_ = await contact(db, text(b.contactId, direction === 'received' ? 'Customer' : 'Vendor'), direction === 'received' ? 'customer' : 'vendor')
  const day = date(b.date, 'Payment date'), amount = cents(b.amount, 'Amount')
  const method = optionalText(b.method, 'Payment method') || 'unrecorded'
  requireThat((['unrecorded', ...METHODS] as string[]).includes(method), 'Payment method is check, ACH, wire, cash, card or a payment network')
  await assertOpen(db, day)
  const bank = await one(db, 'SELECT * FROM pt_bank_accounts WHERE id = ?', text(b.bankAccountId, 'Bank account'))
  requireThat(bank, 'Bank account not found', 404)
  const control = await controlAccount(db, direction === 'received' ? 'receivable' : 'payable')
  const allocated = await allocations(db, direction, who_.id, b.allocations, amount)
  const id = uid(), journalId = uid(), received = direction === 'received'
  const lines: Line[] = received
    ? [{ accountId: bank.account_id, debit: amount, credit: 0, memo: `Received from ${who_.name}` }, { accountId: control.id, debit: 0, credit: amount, memo: `Payment ${optionalText(b.reference, 'Reference', 80)}`, contactId: who_.id }]
    : [{ accountId: control.id, debit: amount, credit: 0, memo: `Payment ${optionalText(b.reference, 'Reference', 80)}`, contactId: who_.id }, { accountId: bank.account_id, debit: 0, credit: amount, memo: `Paid to ${who_.name}` }]
  const statements: Sql[] = [
    ...entryStatements({ id: journalId, date: day, memo: `${received ? 'Payment from' : 'Payment to'} ${who_.name}`, sourceKind: 'payment', sourceId: id, preparedBy: actor.email, preparedKind: actor.kind === 'system' ? 'import' : 'person', lines }, actor.email),
    q('INSERT INTO pt_payments (id, direction, contact_id, payment_date, amount_cents, bank_account_id, reference, memo, method, journal_id, recorded_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
      id, direction, who_.id, day, amount, bank.id, optionalText(b.reference, 'Reference', 80), optionalText(b.memo, 'Memo', 500), method, journalId, actor.email, now()),
    ...allocated.list.map(a => allocationInsert(actor, id, received ? 'invoice' : 'bill', a, day)), ...allocated.guards,
    audit(who(actor), 'payment.record', 'payment', id, { direction, amount, allocations: allocated.list }),
  ]
  return { id, journalId, bankLedgerAccount: bank.account_id, statements, signed: received ? amount : -amount }
}

const recordPayment: Command = { need: 'record', async run(c, b) {
  const p = await paymentStatements(c.db, c.actor, b)
  await run(c.db, [authority(c.actor, 'record'), ...p.statements])
  return (await one(c.db, 'SELECT * FROM pt_payments WHERE id = ?', p.id))!
} }

/** Apply an unallocated part of an earlier payment. */
const allocate: Command = { need: 'record', async run(c, b) {
  const payment = await one(c.db, 'SELECT * FROM pt_payments WHERE id = ? AND reversal_id IS NULL', text(b.paymentId, 'Payment'))
  requireThat(payment, 'Payment not found or reversed', 404)
  const used = Number((await one(c.db, "SELECT COALESCE(SUM(amount_cents), 0) AS n FROM pt_allocations WHERE source_kind = 'payment' AND source_id = ?", payment.id))?.n ?? 0)
  const day = date(b.date ?? payment.payment_date, 'Allocation date')
  requireThat(day >= payment.payment_date, 'Allocate on or after the payment date')
  await assertOpen(c.db, day)
  const allocated = await allocations(c.db, payment.direction, payment.contact_id, b.allocations, payment.amount_cents - used)
  requireThat(allocated.list.length, 'Choose what to allocate')
  await run(c.db, [authority(c.actor, 'record'), ...allocated.list.map(a => allocationInsert(c.actor, payment.id, payment.direction === 'received' ? 'invoice' : 'bill', a, day)), ...allocated.guards,
    q(`INSERT INTO pt_guard SELECT CASE WHEN (SELECT COALESCE(SUM(amount_cents), 0) FROM pt_allocations WHERE source_kind = 'payment' AND source_id = ?) <= ? THEN 1 ELSE 0 END`, payment.id, payment.amount_cents),
    audit(who(c.actor), 'payment.allocate', 'payment', payment.id, { allocations: allocated.list })])
  return (await one(c.db, 'SELECT * FROM pt_payments WHERE id = ?', payment.id))!
} }

export const payableCommands: Record<string, Command> = {
  'bill.save': saveBill,
  'bill.record': recordBill,
  'bill.waive-evidence': waiveEvidence,
  'payment.record': recordPayment,
  'payment.allocate': allocate,
}

export async function billsView(db: D1Database) {
  const rows = await all(db, 'SELECT b.*, c.name AS vendor_name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id ORDER BY b.bill_date DESC, b.reference, b.id LIMIT 500')
  const lines = await all(db, 'SELECT * FROM pt_bill_lines ORDER BY bill_id, line_no')
  const docs = await all(db, "SELECT id, name, linked_id FROM pt_documents WHERE linked_kind = 'bill'")
  for (const r of rows) {
    r.lines = lines.filter(l => l.bill_id === r.id)
    r.documents = docs.filter(d => d.linked_id === r.id)
    r.open_cents = r.status === 'void' ? 0 : await openBalance(db, 'bill', r.id, r.total_cents)
  }
  return rows
}

export async function paymentsView(db: D1Database) {
  const rows = await all(db, 'SELECT p.*, c.name AS contact_name, b.name AS bank_name FROM pt_payments p JOIN pt_contacts c ON c.id = p.contact_id JOIN pt_bank_accounts b ON b.id = p.bank_account_id ORDER BY p.payment_date DESC, p.created_at DESC, p.id LIMIT 500')
  const allocs = await all(db, "SELECT * FROM pt_allocations WHERE source_kind = 'payment' ORDER BY created_at, id")
  for (const r of rows) { r.allocations = allocs.filter(a => a.source_id === r.id); r.unallocated_cents = r.amount_cents - r.allocations.reduce((s: number, a: Data) => s + a.amount_cents, 0) }
  return rows
}
