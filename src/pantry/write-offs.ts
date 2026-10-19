// Bulk write-off of small open balances. Each receivable is written off by an
// ordinary posted credit note applied to its invoice, and each payable by a
// vendor credit applied to its bill, so aging, open balances and the cash
// basis treat a write-off as the non-cash settlement any credit is. Write-off
// credits are marked: a bad debt is not a sales return, so sales tax and the
// nexus watch leave them out. Each item's balance is capped by the owner's
// write-off limit ($100 until the owner sets one); the whole selection posts
// in one batch, each item guarded against a payment landing meanwhile.
import { authority, who } from './access'
import { cents, date, list, now, requireThat, text, uid, type Data } from './core'
import { all, approval, assertOpen, audit, guard, one, periodOpen, q, run, type Sql } from './db'
import { controlAccount } from './accounts'
import { entryStatements } from './journal'
import { issueStatements, nextNumber, openBalance } from './invoices'
import type { Command } from './context'

const MAX_ITEMS = 200, DEFAULT_LIMIT = 100_00

/** The owner's per-item write-off limit. */
export async function writeOffLimit(db: D1Database) {
  return Number((await one(db, 'SELECT limit_cents FROM pt_write_off_policy WHERE id = 1'))?.limit_cents ?? DEFAULT_LIMIT)
}
const standing = (kind: 'invoice' | 'bill') => `(SELECT total_cents FROM ${kind === 'invoice' ? 'pt_invoices' : 'pt_bills'} WHERE id = ?) - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a
  LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id WHERE a.target_kind = '${kind}' AND a.target_id = ? AND (a.source_kind = 'credit' OR p.reversal_id IS NULL)), 0)`

/** Open invoices or bills whose balance is above zero and at most `ceiling`. */
export async function smallBalances(db: D1Database, kind: 'invoice' | 'bill', ceiling: number) {
  const rows = kind === 'invoice'
    ? await all(db, "SELECT i.id, i.number AS reference, i.issue_date AS day, i.total_cents, i.customer_id AS contact_id, i.destination_state, c.name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.kind = 'invoice' AND i.status = 'issued' ORDER BY i.issue_date, i.number")
    : await all(db, "SELECT b.id, b.reference, b.bill_date AS day, b.total_cents, b.vendor_id AS contact_id, c.name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE b.status = 'posted' ORDER BY b.bill_date, b.reference")
  const out: Data[] = []
  for (const r of rows) {
    const open = await openBalance(db, kind, r.id, r.total_cents)
    if (open > 0 && open <= ceiling) out.push({ ...r, open })
  }
  return out
}

const writeOff: Command = { need: 'post', async run(c, b) {
  const kind = b.kind === 'bill' ? 'bill' : b.kind === 'invoice' ? 'invoice' : null
  requireThat(kind, 'Choose receivables (invoices) or payables (bills) to write off')
  const ceiling = cents(b.ceiling, 'Write off balances up to'), day = date(b.date, 'Write-off date'), limit = await writeOffLimit(c.db)
  requireThat(ceiling <= limit, `The owner's write-off limit is $${(limit / 100).toFixed(2)} per item; a larger write-off needs approval under INVOICE-008, which Pantry does not have yet`, 403)
  const account = await one(c.db, "SELECT * FROM pt_accounts WHERE id = ? AND active = 1 AND subtype = 'other' AND type IN ('income', 'expense')", text(b.accountId, 'Write-off account'))
  requireThat(account, 'Write off to an active ordinary income or expense account, such as bad debts')
  await assertOpen(c.db, day)
  let items = await smallBalances(c.db, kind, ceiling)
  if (b.ids !== undefined) {
    const chosen = new Set(list<string>(b.ids, 'Items to write off', MAX_ITEMS))
    requireThat([...chosen].every(id => items.some(i => i.id === id)), `A chosen item is not open with a balance of at most $${(ceiling / 100).toFixed(2)}`, 409)
    items = items.filter(i => chosen.has(i.id))
  }
  requireThat(items.length, `No open ${kind === 'invoice' ? 'invoice' : 'bill'} has a balance of at most $${(ceiling / 100).toFixed(2)}`, 409)
  requireThat(items.length <= MAX_ITEMS, `Write off at most ${MAX_ITEMS} items at a time; choose a lower ceiling or a selection`)
  const late = items.find(i => i.day > day)
  requireThat(!late, `${late?.reference} is dated after ${day}; date the write-off on or after it`)
  const batch = uid(), statements: Sql[] = [authority(c.actor, 'post'), periodOpen(day), guard(`COALESCE((SELECT limit_cents FROM pt_write_off_policy WHERE id = 1), ${DEFAULT_LIMIT}) >= ?`, ceiling)]
  const payable = kind === 'bill' ? await controlAccount(c.db, 'payable') : null
  const prefix = 'CR-', first = Number((await nextNumber(c.db, 'credit')).slice(prefix.length))
  for (const [n, item] of items.entries()) {
    statements.push(guard(`${standing(kind)} = ?`, item.id, item.id, item.open))
    const memo = `Write-off of ${item.reference} small balance — ${item.name}`
    if (kind === 'invoice') {
      const id = uid(), revision = uid(), number = prefix + String(first + n).padStart(4, '0')
      statements.push(
        q("INSERT INTO pt_invoices (id, kind, number, customer_id, destination_state, issue_date, due_date, status, memo, credit_for, subtotal_cents, tax_cents, total_cents, opening, prepared_by, approved_by, approved_revision, revision, created_at, write_off) VALUES (?, 'credit', ?, ?, ?, ?, ?, 'approved', ?, ?, ?, 0, ?, 0, ?, ?, ?, ?, ?, 1)",
          id, number, item.contact_id, item.destination_state ?? '', day, day, memo, item.id, item.open, item.open, c.actor.email, c.actor.email, revision, revision, now()),
        q("INSERT INTO pt_invoice_lines (id, invoice_id, line_no, description, quantity_milli, unit_cents, amount_cents, account_id, tax_code, tax_cents, chosen_tax_code) VALUES (?, ?, 1, ?, 1000, ?, ?, ?, 'exempt', 0, 'exempt')",
          uid(), id, memo, item.open, item.open, account.id),
        approval(who(c.actor), 'credit', id, revision, 'write-off', 'approved'))
      const issued = await issueStatements(c.db, { id, kind: 'credit', number, customer_id: item.contact_id, customer_name: item.name, issue_date: day, total_cents: item.open, credit_for: item.id, revision,
        lines: [{ account_id: account.id, amount_cents: item.open, description: memo, tax_code: 'exempt', tax_cents: 0 }] }, who(c.actor))
      statements.push(...issued.statements)
    } else {
      const id = uid(), journalId = uid()
      statements.push(
        ...entryStatements({ id: journalId, date: day, memo, sourceKind: 'credit', sourceId: id, preparedBy: c.actor.email, preparedKind: 'person', lines: [
          { accountId: payable!.id, debit: item.open, credit: 0, memo, contactId: item.contact_id },
          { accountId: account.id, debit: 0, credit: item.open, memo },
        ] }, c.actor.email),
        q('INSERT INTO pt_vendor_credits (id, vendor_id, reference, credit_date, amount_cents, account_id, journal_id, created_by, created_at, write_off) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1)', id, item.contact_id, `Write-off ${item.reference} ${batch.slice(0, 8)}`, day, item.open, account.id, journalId, c.actor.email, now()),
        q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'credit', ?, 'bill', ?, ?, ?, ?, ?)", uid(), id, item.id, item.open, day, c.actor.email, now()))
    }
  }
  statements.push(audit(who(c.actor), 'write-off.bulk', kind, batch, { account: `${account.code} ${account.name}`, ceiling, limit, date: day, count: items.length, total: items.reduce((t, i) => t + i.open, 0), items: items.map(i => ({ id: i.id, reference: i.reference, amount: i.open })) }))
  await run(c.db, statements)
  return { batch, kind, account: { code: account.code, name: account.name }, items: items.map(i => ({ id: i.id, reference: i.reference, name: i.name, amount: i.open })) }
} }

const setLimit: Command = { need: 'owner', async run(c, b) {
  const limit = cents(b.limit, 'Write-off limit per item')
  await run(c.db, [authority(c.actor, 'owner'), q('INSERT INTO pt_write_off_policy (id, limit_cents, set_by, set_at) VALUES (1, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET limit_cents = excluded.limit_cents, set_by = excluded.set_by, set_at = excluded.set_at', limit, c.actor.email, now()),
    audit(who(c.actor), 'write-off.limit', 'write-off-policy', '1', { limit })])
  return { limit }
} }

/** Every write-off batch with its count and total, for the owner and reviewers. */
export async function writeOffBatches(db: D1Database) {
  return (await all(db, "SELECT id, at, actor_email, subject_kind, detail FROM pt_audit WHERE action = 'write-off.bulk' ORDER BY at DESC, rowid DESC LIMIT 100"))
    .map(e => { const d = JSON.parse(e.detail); return { id: e.id, at: e.at, by: e.actor_email, kind: e.subject_kind, account: d.account, count: d.count ?? d.items.length, total: d.total ?? d.items.reduce((t: number, i: Data) => t + i.amount, 0), date: d.date } })
}

export const writeOffCommands: Record<string, Command> = { 'write-off.bulk': writeOff, 'write-off.limit': setLimit }
