import { refunded } from './refunds/store'
// Applying an already issued customer credit moves no money and posts no sale.
import { authority, who } from './access'
import { date, now, requireThat, text, uid } from './core'
import { assertOpen, audit, guard, one, periodOpen, q, run } from './db'
import { invoice } from './invoices'
import { allocations } from './payables'
import { withdrawalStatements } from './early-payment'
import type { Command } from './context'

const apply: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person' && ['owner', 'accountant', 'bookkeeper'].includes(c.actor.role), 'A financial team member applies customer credits', 403)
  const credit = await invoice(c.db, text(b.creditId, 'Customer credit'))
  requireThat(credit.kind === 'credit' && credit.status === 'issued' && !credit.early_reversal_id, 'Choose an issued credit that has not been reversed', 409)
  const day = date(b.date, 'Application date')
  requireThat(day >= credit.issue_date, 'Apply a credit on or after its date')
  await assertOpen(c.db, day)
  const used = Number((await one(c.db, "SELECT COALESCE(SUM(amount_cents),0) AS n FROM pt_allocations WHERE source_kind='credit' AND source_id=? AND target_kind='invoice' AND voided_by IS NULL", credit.id))?.n ?? 0)
  const prepared = await allocations(c.db, 'received', credit.customer_id, b.allocations, credit.total_cents - used - await refunded(c.db, 'credit', credit.id))
  requireThat(prepared.list.length, 'Choose invoices to apply the credit to')
  const withdrawals = []
  for (const a of prepared.list) {
    const target = await invoice(c.db, a.targetId)
    requireThat(day >= target.issue_date, 'Apply a credit on or after the target invoice date')
    withdrawals.push(...await withdrawalStatements(c.db, who(c.actor), target, credit.id, credit.number))
  }
  const amount = prepared.list.reduce((n, a) => n + a.amount, 0)
  await run(c.db, [authority(c.actor, 'record'), periodOpen(day),
    guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND kind='credit' AND status='issued' AND early_reversal_id IS NULL)", credit.id),
    ...prepared.list.map(a => q("INSERT INTO pt_allocations(id,source_kind,source_id,target_kind,target_id,amount_cents,allocation_date,created_by,created_at) VALUES (?,'credit',?,'invoice',?,?,?,?,?)", uid(), credit.id, a.targetId, a.amount, day, c.actor.email, now())),
    ...prepared.guards,
    guard("(SELECT COALESCE(SUM(amount_cents),0) FROM pt_allocations WHERE source_kind='credit' AND source_id=? AND target_kind='invoice' AND voided_by IS NULL)<=?", credit.id, credit.total_cents),
    ...withdrawals, audit(who(c.actor), 'customer-credit.allocate', 'credit', credit.id, { date: day, allocations: prepared.list })])
  return { id: credit.id, applied: amount, remaining: credit.total_cents - used - amount }
} }
export const customerCreditCommands = { 'customer-credit.allocate': apply }
