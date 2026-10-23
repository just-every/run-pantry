// Complete vendor read model. Do not reuse the capped sales lists for balances.
import { date, requireThat, text, type Data } from './core'
import { all, one } from './db'
import { contactTotals } from './contact-totals'

const scope = `WITH vendor_bills AS (SELECT * FROM pt_bills WHERE vendor_id = ?),
  vendor_payments AS (SELECT * FROM pt_payments WHERE contact_id = ? AND direction = 'paid'),
  vendor_credits AS (SELECT * FROM pt_vendor_credits WHERE vendor_id = ?),
  vendor_drafts AS (SELECT * FROM pt_capture_drafts WHERE json_extract(payload, '$.vendorId') = ?),
  vendor_entries AS (
    SELECT journal_id AS id FROM vendor_bills UNION SELECT journal_id FROM vendor_payments
    UNION SELECT journal_id FROM vendor_credits UNION
    SELECT r.linked_id FROM vendor_drafts d JOIN pt_receipts r ON r.id = d.receipt_id WHERE r.linked_kind = 'journal'
  ), history_entries AS (
    SELECT id FROM vendor_entries UNION SELECT reversed_by_id FROM pt_journal_entries WHERE id IN (SELECT id FROM vendor_entries)
  ) `

/** Call behind the native-session read capability, like the other screen views. */
export async function vendorHistory(db: D1Database, rawId: string, from?: string, to?: string) {
  const id = text(rawId, 'Vendor')
  const vendor = await one(db, "SELECT c.id, c.name, c.active, c.terms_days, c.default_class, c.default_account_id, c.is_1099, c.vendor_tax_box, c.provider_payment_method, c.payment_provider, c.email, c.phone, c.contacts_json, a.code AS account_code, a.name AS account_name FROM pt_contacts c LEFT JOIN pt_accounts a ON a.id=c.default_account_id WHERE c.id = ? AND c.kind = 'vendor'", id)
  requireThat(vendor, 'Vendor not found', 404)
  const start = date(from ?? `${new Date().getUTCFullYear()}-01-01`, 'From'), end = date(to ?? `${new Date().getUTCFullYear()}-12-31`, 'To')
  requireThat(start <= end, 'From must be on or before To')
  const expenses = await contactTotals(db, 'vendor', start, end, 'accrual')
  const tax = await one(db, 'SELECT tin, tin_kind, backup_withholding FROM pt_contractor_tax WHERE contact_id=?', id)
  const read = (sql: string) => all(db, scope + sql, id, id, id, id)
  const [bills, payments, credits, drafts, billLines, journalLines, documents, allocations, activity] = await Promise.all([
    read(`SELECT b.*, e.status AS entry_status, e.reversed_by_id, e.document_id AS entry_document_id FROM vendor_bills b LEFT JOIN pt_journal_entries e ON e.id = b.journal_id`),
    read(`SELECT p.*, e.status AS entry_status, e.reversed_by_id, e.document_id AS entry_document_id, b.name AS bank_name FROM vendor_payments p
      JOIN pt_journal_entries e ON e.id = p.journal_id JOIN pt_bank_accounts b ON b.id = p.bank_account_id`),
    read(`SELECT v.*, e.status AS entry_status, e.reversed_by_id, e.document_id AS entry_document_id FROM vendor_credits v JOIN pt_journal_entries e ON e.id = v.journal_id`),
    read(`SELECT d.*, r.status AS receipt_status, r.vendor_id AS receipt_vendor_id, r.linked_kind, r.linked_id,
      r.document_id, r.file_document_id, e.status AS entry_status, e.reversed_by_id, e.document_id AS entry_document_id
      FROM vendor_drafts d JOIN pt_receipts r ON r.id = d.receipt_id
      LEFT JOIN pt_journal_entries e ON r.linked_kind = 'journal' AND e.id = r.linked_id`),
    read(`SELECT l.*, a.code AS account_code, a.name AS account_name FROM pt_bill_lines l
      JOIN pt_accounts a ON a.id = l.account_id WHERE bill_id IN (SELECT id FROM vendor_bills) ORDER BY bill_id, line_no`),
    read(`SELECT l.*, a.code AS account_code, a.name AS account_name FROM pt_journal_lines l
      JOIN pt_accounts a ON a.id = l.account_id WHERE entry_id IN (SELECT id FROM history_entries) ORDER BY entry_id, line_no`),
    read(`SELECT id, name, media_type, sha256, linked_kind, linked_id FROM pt_documents WHERE
      (linked_kind = 'bill' AND linked_id IN (SELECT id FROM vendor_bills)) OR
      (linked_kind = 'payment' AND linked_id IN (SELECT id FROM vendor_payments)) OR
      (linked_kind = 'journal' AND linked_id IN (SELECT id FROM history_entries)) OR
      id IN (SELECT document_id FROM pt_journal_entries WHERE id IN (SELECT id FROM history_entries)) OR
      id IN (SELECT r.document_id FROM pt_receipts r JOIN vendor_drafts d ON d.receipt_id = r.id) OR
      id IN (SELECT r.file_document_id FROM pt_receipts r JOIN vendor_drafts d ON d.receipt_id = r.id)
      ORDER BY uploaded_at, id`),
    read(`SELECT a.*, b.reference AS bill_reference, b.status AS bill_status, b.opening AS bill_opening,
      be.status AS bill_entry_status, be.reversed_by_id AS bill_reversed_by_id,
      COALESCE(p.reference, v.reference) AS source_reference, COALESCE(p.journal_id, v.journal_id) AS source_journal_id,
      p.reversal_id, se.status AS source_entry_status, se.reversed_by_id AS source_reversed_by_id
      FROM pt_allocations a JOIN pt_bills b ON a.target_kind = 'bill' AND b.id = a.target_id
      LEFT JOIN pt_journal_entries be ON be.id = b.journal_id
      LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      LEFT JOIN pt_vendor_credits v ON a.source_kind = 'credit' AND v.id = a.source_id
      LEFT JOIN pt_journal_entries se ON se.id = COALESCE(p.journal_id, v.journal_id)
      WHERE b.id IN (SELECT id FROM vendor_bills) OR p.id IN (SELECT id FROM vendor_payments) OR v.id IN (SELECT id FROM vendor_credits)
      ORDER BY a.allocation_date, a.created_at, a.id`),
    read(`SELECT id, at, actor_email, action, subject_kind, subject_id, subject_revision FROM pt_audit WHERE
      (subject_kind = 'bill' AND subject_id IN (SELECT id FROM vendor_bills)) OR
      (subject_kind = 'payment' AND subject_id IN (SELECT id FROM vendor_payments)) OR
      (subject_kind = 'vendor-credit' AND subject_id IN (SELECT id FROM vendor_credits)) OR
      (subject_kind = 'capture-draft' AND subject_id IN (SELECT id FROM vendor_drafts)) OR
      (subject_kind = 'journal' AND subject_id IN (SELECT id FROM history_entries)) ORDER BY at, id`),
  ])
  const posted = (r: Data) => r.entry_status === 'posted' && !r.reversed_by_id
  const billActive = (r: Data) => r.status !== 'void' && !r.reversed_by_id && (r.opening || (r.status === 'posted' && posted(r)))
  const amount = (rows: Data[], key: string) => rows.reduce((n, r) => n + Number(r[key]), 0)
  for (const a of allocations) {
    a.included_in_balance = a.source_entry_status === 'posted' && !a.source_reversed_by_id && !a.reversal_id &&
      a.bill_status !== 'void' && !a.bill_reversed_by_id && (a.bill_opening || (a.bill_status === 'posted' && a.bill_entry_status === 'posted'))
    a.exclusion_reason = a.included_in_balance ? '' : a.reversal_id || a.source_reversed_by_id ? 'Source was reversed' : a.bill_status === 'void' || a.bill_reversed_by_id ? 'Bill was voided or reversed' : 'Source or bill is not posted'
  }
  const docsFor = (kind: string, recordId: string, journalId?: string | null, sourceIds: string[] = []) => documents.filter(d =>
    (d.linked_kind === kind && d.linked_id === recordId) || (journalId && d.linked_kind === 'journal' && d.linked_id === journalId) || sourceIds.includes(d.id))
  const eventsFor = (kind: string, recordId: string, journalId?: string | null) => activity.filter(a =>
    (a.subject_kind === kind && a.subject_id === recordId) || (journalId && a.subject_kind === 'journal' && a.subject_id === journalId))
  const codingFor = (journalId: string) => journalLines.filter(l => l.entry_id === journalId)
  const recordHref = (kind: string, recordId: string) => `/app/reports?record=${encodeURIComponent(`${kind}:${recordId}`)}`
  const rows: Data[] = []
  for (const b of bills) {
    const active = !!billActive(b), applied = allocations.filter(a => a.target_id === b.id)
    const open = active ? b.total_cents - amount(applied.filter(a => a.included_in_balance), 'amount_cents') : null
    const captured = drafts.find(d => d.bill_id === b.id)
    rows.push({ kind: 'bill', id: b.id, date: b.bill_date, due_date: b.due_date, created_at: b.created_at,
      reference: b.reference, href: recordHref('bill', b.id), total_cents: b.total_cents, balance_cents: open,
      balance_label: 'Open', included_in_balance: active, status: b.status === 'void' ? 'Void' : b.reversed_by_id ? 'Reversed' : active ? open === 0 ? 'Settled' : 'To pay' : 'Draft',
      status_reason: active ? b.opening ? 'Opening bill moved into these books' : 'Posted bill, less current payment and credit allocations' : b.status === 'void' || b.reversed_by_id ? 'Excluded from current balances' : 'Not posted to payables',
      memo: b.memo, evidence_waived: b.evidence_waived, coding: billLines.filter(l => l.bill_id === b.id), allocations: applied,
      documents: docsFor('bill', b.id, b.journal_id, [b.entry_document_id].filter(Boolean)), activity: eventsFor('bill', b.id, b.journal_id),
      capture_href: captured ? `/app/receipts#receipt-${captured.receipt_id}` : null,
      reversal_href: b.reversed_by_id ? recordHref('entry', b.reversed_by_id) : null })
  }
  for (const [kind, records] of [['payment', payments], ['vendor-credit', credits]] as const) for (const r of records) {
    const active = posted(r) && !r.reversal_id
    const applied = allocations.filter(a => a.source_kind === (kind === 'payment' ? 'payment' : 'credit') && a.source_id === r.id)
    const remaining = active ? r.amount_cents - amount(applied.filter(a => a.included_in_balance), 'amount_cents') : null
    rows.push({ kind, id: r.id, date: r.payment_date ?? r.credit_date, created_at: r.created_at, reference: r.reference,
      href: recordHref(kind === 'payment' ? 'payment' : 'entry', kind === 'payment' ? r.id : r.journal_id),
      total_cents: r.amount_cents, balance_cents: remaining, balance_label: 'Unallocated', included_in_balance: active,
      status: !active ? r.reversal_id || r.reversed_by_id ? 'Reversed' : 'Not posted' : remaining === 0 ? 'Fully applied' : 'Unallocated',
      status_reason: active ? 'Posted amount less allocations to current bills' : 'Excluded from current balances',
      memo: r.memo, method: r.method, card_last4: r.card_last4, bank_name: r.bank_name,
      coding: codingFor(r.journal_id), allocations: applied, documents: docsFor(kind === 'payment' ? 'payment' : 'journal', kind === 'payment' ? r.id : r.journal_id, r.journal_id, [r.entry_document_id].filter(Boolean)),
      activity: eventsFor(kind, r.id, r.journal_id), reversal_href: r.reversal_id || r.reversed_by_id ? recordHref('entry', r.reversal_id ?? r.reversed_by_id) : null })
  }
  for (const d of drafts) {
    const p = JSON.parse(d.payload), b = bills.find(b => b.id === d.bill_id)
    const dismissed = d.receipt_status === 'dismissed', stale = dismissed || d.receipt_vendor_id !== p.vendorId
    const reversed = d.kind === 'bill' ? b?.status === 'void' || !!b?.reversed_by_id : !!d.reversed_by_id
    const approved = d.status === 'approved' && d.approved_revision === d.revision
    const pending = d.status !== 'posted' && !stale && !reversed
    rows.push({ kind: 'captured-draft', draft_kind: d.kind, id: d.id, date: p.date, due_date: d.kind === 'bill' ? p.dueDate : null,
      created_at: d.created_at, updated_at: d.updated_at, reference: p.reference, total_cents: p.total,
      balance_cents: null, balance_label: '', included_in_balance: false, pending,
      posted_expense: d.kind === 'expense' && d.status === 'posted' && posted(d),
      href: `/app/receipts#receipt-${d.receipt_id}`, record_href: d.bill_id ? recordHref('bill', d.bill_id) : d.linked_kind === 'journal' && d.linked_id ? recordHref('entry', d.linked_id) : null,
      status: dismissed ? 'Dismissed' : stale ? 'Needs review' : reversed ? 'Reversed' : d.status === 'posted' ? 'Posted' : approved ? 'Approved' : d.submitted_revision === d.revision ? 'Awaiting approval' : 'Draft',
      status_reason: dismissed ? 'Source receipt was dismissed; excluded from pending drafts' : stale ? 'Vendor identity changed; review the source' : reversed ? 'Posted record was voided or reversed' : d.status === 'posted' ? d.kind === 'bill' ? 'Counted through the linked bill; not counted twice' : 'Paid expense posted directly to the ledger' : approved ? 'This exact revision is approved; waiting to post' : 'Unposted draft; excluded from payables',
      class_name: p.className, tax_cents: p.tax, prepared_by: d.prepared_by, approved_by: approved || d.status === 'posted' ? d.approved_by : null,
      coding: p.lines.map((l: Data) => ({ account_id: l.accountId, description: l.description, amount_cents: l.amount })),
      allocations: [], documents: docsFor('bill', d.bill_id, d.linked_kind === 'journal' ? d.linked_id : null, [d.document_id, d.file_document_id, d.entry_document_id].filter(Boolean)),
      activity: eventsFor('capture-draft', d.id) })
  }
  rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(b.created_at).localeCompare(String(a.created_at)) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  const currentBills = rows.filter(r => r.kind === 'bill' && r.included_in_balance)
  const currentPayments = rows.filter(r => r.kind === 'payment' && r.included_in_balance)
  const currentCredits = rows.filter(r => r.kind === 'vendor-credit' && r.included_in_balance)
  const open = amount(currentBills, 'balance_cents'), unappliedPayments = amount(currentPayments, 'balance_cents'), unappliedCredits = amount(currentCredits, 'balance_cents')
  const inPeriod = (r: Data) => r.date >= start && r.date <= end
  const periodBills = currentBills.filter(inPeriod), periodCredits = currentCredits.filter(inPeriod), periodPayments = currentPayments.filter(inPeriod)
  const captured = rows.filter(r => r.posted_expense && inPeriod(r))
  return { vendor: { ...vendor, contacts: JSON.parse(vendor.contacts_json), tin: tax?.tin ? `•••••${tax.tin.slice(-4)}` : null, backup_withholding: !!tax?.backup_withholding } as Data, rows,
    spend: { from: start, to: end, expense_cents: expenses.rows.find(r => r.id === id)?.amount ?? 0, billed_cents: amount(periodBills, 'total_cents'), credited_cents: amount(periodCredits, 'total_cents'), paid_cents: amount(periodPayments, 'total_cents'), captured_expense_cents: amount(captured, 'total_cents'),
      net_purchases_cents: amount(periodBills, 'total_cents') - amount(periodCredits, 'total_cents') + amount(captured, 'total_cents') }, summary: {
    billed_cents: amount(currentBills, 'total_cents'), paid_cents: amount(currentPayments, 'total_cents'), credited_cents: amount(currentCredits, 'total_cents'),
    open_bill_cents: open, unallocated_payment_cents: unappliedPayments, unallocated_credit_cents: unappliedCredits,
    net_payable_cents: open - unappliedPayments - unappliedCredits,
    pending_draft_cents: amount(rows.filter(r => r.pending), 'total_cents'), pending_draft_count: rows.filter(r => r.pending).length,
    posted_captured_expense_cents: amount(rows.filter(r => r.posted_expense), 'total_cents'),
  } }
}

export type VendorHistoryData = Awaited<ReturnType<typeof vendorHistory>>
