// Document drafts share one revision-specific approval path for bills and paid
// expenses. Source bytes stay linked from preparation through posting.
import { authority, must, who } from '../access'
import { now, requireThat, text, uid, type Data } from '../core'
import { approval, assertOpen, audit, changed, guard, one, periodOpen, q, run, type Sql } from '../db'
import { bill, billStatements, postBill } from '../payables'
import { contact } from '../contacts'
import { controlAccount } from '../accounts'
import { matchPlan } from '../matching'
import type { Command } from '../context'
import { noDuplicate, duplicateOf } from './duplicates'
import { acceptedDraft, documentDraftProposal } from './draft-proposal'
import { captureApprovalCommands, captureBillApproval } from './draft-approval'

const money = (n: number) => (n / 100).toFixed(2)
export const draftBillLines = (p: Data) => [...p.lines.map((l: Data) => ({ ...l, amount: money(l.amount) })), ...(p.tax ? [{ description: 'Purchase tax', accountId: p.lines[0].accountId, amount: money(p.tax) }] : [])]

const save: Command = { need: 'record', async run(c, b) {
  const r = await one(c.db, "SELECT * FROM pt_receipts WHERE id = ? AND status = 'review'", text(b.id, 'Receipt'))
  requireThat(r && r.revision === b.revision, 'Receipt changed or already filed; reload', 409)
  const p = await acceptedDraft(c.db, r, b), previous = await one(c.db, 'SELECT * FROM pt_capture_drafts WHERE receipt_id = ?', r.id)
  requireThat(!previous || (previous.status !== 'posted' && previous.revision === b.draftRevision && previous.kind === p.kind), 'Draft changed or posted; reload before editing', 409)
  await assertOpen(c.db, p.date)
  const duplicate = await duplicateOf(c.db, r.id, { vendor: p.vendor, invoiceNumber: p.reference, date: p.date, total: p.total })
  requireThat(!duplicate, 'Review the duplicate before drafting this document', 409)
  const id = previous?.id ?? uid(), revision = uid(), statements: Sql[] = [authority(c.actor, 'record'), periodOpen(p.date), noDuplicate(r.id, { vendor: p.vendor, invoiceNumber: p.reference, date: p.date, total: p.total }),
    guard("EXISTS (SELECT 1 FROM pt_receipts WHERE id = ? AND revision = ? AND status = 'review' AND vendor_id = ?)", r.id, r.revision, p.vendorId)]
  let billId = previous?.bill_id ?? null
  if (p.kind === 'bill') {
    if (!billId) {
      const plan = await billStatements(c, { vendorId: p.vendorId, reference: p.reference, billDate: p.date, dueDate: p.dueDate, lines: draftBillLines(p), post: false })
      billId = plan.id; statements.push(...plan.statements)
    } else {
      const current = await bill(c.db, billId); requireThat(current.status === 'draft', 'Bill has already posted', 409)
      await assertOpen(c.db, current.bill_date)
      statements.push(periodOpen(current.bill_date), q("UPDATE pt_bills SET vendor_id = ?, reference = ?, bill_date = ?, due_date = ?, total_cents = ?, prepared_by = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'draft'", p.vendorId, p.reference, p.date, p.dueDate, p.total, c.actor.email, uid(), billId, current.revision), changed(),
        q('DELETE FROM pt_bill_lines WHERE bill_id = ?', billId), ...draftBillLines(p).map((l, i) => q('INSERT INTO pt_bill_lines (id, bill_id, line_no, description, account_id, amount_cents) VALUES (?, ?, ?, ?, ?, ?)', uid(), billId, i + 1, l.description, l.accountId, Math.round(Number(l.amount) * 100))))
    }
    statements.push(q("UPDATE pt_documents SET linked_kind = 'bill', linked_id = ? WHERE id IN (?, ?)", billId, r.document_id, r.file_document_id))
  } else {
    const line = await one(c.db, 'SELECT * FROM pt_bank_lines WHERE id = ? AND removed_at IS NULL', p.bankLineId)
    requireThat(line && line.amount_cents === -p.total, 'Choose the paid bank/card charge matching this receipt total', 409)
    requireThat(!await one(c.db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', line.id), 'This charge is already filed; attach the receipt to its existing posting instead', 409)
    statements.push(guard('NOT EXISTS (SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1)', line.id))
  }
  if (previous) statements.push(q("UPDATE pt_capture_drafts SET payload = ?, bank_line_id = ?, status = 'draft', revision = ?, prepared_by = ?, approved_by = NULL, approved_revision = NULL WHERE id = ? AND revision = ? AND status <> 'posted'", JSON.stringify(p), p.bankLineId, revision, c.actor.email, id, previous.revision), changed())
  else statements.push(q("INSERT INTO pt_capture_drafts (id, receipt_id, kind, bill_id, bank_line_id, payload, status, revision, prepared_by, created_at) VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)", id, r.id, p.kind, billId, p.bankLineId, JSON.stringify(p), revision, c.actor.email, now()))
  statements.push(audit(who(c.actor), 'capture-draft.save', 'capture-draft', id, { revision, before: previous ? JSON.parse(previous.payload) : null, after: p }))
  await run(c.db, statements)
  return documentDraftProposal(c.db, r)
} }

const post: Command = { need: 'post', async run(c, b) {
  const d = await one(c.db, 'SELECT * FROM pt_capture_drafts WHERE id = ?', text(b.id, 'Draft'))
  requireThat(d && d.status === 'approved' && d.approved_revision === d.revision && d.revision === b.revision, 'Approve the exact draft revision before posting', 409)
  const r = (await one(c.db, 'SELECT * FROM pt_receipts WHERE id = ?', d.receipt_id))!, p = JSON.parse(d.payload)
  requireThat(r.status === 'review' && r.vendor_id === p.vendorId, 'Receipt or vendor changed; review the draft again', 409)
  await assertOpen(c.db, p.date)
  const statements: Sql[] = [authority(c.actor, 'post'), periodOpen(p.date), guard("EXISTS (SELECT 1 FROM pt_receipts WHERE id = ? AND revision = ? AND status = 'review')", r.id, r.revision), guard("EXISTS (SELECT 1 FROM pt_capture_drafts WHERE id = ? AND revision = ? AND status = 'approved' AND approved_revision = revision)", d.id, d.revision)]
  let linkedId = d.bill_id, linkedKind = 'bill'
  if (d.kind === 'bill') {
    const current = await bill(c.db, d.bill_id), payable = await controlAccount(c.db, 'payable'), vendor = await contact(c.db, current.vendor_id)
    requireThat(current.status === 'draft', 'Bill already posted', 409)
    statements.push(...await captureBillApproval(c.db, d.bill_id), ...postBill(c.actor, { id: current.id, journalId: uid(), payable: payable.id, vendor, reference: current.reference, date: current.bill_date, lines: current.lines, total: current.total_cents }))
  } else {
    const plan = await matchPlan(c.db, c.actor, { bankLineIds: [d.bank_line_id], journalLineIds: [], create: draftBillLines(p).map(l => ({ type: 'fee', documentId: r.document_id, amount: l.amount, accountId: l.accountId, direction: 'out', memo: l.description })), note: `Approved receipt draft: ${p.vendor}` })
    linkedId = plan.entryIds[0]; linkedKind = 'journal'; statements.push(...plan.statements)
    statements.push(q("UPDATE pt_documents SET linked_kind = 'journal', linked_id = ? WHERE id IN (?, ?)", linkedId, r.document_id, r.file_document_id))
  }
  statements.push(q("UPDATE pt_capture_drafts SET status = 'posted' WHERE id = ? AND revision = ? AND status = 'approved'", d.id, d.revision), changed(),
    q("UPDATE pt_receipts SET status = 'attached', linked_kind = ?, linked_id = ?, target_kind = ?, target_id = ?, total_cents = ?, tax_cents = ?, receipt_date = ?, invoice_number = ?, decided_by = ?, decided_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'review'", linkedKind, linkedId, d.kind === 'bill' ? 'bill' : 'bankline', d.bill_id ?? d.bank_line_id, p.total, p.tax, p.date, p.reference, c.actor.email, now(), uid(), r.id, r.revision), changed(),
    audit(who(c.actor), 'capture-draft.post', 'capture-draft', d.id, { revision: d.revision, approval: d.approved_by, recordKind: linkedKind, recordId: linkedId }))
  await run(c.db, statements)
  return { id: d.id, kind: linkedKind, recordId: linkedId }
} }
export const captureDraftCommands: Record<string, Command> = { 'receipt.draft-save': save, 'capture-draft.post': post, ...captureApprovalCommands }
