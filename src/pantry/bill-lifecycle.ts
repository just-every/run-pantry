// Workflow labels are derived from accounting evidence, never a payment promise.
import { authority, who } from './access'
import type { Command } from './context'
import { date, optionalText, requireThat, text, type Data } from './core'
import { all, assertOpen, audit, changed, guard, one, periodOpen, q, run } from './db'
import { bill } from './payables'

export async function billLifecycle(db: D1Database, b: Data, captured?: Data | null) {
  if (b.status === 'void') return { stage: 'Void', nextActor: 'None' }
  if (b.status === 'draft') {
    const approved = captured ? captured.status === 'approved' && captured.approved_revision === captured.revision : b.approved_revision === b.revision
    const submitted = captured ? captured.submitted_revision === captured.revision : b.submitted_revision === b.revision
    return { stage: approved ? 'Approved' : submitted ? 'Awaiting approval' : 'Draft',
      nextActor: approved ? 'Posting grant holder' : submitted ? b.owner_required ? 'Owner' : 'Owner or another posting grant holder' : 'Preparer',
      captureDraftId: captured?.id, captureRevision: captured?.revision }
  }
  if (b.open_cents === 0) {
    const payments = await all(db, `SELECT p.journal_id FROM pt_allocations a JOIN pt_payments p ON p.id=a.source_id
      WHERE a.target_kind='bill' AND a.target_id=? AND a.source_kind='payment' AND p.reversal_id IS NULL`, b.id)
    let reconciled = payments.length > 0
    for (const p of payments) {
      const proof = await one(db, `SELECT 1 FROM pt_match_postings mp JOIN pt_matches m ON m.id=mp.match_id AND m.status='approved'
        JOIN pt_match_bank_lines mb ON mb.match_id=m.id AND mb.active=1 JOIN pt_bank_lines bl ON bl.id=mb.bank_line_id
        JOIN pt_reconciliations r ON r.bank_account_id=bl.bank_account_id AND bl.posted_date BETWEEN
          (SELECT start_date FROM pt_statements WHERE id=r.statement_id) AND r.end_date
        JOIN pt_journal_lines jl ON jl.id=mp.journal_line_id WHERE mp.active=1 AND jl.entry_id=?`, p.journal_id)
      if (!proof) reconciled = false
    }
    return { stage: reconciled ? 'Reconciled' : 'Paid', nextActor: reconciled ? 'None' : payments.length ? 'Reconciler' : 'None — settled by credit' }
  }
  return { stage: b.scheduled_date ? 'Scheduled' : 'Approved', nextActor: 'Payment recorder', scheduledDate: b.scheduled_date, scheduledNote: b.scheduled_note }
}

const submit: Command = { need: 'record', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  requireThat(current.status === 'draft' && current.revision === b.revision, 'Bill changed; reload its draft', 409)
  await assertOpen(c.db, current.bill_date)
  const d = await one(c.db, 'SELECT * FROM pt_capture_drafts WHERE bill_id=?', current.id)
  await run(c.db, [authority(c.actor, 'record'), periodOpen(current.bill_date),
    ...(d ? [q("UPDATE pt_capture_drafts SET submitted_revision=revision WHERE id=? AND revision=? AND status='draft'", d.id, b.captureRevision), changed()] :
      [q("UPDATE pt_bills SET submitted_revision=revision WHERE id=? AND revision=? AND status='draft'", current.id, current.revision), changed()]),
    audit(who(c.actor), 'bill.submit', 'bill', current.id, { revision: d?.revision ?? current.revision })])
  return { id: current.id }
} }

const schedule: Command = { need: 'record', async run(c, b) {
  const current = await bill(c.db, text(b.id, 'Bill'))
  requireThat(current.status === 'posted' && current.open_cents > 0 && current.revision === b.revision, 'Choose a current posted bill with money still due', 409)
  const day = b.date ? date(b.date, 'Planned payment date') : null
  requireThat(!day || day >= current.bill_date, 'Plan payment on or after the bill date')
  if (day) await assertOpen(c.db, day)
  await run(c.db, [authority(c.actor, 'record'), ...(day ? [periodOpen(day)] : []),
    guard("EXISTS (SELECT 1 FROM pt_bills WHERE id=? AND revision=? AND status='posted')", current.id, current.revision),
    q('UPDATE pt_bills SET scheduled_date=?, scheduled_note=? WHERE id=?', day, optionalText(b.note, 'Payment plan note', 500), current.id),
    audit(who(c.actor), day ? 'bill.payment-planned' : 'bill.payment-plan-canceled', 'bill', current.id, { date: day, movesMoney: false })])
  return { id: current.id }
} }

export const billLifecycleCommands: Record<string, Command> = { 'bill.submit': submit, 'bill.schedule': schedule }

export async function capturedBillInbox(db: D1Database) {
  return all(db, `SELECT r.id, COALESCE(r.vendor,r.read_vendor,'Unconfirmed vendor') AS vendor,
    COALESCE(r.invoice_number,r.read_invoice_number,d.name) AS reference,
    COALESCE(r.receipt_date,r.read_date) AS date, COALESCE(r.total_cents,r.read_total_cents) AS total_cents,
    d.name, json_extract(r.read_draft_fields,'$.dueDate') AS due_date, r.received_at FROM pt_receipts r JOIN pt_documents d ON d.id=r.document_id
    WHERE r.status='review' AND NOT EXISTS (SELECT 1 FROM pt_capture_drafts c WHERE c.receipt_id=r.id)
    ORDER BY r.received_at DESC`)
}
