// A cash receipt becomes a normal journal draft, with its source bytes kept.
// Posting remains the journal's separate, revision-specific human approval.
import { authority, who } from '../access'
import { account } from '../accounts'
import { cents, date, now, optionalText, requireThat, text, uid } from '../core'
import { assertOpen, audit, changed, guard, one, periodOpen, q, run } from '../db'
import { entry, entryStatements } from '../journal'
import type { Command } from '../context'
import { duplicateOf, noDuplicate, vendorKey } from './duplicates'
import { receipt } from './intake'

const cashDraft: Command = { need: 'record', async run(c, b) {
  const r = await receipt(c.db, text(b.id, 'Receipt'))
  requireThat(r, 'Receipt not found', 404)
  requireThat(r.status === 'review' && r.revision === b.revision, 'This receipt changed; reload', 409)
  requireThat(!await one(c.db, 'SELECT 1 FROM pt_capture_drafts WHERE receipt_id = ?', r.id), 'Review the existing document draft instead', 409)

  const vendor = text(b.vendor, 'Vendor', 200), day = date(b.date, 'Receipt date')
  const total = cents(b.total, 'Receipt total')
  const currency = optionalText(b.currency, 'Currency', 3).toUpperCase() || 'USD'
  requireThat(currency === 'USD', 'Cash receipt drafts currently use USD; confirm the dollar amount first')
  const expense = await account(c.db, text(b.accountId, 'Expense account'))
  requireThat(expense.active && expense.type === 'expense', 'Choose an active expense account')
  const funding = await account(c.db, text(b.fundingAccountId, 'Paid from'))
  requireThat(funding.active && ['asset', 'equity'].includes(funding.type) && !['receivable', 'payable', 'retained'].includes(funding.subtype), 'Choose an active cash asset or owner-contribution account')
  await assertOpen(c.db, day)

  const facts = { vendor, date: day, total, invoiceNumber: r.invoice_number ?? r.read_invoice_number ?? null }
  requireThat(!await duplicateOf(c.db, r.id, facts), 'Duplicate receipt: review the original before drafting another expense', 409)
  const id = uid(), revision = uid(), memo = `${vendor} · cash receipt`
  const documents = [...new Set<string>([r.document_id, r.file_document_id].filter(Boolean))]
  const lines = [
    { accountId: expense.id, debit: total, credit: 0, memo: vendor, contactId: r.vendor_id ?? null },
    { accountId: funding.id, debit: 0, credit: total, memo: vendor },
  ]
  await run(c.db, [
    authority(c.actor, 'record'), periodOpen(day),
    guard("EXISTS (SELECT 1 FROM pt_receipts WHERE id = ? AND revision = ? AND status = 'review')", r.id, b.revision),
    guard('NOT EXISTS (SELECT 1 FROM pt_capture_drafts WHERE receipt_id = ?)', r.id),
    guard("EXISTS (SELECT 1 FROM pt_accounts WHERE id = ? AND revision = ? AND active = 1 AND type = 'expense')", expense.id, expense.revision),
    guard("EXISTS (SELECT 1 FROM pt_accounts WHERE id = ? AND revision = ? AND active = 1 AND type IN ('asset', 'equity') AND subtype NOT IN ('receivable', 'payable', 'retained'))", funding.id, funding.revision),
    noDuplicate(r.id, facts),
    ...entryStatements({ id, revision, date: day, memo, sourceKind: 'manual', sourceId: r.id, preparedBy: c.actor.email, preparedKind: 'person', documentId: r.document_id, lines }),
    q(`UPDATE pt_documents SET linked_kind = 'journal', linked_id = ? WHERE id IN (${documents.map(() => '?').join(', ')}) AND linked_kind IS NULL`, id, ...documents), changed(documents.length),
    q("UPDATE pt_receipts SET status = 'attached', vendor = ?, vendor_key = ?, receipt_date = ?, total_cents = ?, currency = 'USD', account_id = ?, invoice_number = ?, target_kind = 'journal', target_id = ?, linked_kind = 'journal', linked_id = ?, decided_by = ?, decided_at = ?, revision = ? WHERE id = ? AND revision = ? AND status = 'review'",
      vendor, vendorKey(vendor), day, total, expense.id, facts.invoiceNumber, id, id, c.actor.email, now(), uid(), r.id, b.revision), changed(),
    audit(who(c.actor), 'journal.draft', 'journal', id, { receipt: r.id, before: null, after: { revision, date: day, memo, documentId: r.document_id, status: 'draft', lines } }),
    audit(who(c.actor), 'receipt.cash-draft', 'receipt', r.id, { journal: id, vendor, date: day, total, currency, accountId: expense.id, fundingAccountId: funding.id }),
  ])
  return entry(c.db, id)
} }

export const cashReceiptCommands: Record<string, Command> = { 'receipt.cash-draft': cashDraft }
