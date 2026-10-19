// Approval rules are shared by captured and manually entered bills. The rule
// snapshot and exact bill revision are guarded again in the posting batch.
import { authority, who } from './access'
import type { Command } from './context'
import { now, optionalText, requireThat, text, uid, type Data } from './core'
import { all, approval, assertOpen, audit, changed, guard, one, periodOpen, q } from './db'
import { run } from './db'
import { bill, parseBill } from './payables'
import { requiresOwner } from './receipts/draft-approval'

export async function billRules(db: D1Database, p: Data) {
  const rules = await all(db, 'SELECT * FROM pt_capture_approval_rules ORDER BY id')
  return { ownerRequired: await requiresOwner(db, p, rules), guards: [guard("(SELECT COALESCE(group_concat(revision), '') FROM (SELECT revision FROM pt_capture_approval_rules ORDER BY id)) = ?", rules.map(r => r.revision).join(','))] }
}
export const billRulePayload = (b: Data) => ({ total: b.total_cents, vendorId: b.vendor_id, className: b.class_name, lines: b.lines.map((l: Data) => ({ accountId: l.account_id })) })

export async function manualBillPostingApproval(db: D1Database, current: Data) {
  const rules = await billRules(db, billRulePayload(current))
  requireThat(!rules.ownerRequired || (current.approved_by && current.approved_revision === current.revision), 'The owner must approve this exact bill revision before posting', 409)
  return [...rules.guards, guard("EXISTS (SELECT 1 FROM pt_bills WHERE id = ? AND revision = ? AND status = 'draft' AND (? = 0 OR (approved_by IS NOT NULL AND approved_revision = revision)))", current.id, current.revision, +rules.ownerRequired)]
}
const approve: Command = { need: 'post', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  requireThat(current.status === 'draft' && current.revision === b.revision, 'Bill changed or already recorded; reload', 409)
  requireThat(!await one(c.db, 'SELECT 1 FROM pt_capture_drafts WHERE bill_id = ?', current.id), 'Approve the document draft in Receipts', 409)
  const rules = await billRules(c.db, billRulePayload(current))
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || (!rules.ownerRequired && c.actor.email !== current.prepared_by)), rules.ownerRequired ? 'This bill needs the owner' : 'Someone other than the preparer approves this bill', 403)
  await assertOpen(c.db, current.bill_date)
  await run(c.db, [authority(c.actor, 'post'), periodOpen(current.bill_date), ...rules.guards,
    q("UPDATE pt_bills SET approved_by = ?, approved_revision = revision WHERE id = ? AND revision = ? AND status = 'draft'", c.actor.email, current.id, current.revision), changed(),
    approval(who(c.actor), 'bill', current.id, current.revision, 'bill.approve', 'approved', optionalText(b.note, 'Note', 500)),
    audit(who(c.actor), 'bill.approve', 'bill', current.id, { revision: current.revision, ownerRequired: rules.ownerRequired })])
  return bill(c.db, current.id)
} }
const update: Command = { need: 'record', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  requireThat(current.status === 'draft' && current.revision === b.revision, 'Bill changed or already recorded; reload', 409)
  requireThat(!await one(c.db, 'SELECT 1 FROM pt_capture_drafts WHERE bill_id = ?', current.id), 'Edit the document draft in Receipts', 409)
  const p = await parseBill(c.db, b)
  await assertOpen(c.db, current.bill_date); await assertOpen(c.db, p.billDate)
  await run(c.db, [authority(c.actor, 'record'), periodOpen(current.bill_date), periodOpen(p.billDate),
    q("UPDATE pt_bills SET vendor_id = ?, reference = ?, bill_date = ?, due_date = ?, memo = ?, class_name = ?, total_cents = ?, prepared_by = ?, revision = ?, updated_at = ?, approved_by = NULL, approved_revision = NULL WHERE id = ? AND revision = ? AND status = 'draft'", p.vendor.id, p.reference, p.billDate, p.dueDate, p.memo, p.className, p.total, c.actor.email, uid(), now(), current.id, current.revision), changed(),
    q('DELETE FROM pt_bill_lines WHERE bill_id = ?', current.id), ...p.lines.map((l, i) => q('INSERT INTO pt_bill_lines (id, bill_id, line_no, description, account_id, amount_cents) VALUES (?, ?, ?, ?, ?, ?)', uid(), current.id, i + 1, l.description, l.accountId, l.amount)),
    audit(who(c.actor), 'bill.edit', 'bill', current.id, { approvalInvalidated: current.approved_revision ?? null, lines: p.lines })])
  return bill(c.db, current.id)
} }
export const billApprovalCommands: Record<string, Command> = { 'bill.approve': approve, 'bill.update': update }
