// A person accepts or corrects what was read and attaches the receipt to a
// transaction. A bank or card line not yet in the books is recorded to the
// account the person (or the business's rule) chose, in the same batch.
import { authority, who, type Actor } from '../access'
import { cents, date, Fault, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { all, audit, changed, guard, one, q, run, type AuditActor, type Sql } from '../db'
import { account } from '../accounts'
import { documentFile } from '../documents'
import { matchPlan } from '../matching'
import type { Command, Context } from '../context'
import { vendorLikeness } from './attachments'
import { candidates, matchFacts, type Candidate } from './matches'
import { readable, readingColumns, readWith, receipt } from './intake'
import { emailReadable } from './mail'
import { flagDuplicate, noDuplicate, readFingerprint, vendorKey, type Duplicate } from './duplicates'

export type Fields = { vendor: string | null; invoiceNumber?: string | null; date: string | null; total: number | null; tax: number | null; currency: string | null; accountId: string | null }
type Target = { kind: Candidate['kind']; id: string }

/** The record the document will belong to, and the statements that make it so. */
async function attachPlan(db: D1Database, actor: Actor, r: Data, target: Target, f: Fields, duplicateReason = '', duplicate?: Duplicate | null): Promise<{ statements: Sql[]; linked: { kind: string; id: string } }> {
  requireThat(!await one(db, 'SELECT 1 FROM pt_capture_drafts WHERE receipt_id = ?', r.id), 'Approve and post the document draft instead of attaching it directly', 409)
  const statements: Sql[] = [
    noDuplicate(r.id, f, duplicateReason ? duplicate : null),
    guard("? <> '' OR NOT EXISTS (SELECT 1 FROM pt_receipts WHERE status = 'attached' AND target_kind = ? AND target_id = ?)", duplicateReason, target.kind, target.id),
  ]
  let linked: { kind: string; id: string }
  if (target.kind === 'bill') {
    const b = await one(db, 'SELECT id, status FROM pt_bills WHERE id = ?', target.id)
    requireThat(b && b.status !== 'void', 'Bill not found', 404)
    linked = { kind: 'bill', id: b.id }
  } else if (target.kind === 'payment') {
    const p = await one(db, 'SELECT id FROM pt_payments WHERE id = ? AND reversal_id IS NULL', target.id)
    requireThat(p, 'Payment not found or reversed', 404)
    linked = { kind: 'payment', id: p.id }
  } else if (target.kind === 'journal') {
    const e = await one(db, "SELECT id FROM pt_journal_entries WHERE id = ? AND status = 'posted'", target.id)
    requireThat(e, 'Posted entry not found', 404)
    linked = { kind: 'journal', id: e.id }
  } else {
    const line = await one(db, 'SELECT * FROM pt_bank_lines WHERE id = ?', target.id)
    requireThat(line, 'Statement line not found', 404)
    const entry = await one<{ entry_id: string }>(db, 'SELECT jl.entry_id FROM pt_match_bank_lines mb JOIN pt_match_postings mp ON mp.match_id = mb.match_id AND mp.active = 1 JOIN pt_journal_lines jl ON jl.id = mp.journal_line_id WHERE mb.bank_line_id = ? AND mb.active = 1 LIMIT 1', line.id)
    if (entry) {
      const payment = await one<{ id: string }>(db, 'SELECT id FROM pt_payments WHERE journal_id = ?', entry.entry_id)
      linked = payment ? { kind: 'payment', id: payment.id } : { kind: 'journal', id: entry.entry_id }
    } else {
      // Not in the books yet: record it, matched to its line, as the person accepted.
      requireThat(f.accountId, 'Choose the account to record this to')
      const into = line.amount_cents > 0, amount = (Math.abs(line.amount_cents) / 100).toFixed(2)
      const plan = await matchPlan(db, actor, { bankLineIds: [line.id], journalLineIds: [], create: [{ type: into ? 'income' : 'fee', direction: into ? 'in' : 'out', amount, accountId: f.accountId, memo: f.vendor ?? line.description, date: line.posted_date }], note: `Receipt ${r.id}` })
      statements.push(...plan.statements)
      linked = { kind: 'journal', id: plan.entryIds[0] }
    }
  }
  const docs = [r.document_id, r.file_document_id].filter(Boolean)
  statements.push(
    q(`UPDATE pt_documents SET linked_kind = ?, linked_id = ? WHERE id IN (${docs.map(() => '?').join(', ')}) AND linked_kind IS NULL`, linked.kind, linked.id, ...docs), changed(docs.length),
    q(`UPDATE pt_receipts SET status = 'attached', vendor = ?, receipt_date = ?, total_cents = ?, tax_cents = ?, currency = ?, account_id = ?, target_kind = ?, target_id = ?, linked_kind = ?, linked_id = ?, decided_by = ?, decided_at = ?, revision = ?, vendor_key = ?, invoice_number = ?, duplicate_reason = ?, duplicate_of = ?, duplicate_document_id = ?, duplicate_basis = ? WHERE id = ? AND revision = ? AND status = 'review'`,
      f.vendor, f.date, f.total, f.tax, f.currency, f.accountId, target.kind, target.id, linked.kind, linked.id, actor.email, now(), uid(), vendorKey(f.vendor), f.invoiceNumber ?? null, duplicateReason || null, duplicate?.receipt_id ?? null, duplicate?.document_id ?? null, duplicate?.basis ?? null, r.id, r.revision), changed())
  return { statements, linked }
}

const amount = (v: unknown, label: string, zero = false) => v === undefined || v === null || v === '' ? null : cents(v, label, { zero })

function fieldsFrom(b: Data): Fields {
  const currency = optionalText(b.currency, 'Currency', 3).toUpperCase() || null
  requireThat(!currency || /^[A-Z]{3}$/.test(currency), 'Currency is a three-letter code like USD')
  return { vendor: optionalText(b.vendor, 'Vendor', 200) || null, invoiceNumber: optionalText(b.invoiceNumber, 'Invoice number', 80) || null, date: b.date ? date(b.date, 'Receipt date') : null, total: amount(b.total, 'Total'), tax: amount(b.tax, 'Tax', true), currency, accountId: optionalText(b.accountId, 'Account', 80) || null }
}

const corrected = (r: Data, f: Fields) => (['vendor', 'invoiceNumber', 'date', 'total', 'tax', 'currency', 'accountId'] as const).filter(k => {
  const read = { vendor: r.read_vendor, invoiceNumber: r.read_invoice_number, date: r.read_date, total: r.read_total_cents, tax: r.read_tax_cents, currency: r.read_currency, accountId: r.read_account_id }[k]
  return r.read_status === 'read' && (read ?? null) !== (f[k] ?? null)
})

const attach: Command = { need: 'record', async run(c, b) {
  const r = await receipt(c.db, text(b.id, 'Receipt'))
  requireThat(r, 'Receipt not found', 404)
  requireThat(r.status === 'review' && r.revision === b.revision, 'This receipt changed; reload', 409)
  requireThat(b.targetKind && b.targetId, 'Choose the transaction this receipt belongs to')
  const kind = text(b.targetKind, 'Transaction') as Target['kind']
  requireThat(['bankline', 'bill', 'payment', 'journal'].includes(kind), 'Choose a bank or card line, bill, payment or entry')
  const entered = fieldsFrom(b)
  const f: Fields = { vendor: entered.vendor ?? r.vendor ?? r.read_vendor, invoiceNumber: entered.invoiceNumber ?? r.invoice_number ?? r.read_invoice_number, date: entered.date ?? r.read_date, total: entered.total ?? r.read_total_cents, tax: entered.tax ?? r.read_tax_cents, currency: entered.currency ?? r.read_currency, accountId: entered.accountId ?? r.account_id ?? r.read_account_id }
  const duplicate = await flagDuplicate(c.db, r, f)
  const duplicateReason = optionalText(b.duplicateReason, 'Reason to keep both', 300)
  if (duplicate && !duplicateReason) {
    // Keep the person's typed facts so a receipt read without a key can show
    // the warning and offer the same transaction on its next review.
    await run(c.db, [authority(c.actor, 'record'),
      q("UPDATE pt_receipts SET vendor = ?, receipt_date = ?, total_cents = ?, tax_cents = ?, currency = ?, account_id = ?, invoice_number = ?, vendor_key = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'review'",
        f.vendor, f.date, f.total, f.tax, f.currency, f.accountId, f.invoiceNumber ?? null, vendorKey(f.vendor), uid(), r.id, r.revision), changed()])
    requireThat(false, 'Duplicate receipt: review the original, then choose Keep both with a reason or Skip', 409)
  }
  if (f.accountId) { const a = await account(c.db, f.accountId); requireThat(a.active && !['bank', 'receivable', 'payable'].includes(a.subtype), 'Choose an expense or other account') }
  const plan = await attachPlan(c.db, c.actor, r, { kind, id: text(b.targetId, 'Transaction') }, f, duplicate ? duplicateReason : '', duplicate)
  await run(c.db, [authority(c.actor, 'record'), ...plan.statements,
    audit(who(c.actor), 'receipt.attach', 'receipt', r.id, { target: `${kind}:${b.targetId}`, linked: `${plan.linked.kind}:${plan.linked.id}`, corrected: corrected(r, f), duplicateOf: duplicate?.id ?? null, duplicateDocumentId: duplicate?.document_id ?? null, duplicateReason: duplicate ? duplicateReason : null })])
  return (await receipt(c.db, r.id))!
} }

const dismiss: Command = { need: 'record', async run(c, b) {
  const r = await receipt(c.db, text(b.id, 'Receipt'))
  requireThat(r && r.status === 'review', 'Receipt not found or already decided', 404)
  const duplicate = await flagDuplicate(c.db, r, b.total ? fieldsFrom(b) : readFingerprint(r))
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_receipts SET status = 'dismissed', decided_by = ?, decided_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'review'", c.actor.email, now(), uid(), r.id, b.revision), changed(),
    audit(who(c.actor), 'receipt.dismiss', 'receipt', r.id, { reason: optionalText(b.reason, 'Reason', 300), duplicateOf: duplicate?.id ?? null })])
  return { id: r.id }
} }

/** Read again, for example after a key was added; the file is unchanged. */
const readAgain: Command = { need: 'record', async run(c, b) {
  const r = await receipt(c.db, text(b.id, 'Receipt'))
  requireThat(r && r.status === 'review', 'Receipt not found or already decided', 404)
  const file = await documentFile(c.db, r.file_document_id ?? r.document_id)
  requireThat(file, 'Document not found', 404)
  const input = file.mediaType === 'message/rfc822' ? emailReadable(file.bytes, file.name) : readable({ name: file.name, mediaType: file.mediaType, bytes: file.bytes })
  const cols = await readingColumns(c.db, await readWith(c.db, c.env, input))
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_receipts SET read_status = ?, read_note = ?, read_model = ?, read_at = ?, read_vendor = ?, read_invoice_number = ?, read_date = ?, read_total_cents = ?, read_tax_cents = ?, read_currency = ?, read_account_id = ?, read_vendor_details = ?, read_draft_fields = ?, read_match_fields = ?, vendor_id = NULL, vendor = NULL, account_id = NULL, vendor_terms_days = NULL, vendor_is_1099 = NULL, vendor_class = NULL, vendor_confirmed_by = NULL, vendor_confirmed_at = NULL, revision = ?, vendor_key = ? WHERE id = ? AND status = 'review'",
      cols.read_status, cols.read_note, cols.read_model, cols.read_at, cols.read_vendor, cols.read_invoice_number, cols.read_date, cols.read_total_cents, cols.read_tax_cents, cols.read_currency, cols.read_account_id, cols.read_vendor_details, cols.read_draft_fields, cols.read_match_fields, uid(), vendorKey(cols.read_vendor), r.id), changed(),
    audit(who(c.actor), 'receipt.read', 'receipt', r.id, { read: cols.read_status })])
  await flagDuplicate(c.db, (await receipt(c.db, r.id))!)
  return (await receipt(c.db, r.id))!
} }

const notNeeded: Command = { need: 'post', async run(c, b) {
  const entry = await one(c.db, "SELECT id FROM pt_journal_entries WHERE id = ? AND status = 'posted'", text(b.entryId, 'Entry'))
  requireThat(entry, 'Posted entry not found', 404)
  const reason = text(b.reason, 'Reason', 300)
  await run(c.db, [authority(c.actor, 'post'), q('INSERT INTO pt_receipt_waivers (entry_id, reason, waived_by, waived_at) VALUES (?, ?, ?, ?)', entry.id, reason, c.actor.email, now()),
    audit(who(c.actor), 'receipt.not-needed', 'journal', entry.id, { reason })])
  return { entryId: entry.id }
} }

const saveRule: Command = { need: 'owner', async run(c, b) {
  const vendor = text(b.vendor, 'Vendor', 120), a = await account(c.db, text(b.accountId, 'Account'))
  requireThat(a.active && !['bank', 'receivable', 'payable'].includes(a.subtype), 'Choose an expense or other account')
  const max = cents(b.max, 'Up to amount'), id = uid()
  await run(c.db, [authority(c.actor, 'owner'), q('INSERT INTO pt_receipt_rules (id, vendor, account_id, max_cents, active, created_by, created_at) VALUES (?, ?, ?, ?, 1, ?, ?)', id, vendor, a.id, max, c.actor.email, now()),
    audit(who(c.actor), 'receipt-rule.save', 'receipt-rule', id, { vendor, account: a.code, max })])
  return { id }
} }

const removeRule: Command = { need: 'owner', async run(c, b) {
  const id = text(b.id, 'Rule')
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_receipt_rules SET active = 0 WHERE id = ? AND active = 1', id), changed(), audit(who(c.actor), 'receipt-rule.remove', 'receipt-rule', id)])
  return { id }
} }

export const reviewCommands: Record<string, Command> = {
  'receipt.attach': attach,
  'receipt.dismiss': dismiss,
  'receipt.read': readAgain,
  'receipt.not-needed': notNeeded,
  'receipt-rule.save': saveRule,
  'receipt-rule.remove': removeRule,
}

/** A person chose the transaction (from the close list): attach with whatever was read. */
export async function attachChosen(c: Context, receiptId: string, target: Target) {
  const r = (await receipt(c.db, receiptId))!
  const f: Fields = { vendor: r.read_vendor, invoiceNumber: r.read_invoice_number, date: r.read_date, total: r.read_total_cents, tax: r.read_tax_cents, currency: r.read_currency, accountId: r.read_account_id }
  if (await flagDuplicate(c.db, r, f)) return false
  const plan = await attachPlan(c.db, c.actor, r, target, f)
  try {
    await run(c.db, [authority(c.actor, 'record'), ...plan.statements, audit(who(c.actor), 'receipt.attach', 'receipt', r.id, { target: `${target.kind}:${target.id}`, linked: `${plan.linked.kind}:${plan.linked.id}`, chosen: true })])
  } catch (error) {
    if (await flagDuplicate(c.db, r, f)) return false
    throw error
  }
  return true
}

/**
 * The business's rule: a receipt whose vendor the rule names, up to its amount,
 * that matches exactly one transaction by amount, within five days and by
 * vendor, is attached (and recorded to the rule's account) without waiting.
 */
export async function applyRules(db: D1Database, receiptId: string) {
  const r = await receipt(db, receiptId)
  if (!r || r.status !== 'review' || r.read_status !== 'read' || !r.read_vendor || !r.read_total_cents || !r.read_date) return null
  if (await flagDuplicate(db, r, readFingerprint(r))) return null
  const rules = await all(db, 'SELECT * FROM pt_receipt_rules WHERE active = 1 ORDER BY created_at')
  const rule = rules.find(x => vendorLikeness(x.vendor, r.read_vendor) === 1 && r.read_total_cents <= x.max_cents)
  if (!rule) return null
  const found = (await candidates(db, r.read_total_cents, r.read_date, r.read_vendor, r.read_currency, matchFacts(r))).filter(x => (r.read_currency ?? 'USD') === 'USD' && x.amount_cents === r.read_total_cents)
  if (found.length !== 1) return null
  const owner = await one<{ email: string; role: string }>(db, "SELECT email, role FROM oa_operators WHERE lower(email) = lower(?) AND status = 'active'", rule.created_by)
  if (!owner || owner.role !== 'owner') return null
  // The rule acts with the authority of the owner who set it; the audit names the rule.
  const actor: Actor = { kind: 'person', id: 'rule', email: rule.created_by, name: 'Receipt rule', session: '', role: 'owner', grants: { post: true, lock: true, reopen: true } }
  const f: Fields = { vendor: r.read_vendor, invoiceNumber: r.read_invoice_number, date: r.read_date, total: r.read_total_cents, tax: r.read_tax_cents, currency: r.read_currency, accountId: rule.account_id }
  const plan = await attachPlan(db, actor, r, { kind: found[0].kind, id: found[0].id }, f)
  const by: AuditActor = { email: rule.created_by, kind: 'person' }
  try {
    await run(db, [guard('EXISTS (SELECT 1 FROM pt_receipt_rules WHERE id = ? AND active = 1)', rule.id), ...plan.statements,
    q('UPDATE pt_receipts SET rule_id = ? WHERE id = ?', rule.id, r.id),
    audit(by, 'receipt.attach-by-rule', 'receipt', r.id, { rule: rule.id, vendor: rule.vendor, target: `${found[0].kind}:${found[0].id}`, linked: `${plan.linked.kind}:${plan.linked.id}` })])
  } catch (error) {
    if (await flagDuplicate(db, r, f)) return null
    throw error
  }
  return rule.id as string
}

/** New feed/file lines revisit waiting receipts under their existing owner rule.
 * Receipts without a rule remain suggestions, recomputed by the review door. */
export async function matchWaitingReceipts(db: D1Database) {
  for (const r of await all(db, "SELECT id FROM pt_receipts WHERE status = 'review' AND read_status = 'read' ORDER BY received_at, id")) {
    try { await applyRules(db, r.id) } catch (error) {
      // A lock/reconciliation or a concurrent decision leaves the receipt for review.
      if (!(error instanceof Fault) || error.status !== 409) throw error
    }
  }
}
