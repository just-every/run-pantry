import { dimensionTags } from '../dimensions'
// Accepted source facts become editable drafts, never automatic postings.
import { addDays, cents, date, list, optionalText, requireThat, text, type Data } from '../core'
import { all, one } from '../db'

export async function documentDraftProposal(db: D1Database, r: Data) {
  const read = r.read_draft_fields ? JSON.parse(r.read_draft_fields) : null
  const accounts = await all(db, "SELECT id, code FROM pt_accounts WHERE active = 1 AND type = 'expense'")
  const total = r.total_cents ?? r.read_total_cents, tax = r.tax_cents ?? r.read_tax_cents ?? 0
  const day = r.receipt_date ?? r.read_date, termsDays = read?.termsDays ?? r.vendor_terms_days ?? 30
  const lines = read?.lines?.length ? read.lines.map((l: Data) => ({ ...dimensionTags({...r,...l,className:l.className??r.class_name??r.vendor_class}),description: l.description, amount: l.amount, accountId: accounts.find(a => a.code === l.accountCode)?.id ?? r.account_id ?? r.read_account_id }))
    : [{ ...dimensionTags({...r,className:r.class_name||r.vendor_class}),description: r.vendor ?? r.read_vendor ?? 'Document purchase', amount: total ? total - tax : null, accountId: r.account_id ?? r.read_account_id }]
  const saved = await one(db, 'SELECT * FROM pt_capture_drafts WHERE receipt_id = ?', r.id)
  return { kind: read?.kind ?? 'bill', date: day, total, tax, invoiceNumber: r.invoice_number ?? r.read_invoice_number ?? '',
    termsDays, dueDate: read?.dueDate ?? (day ? addDays(day, termsDays) : null), className: r.vendor_class ?? '', is1099: !!r.vendor_is_1099, lines,
    saved: saved ? { ...saved, payload: JSON.parse(saved.payload) } : null }
}
export async function acceptedDraft(db: D1Database, r: Data, b: Data) {
  const proposal = await documentDraftProposal(db, r)
  requireThat(r.vendor_id && r.vendor_confirmed_by, 'Confirm the vendor identity before drafting')
  const kind = b.kind ?? proposal.kind
  requireThat(kind === 'bill' || kind === 'expense', 'Draft a bill or an expense')
  const day = date(b.date ?? proposal.date, 'Document date')
  const total = b.total !== undefined ? cents(b.total, 'Document total') : proposal.total
  requireThat(total, 'Confirm the document total')
  const tax = b.tax !== undefined ? cents(b.tax || '0', 'Tax', { zero: true }) : proposal.tax
  const termsDays = b.termsDays !== undefined ? Number(b.termsDays) : proposal.termsDays
  requireThat(Number.isInteger(termsDays) && termsDays >= 0 && termsDays <= 365, 'Payment terms are 0–365 days')
  const dueDate = b.dueDate ? date(b.dueDate, 'Due date') : addDays(day, termsDays)
  requireThat(dueDate >= day, 'Due date is on or after the bill date')
  const lines = list<Data>(b.lines, 'Document lines', 100).map((l, i) => ({ ...dimensionTags({...l,className:l.className??b.className??proposal.className}),description: text(l.description, `Line ${i + 1} description`, 500), accountId: text(l.accountId, `Line ${i + 1} account`), amount: cents(l.amount, `Line ${i + 1} amount`) }))
  requireThat(lines.reduce((n, l) => n + l.amount, 0) + tax === total, 'Lines plus tax must equal the accepted document total')
  for (const l of lines) requireThat(await one(db, "SELECT 1 FROM pt_accounts WHERE id = ? AND active = 1 AND type IN ('expense', 'asset') AND subtype NOT IN ('bank', 'receivable', 'payable')", l.accountId), 'Choose active expense or asset accounts')
  return { kind, date: day, total, tax, termsDays, dueDate, lines, vendorId: r.vendor_id, vendor: r.vendor, className: optionalText(b.className ?? proposal.className, 'Class', 100), is1099: proposal.is1099,
    reference: kind === 'bill' ? text(b.invoiceNumber ?? proposal.invoiceNumber, 'Vendor invoice number', 80) : optionalText(b.invoiceNumber ?? proposal.invoiceNumber, 'Receipt number', 80), bankLineId: kind === 'expense' ? text(b.bankLineId, 'Paid charge') : null }
}
