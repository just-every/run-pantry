// A captured draft is posted only after approval of the exact revision.
import { authority, who, type Actor } from '../access'
import { cents, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { all, approval, audit, changed, guard, one, q, run } from '../db'
import type { Command } from '../context'

export async function captureBillApproval(db: D1Database, billId: string) {
  const d = await one(db, 'SELECT * FROM pt_capture_drafts WHERE bill_id = ?', billId)
  if (!d) return []
  requireThat(d.status === 'approved' && d.approved_revision === d.revision, 'Approve the captured draft revision before posting', 409)
  return [guard("EXISTS (SELECT 1 FROM pt_capture_drafts WHERE id = ? AND revision = ? AND status = 'approved' AND approved_revision = revision)", d.id, d.revision)]
}
export async function requiresOwner(db: D1Database, p: Data, rules?: Data[]) {
  rules ??= await all(db, 'SELECT * FROM pt_capture_approval_rules')
  return rules.some(r => p.total >= r.minimum_cents && (!r.vendor_id || r.vendor_id === p.vendorId) && (!r.account_id || p.lines.some((l: Data) => l.accountId === r.account_id)) && (!r.class_name || r.class_name === p.className))
}
const approve: Command = { need: 'post', async run(c, b) {
  const d = await one(c.db, 'SELECT * FROM pt_capture_drafts WHERE id = ?', text(b.id, 'Draft'))
  requireThat(d && d.status === 'draft' && d.revision === b.revision, 'Draft changed or already approved; reload', 409)
  const p = JSON.parse(d.payload), rules = await all(c.db, 'SELECT * FROM pt_capture_approval_rules ORDER BY id'), owner = await requiresOwner(c.db, p, rules)
  requireThat(c.actor.kind === 'person' && (c.actor.role === 'owner' || (!owner && c.actor.email !== d.prepared_by)), owner ? 'This draft needs the owner' : 'Someone other than the preparer approves this draft', 403)
  await run(c.db, [authority(c.actor, 'post'),
    guard('(SELECT COALESCE(group_concat(revision), \'\') FROM (SELECT revision FROM pt_capture_approval_rules ORDER BY id)) = ?', rules.map(r => r.revision).join(',')),
    q("UPDATE pt_capture_drafts SET status = 'approved', approved_by = ?, approved_revision = revision WHERE id = ? AND status = 'draft' AND revision = ?", c.actor.email, d.id, d.revision), changed(),
    approval(who(c.actor), d.kind, d.bill_id ?? d.id, d.revision, 'approve-document-draft', 'approved', optionalText(b.note, 'Note', 500)),
    audit(who(c.actor), 'capture-draft.approve', 'capture-draft', d.id, { revision: d.revision, ownerRequired: owner })])
  return { id: d.id }
} }
const saveRule: Command = { need: 'owner', async run(c, b) {
  const id = uid(), vendorId = optionalText(b.vendorId, 'Vendor') || null, accountId = optionalText(b.accountId, 'Account') || null
  if (vendorId) requireThat(await one(c.db, "SELECT 1 FROM pt_contacts WHERE id = ? AND kind = 'vendor' AND active = 1", vendorId), 'Vendor not found')
  if (accountId) requireThat(await one(c.db, 'SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1', accountId), 'Account not found')
  const minimum = cents(b.minimum ?? '0', 'Minimum amount', { zero: true }), className = optionalText(b.className, 'Class', 100)
  await run(c.db, [authority(c.actor, 'owner'), q('INSERT INTO pt_capture_approval_rules (id, minimum_cents, vendor_id, account_id, class_name, revision) VALUES (?, ?, ?, ?, ?, ?)', id, minimum, vendorId, accountId, className, uid()), q("UPDATE pt_capture_drafts SET status = 'draft', approved_by = NULL, approved_revision = NULL WHERE status = 'approved'"), audit(who(c.actor), 'capture-approval-rule.save', 'capture-approval-rule', id, { minimum, vendorId, accountId, className })])
  return { id }
} }
export const captureApprovalCommands: Record<string, Command> = { 'capture-draft.approve': approve, 'capture-approval-rule.save': saveRule }
