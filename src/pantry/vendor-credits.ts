// Vendor credits reduce payables and reverse the original expense or asset.
// Applying one to a bill settles the balance without recording money movement.
import { dimensionTags, dimensionValues, dimensionRefusal } from './dimensions'
import { authority, who } from './access'
import { cents, date, now, requireThat, text, uid, type Data } from './core'
import { all, assertOpen, audit, guard, one, periodOpen, q, run, type Sql } from './db'
import { contact } from './contacts'
import { controlAccount } from './accounts'
import { entryStatements } from './journal'
import { allocations } from './payables'
import type { Command, Context } from './context'

export async function vendorCreditsView(db: D1Database): Promise<Data[]> {
  const rows = await all(db, `SELECT v.*, c.name AS vendor_name, a.name AS account_name,
    v.amount_cents - COALESCE((SELECT SUM(amount_cents) FROM pt_allocations WHERE source_kind = 'credit' AND source_id = v.id AND target_kind = 'bill'), 0) AS unallocated_cents
    FROM pt_vendor_credits v JOIN pt_contacts c ON c.id = v.vendor_id JOIN pt_accounts a ON a.id = v.account_id
    ORDER BY v.credit_date DESC, v.created_at DESC, v.id LIMIT 500`)
  const applied = await all(db, "SELECT * FROM pt_allocations WHERE source_kind = 'credit' AND target_kind = 'bill' ORDER BY allocation_date, id")
  return rows.map(v => ({ ...v, allocations: applied.filter(a => a.source_id === v.id) }))
}

const inserts = (id: string, day: string, actor: string, list: { targetId: string; amount: number }[]): Sql[] => list.map(a =>
  q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'credit', ?, 'bill', ?, ?, ?, ?, ?)", uid(), id, a.targetId, a.amount, day, actor, now()))

export async function prepareVendorCredit(c: Context, b: Data) {
  const vendor = await contact(c.db, text(b.vendorId, 'Vendor'), 'vendor')
  requireThat(vendor.active, 'Vendor is inactive')
  const day = date(b.date, 'Credit date'), amount = cents(b.amount, 'Credit amount'), reference = text(b.reference, "Vendor's credit reference", 80)
  await assertOpen(c.db, day)
  const account = await one(c.db, 'SELECT * FROM pt_accounts WHERE id = ?', text(b.accountId, 'Original expense or asset account'))
  requireThat(account?.active && ['expense', 'asset'].includes(account.type) && !['bank', 'receivable', 'payable'].includes(account.subtype), 'Choose the original active expense or asset account')
  const tags=dimensionTags(b),refusal=await dimensionRefusal(c.db,[account.id],tags)
  requireThat(!refusal,refusal??'Invalid dimensions',409)
  const allocated = await allocations(c.db, 'paid', vendor.id, b.allocations, amount)
  const payable = await controlAccount(c.db, 'payable'), id = uid(), journalId = uid()
  const statements = [authority(c.actor, 'record'), periodOpen(day),
    ...entryStatements({ id: journalId, date: day, memo: `Vendor credit ${reference} — ${vendor.name}`, sourceKind: 'credit', sourceId: id, preparedBy: c.actor.email, preparedKind: c.actor.kind === 'integration' ? 'import' : 'person', lines: [
      { accountId: payable.id, debit: amount, credit: 0, memo: reference, contactId: vendor.id },
      { ...tags,accountId: account.id, debit: 0, credit: amount, memo: reference },
    ] }, c.actor.email),
    q('INSERT INTO pt_vendor_credits (id, vendor_id, reference, credit_date, amount_cents, account_id, journal_id, created_by, created_at,class_name,location_name,project_name) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?,?,?,?)', id, vendor.id, reference, day, amount, account.id, journalId, c.actor.email, now(),...dimensionValues(tags)),
    ...inserts(id, day, c.actor.email, allocated.list), ...allocated.guards,
    audit(who(c.actor), 'vendor-credit.record', 'vendor-credit', id, { ...tags,vendor: vendor.name, reference, amount, allocations: allocated.list }),
  ]
  return { id, kind: 'vendor-credit', statements }
}

export async function prepareVendorCreditAllocation(c: Context, b: Data) {
  const credit = await one(c.db, 'SELECT * FROM pt_vendor_credits WHERE id = ?', text(b.creditId, 'Vendor credit'))
  requireThat(credit, 'Vendor credit not found', 404)
  const day = date(b.date ?? credit.credit_date, 'Allocation date')
  requireThat(day >= credit.credit_date, 'Apply a credit on or after its date')
  await assertOpen(c.db, day)
  const used = Number((await one(c.db, "SELECT COALESCE(SUM(amount_cents), 0) AS n FROM pt_allocations WHERE source_kind = 'credit' AND source_id = ? AND target_kind = 'bill'", credit.id))?.n ?? 0)
  const allocated = await allocations(c.db, 'paid', credit.vendor_id, b.allocations, credit.amount_cents - used)
  requireThat(allocated.list.length, 'Choose bills to apply the credit to')
  const statements = [authority(c.actor, 'record'), periodOpen(day), ...inserts(credit.id, day, c.actor.email, allocated.list), ...allocated.guards,
    guard("(SELECT COALESCE(SUM(amount_cents), 0) FROM pt_allocations WHERE source_kind = 'credit' AND source_id = ? AND target_kind = 'bill') <= ?", credit.id, credit.amount_cents),
    audit(who(c.actor), 'vendor-credit.allocate', 'vendor-credit', credit.id, { allocations: allocated.list }),
  ]
  return { id: credit.id, kind: 'vendor-credit', statements }
}

// Exact readback is shared by native commands and the scoped API; no capped list lookup.
export async function vendorCredit(db: D1Database, id: string): Promise<Data> {
  const credit = await one(db, `SELECT v.*, c.name AS vendor_name, a.name AS account_name,
    v.amount_cents - COALESCE((SELECT SUM(amount_cents) FROM pt_allocations WHERE source_kind = 'credit' AND source_id = v.id AND target_kind = 'bill'), 0) AS unallocated_cents
    FROM pt_vendor_credits v JOIN pt_contacts c ON c.id = v.vendor_id JOIN pt_accounts a ON a.id = v.account_id WHERE v.id = ?`, id)
  requireThat(credit, 'Vendor credit not found', 404)
  return { ...credit, allocations: await all(db, "SELECT * FROM pt_allocations WHERE source_kind = 'credit' AND source_id = ? AND target_kind = 'bill' ORDER BY allocation_date,id", id) }
}
const command = (prepare: typeof prepareVendorCredit): Command => ({ need: 'record', async run(c, b) {
  const p = await prepare(c, b)
  await run(c.db, p.statements)
  return vendorCredit(c.db, p.id)
} })
export const vendorCreditCommands: Record<string, Command> = {
  'vendor-credit.record': command(prepareVendorCredit), 'vendor-credit.allocate': command(prepareVendorCreditAllocation),
}
