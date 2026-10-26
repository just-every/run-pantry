import { refundsView } from './refunds/store'
import { estimate } from './estimates/store'
import { customerDeposit } from './customer-deposits/store'
// Customer history is complete, unlike the capped sales screen. Its invoice
// balances come directly from receivables ageing for the same reporting date.
import { date, requireThat, text, type Data } from './core'
import { all, one } from './db'
import { customerContacts, customerRecipients } from './customer-profile'
import { businessDay, sendingSettings } from './delivery'
import { ageing } from './reports'
import { statementHistory } from './statements/store'

const scope = `WITH customer_invoices AS (SELECT * FROM pt_invoices WHERE customer_id = ?),
  customer_payments AS (SELECT * FROM pt_payments WHERE contact_id = ? AND direction = 'received'),
  customer_entries AS (SELECT journal_id AS id FROM customer_invoices UNION SELECT journal_id FROM customer_payments
    UNION SELECT reversal_id FROM customer_payments UNION SELECT void_reversal_id FROM customer_invoices) `

/** Call only through the native-session reader, as with the other private views. */
export async function customerHistory(db: D1Database, rawId: string, rawAsOf?: string, includeStatements = true) {
  const id = text(rawId, 'Customer')
  const customer = await one(db, "SELECT * FROM pt_contacts WHERE id = ? AND kind = 'customer'", id)
  requireThat(customer, 'Customer not found', 404)
  const asOf = date(rawAsOf ?? businessDay((await sendingSettings(db)).time_zone), 'As of')
  const read = (sql: string) => all(db, scope + sql, id, id)
  const [receivables, invoices, payments, allocations, deliveries, documents, certificates] = await Promise.all([
    ageing(db, 'receivable', asOf),
    read(`SELECT i.*, e.document_id AS entry_document_id FROM customer_invoices i LEFT JOIN pt_journal_entries e ON e.id = i.journal_id ORDER BY i.issue_date DESC, i.created_at DESC, i.id`),
    read(`SELECT p.*, b.name AS bank_name, e.document_id AS entry_document_id, r.entry_date AS reversal_date, r.document_id AS reversal_document_id FROM customer_payments p
      JOIN pt_bank_accounts b ON b.id = p.bank_account_id JOIN pt_journal_entries e ON e.id = p.journal_id LEFT JOIN pt_journal_entries r ON r.id = p.reversal_id
      ORDER BY p.payment_date DESC, p.created_at DESC, p.id`),
    read(`SELECT a.*, p.reversal_id, r.entry_date AS reversal_date, i.number AS invoice_number,
      COALESCE(p.reference, cr.number) AS source_reference
      FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id
      LEFT JOIN pt_journal_entries r ON r.id = p.reversal_id
      LEFT JOIN pt_invoices i ON a.target_kind = 'invoice' AND i.id = a.target_id
      LEFT JOIN pt_invoices cr ON a.source_kind = 'credit' AND cr.id = a.source_id
      WHERE (a.target_kind = 'invoice' AND a.target_id IN (SELECT id FROM customer_invoices)) OR
      (a.source_kind = 'payment' AND a.source_id IN (SELECT id FROM customer_payments)) OR
      (a.source_kind = 'credit' AND a.target_kind = 'invoice' AND a.source_id IN (SELECT id FROM customer_invoices))
      ORDER BY a.allocation_date, a.created_at, a.id`),
    read(`SELECT d.*, i.number FROM pt_deliveries d JOIN customer_invoices i ON i.id = d.invoice_id ORDER BY d.at DESC, d.id`),
    read(`SELECT id, name, media_type, size, sha256, linked_kind, linked_id, uploaded_at FROM pt_documents WHERE
      (linked_kind = 'invoice' AND linked_id IN (SELECT id FROM customer_invoices)) OR
      (linked_kind = 'payment' AND linked_id IN (SELECT id FROM customer_payments)) OR
      (linked_kind = 'journal' AND linked_id IN (SELECT id FROM customer_entries)) OR
      id IN (SELECT document_id FROM pt_journal_entries WHERE id IN (SELECT id FROM customer_entries))
      ORDER BY uploaded_at, id`),
    all(db, `SELECT e.*, d.name AS document_name, d.sha256 AS document_sha256, r.reminded_at, r.email_status, r.email_detail
      FROM pt_exemption_certificates e JOIN pt_documents d ON d.id = e.document_id
      LEFT JOIN pt_exemption_reminders r ON r.certificate_id = e.id WHERE e.customer_id = ? ORDER BY e.created_at DESC, e.id`, id),
  ])
  const refunds = await refundsView(db, id)
  const refundedAt = (kind: string, source: string) => refunds.filter(r => r.source_kind === kind && r.source_id === source && r.status === 'succeeded' && r.refund_date <= asOf).reduce((n,r) => n+r.amount_cents,0)
  const recordHref = (kind: string, recordId: string) => `/app/reports?record=${encodeURIComponent(`${kind}:${recordId}`)}`
  const documentHref = (documentId: string) => `/api/pantry/documents/${encodeURIComponent(documentId)}`
  const sum = (rows: Data[], key: string) => rows.reduce((n, r) => n + Number(r[key]), 0)
  for (const a of allocations) {
    a.included_in_balance = a.allocation_date <= asOf && (a.source_kind === 'credit' || !a.reversal_id || a.reversal_date > asOf) && (!a.voided_on || a.voided_on > asOf)
    a.source_href = recordHref(a.source_kind === 'credit' ? 'invoice' : 'payment', a.source_id)
    a.target_href = recordHref(a.target_kind, a.target_id)
  }
  for (const d of documents) d.href = documentHref(d.id)
  for (const d of deliveries) d.href = recordHref('invoice', d.invoice_id)
  const docsFor = (kind: string, record: Data) => documents.filter(d =>
    (d.linked_kind === kind && d.linked_id === record.id) ||
    d.id === record.entry_document_id || d.id === record.reversal_document_id ||
    (d.linked_kind === 'journal' && (d.linked_id === record.journal_id || d.linked_id === record.reversal_id)))
  const openItems = (receivables.items as Data[]).filter(i => i.contact_id === id)
  const openById = new Map(openItems.map(i => [i.id, i.open]))
  const rows: Data[] = invoices.map(i => {
    const issued = (i.status === 'issued' && (!i.void_date || i.void_date > asOf)) && i.issue_date <= asOf
    const applied = allocations.filter(a => i.kind === 'credit' ? a.source_kind === 'credit' && a.source_id === i.id : a.target_kind === 'invoice' && a.target_id === i.id)
    // A reversed early-payment discount credit (INVOICE-010) nets to nothing from its reversal date.
    const reversed = i.kind === 'credit' && applied.some(a => a.voided_on && a.voided_on <= asOf)
    const balance = !issued ? null : reversed ? 0 : i.kind === 'credit' ? i.total_cents - sum(applied.filter(a => a.included_in_balance), 'amount_cents') - refundedAt('credit', i.id) : openById.get(i.id) ?? 0
    return { kind: i.kind, id: i.id, date: i.issue_date, due_date: i.due_date, created_at: i.created_at, reference: i.number,
      href: recordHref('invoice', i.id), total_cents: i.total_cents, balance_cents: balance,
      balance_label: i.kind === 'credit' ? 'Unallocated' : 'Open', included_in_balance: issued,
      status: !issued ? i.void_date && i.void_date <= asOf ? 'Voided' : i.status === 'issued' ? 'After reporting date' : i.status : reversed ? 'Reversed' : balance === 0 ? i.kind === 'credit' ? 'Fully applied' : 'Paid' : i.kind === 'credit' ? 'Unallocated' : 'Open',
      void_date: i.void_date, void_reason: i.void_reason, reversal_href: i.void_reversal_id ? recordHref('entry', i.void_reversal_id) : null,
      memo: i.memo, credit_for: i.credit_for, credit_for_href: i.credit_for ? recordHref('invoice', i.credit_for) : null,
      allocations: applied, documents: docsFor('invoice', i), deliveries: deliveries.filter(d => d.invoice_id === i.id),
      exemption: i.exemption_evidence ? JSON.parse(i.exemption_evidence) : null }
  })
  for (const p of payments) {
    const active = p.payment_date <= asOf && (!p.reversal_id || p.reversal_date > asOf)
    const applied = allocations.filter(a => a.source_kind === 'payment' && a.source_id === p.id)
    const balance = active ? p.amount_cents - sum(applied.filter(a => a.included_in_balance), 'amount_cents') - refundedAt('payment', p.id) : null
    rows.push({ kind: 'payment', id: p.id, date: p.payment_date, created_at: p.created_at, reference: p.reference,
      href: recordHref('payment', p.id), total_cents: p.amount_cents, balance_cents: balance, balance_label: 'Unallocated',
      included_in_balance: active, status: p.payment_date > asOf ? 'After reporting date' : !active ? 'Reversed' : balance === 0 ? 'Fully applied' : 'Unallocated',
      memo: p.memo, method: p.method, bank_name: p.bank_name, allocations: applied, documents: docsFor('payment', p), deliveries: [],
      reversal_href: p.reversal_id ? recordHref('entry', p.reversal_id) : null })
  }
  const estimateRows: Data[] = await Promise.all((await all(db,'SELECT id FROM pt_estimates WHERE customer_id=? ORDER BY created_at,id',id)).map(async e=>{
    const est=await estimate(db,e.id)
    return {...est,kind:'estimate',date:est.issue_date,reference:est.number,href:`/app/sales?tab=estimates&estimate=${encodeURIComponent(est.id)}`,balance_cents:null,included_in_balance:false,allocations:[],documents:[]}
  }))
  for(const e of estimateRows) for(const d of e.deliveries) deliveries.push({...d,kind:'estimate',estimate_id:e.id,number:e.number,href:e.href})
  const depositRows=await Promise.all((await all(db,'SELECT id FROM pt_customer_deposits WHERE customer_id=? ORDER BY date,id',id)).map(async r=>{
    const dep=await customerDeposit(db,r.id)
    return {...dep,kind:'customer-deposit',reference:dep.reference,total_cents:dep.amount_cents,balance_cents:null,included_in_balance:false,status:'Held customer deposit',href:`/app/sales?tab=estimates&deposit=${encodeURIComponent(dep.id)}`,allocations:[],documents:[],deliveries:[]}
  }))
  rows.push(...estimateRows,...depositRows, ...refunds.map(r => ({...r, kind:'refund',date:r.refund_date,reference:'Customer refund',total_cents:r.amount_cents,balance_cents:null,included_in_balance:false,href:r.journal_id?recordHref('entry',r.journal_id):`/app/sales?tab=payments`,allocations:[],documents:[],deliveries:[]})))
  const statements = includeStatements ? await statementHistory(db, id) : []
  for (const s of statements) for (const d of s.deliveries) deliveries.push({ ...d, number: s.subject })
  rows.sort((a, b) => b.date.localeCompare(a.date) || b.created_at.localeCompare(a.created_at) || `${a.kind}:${a.id}`.localeCompare(`${b.kind}:${b.id}`))
  const open = sum(openItems, 'open')
  const unallocatedPayment = sum(rows.filter(r => r.kind === 'payment' && r.included_in_balance), 'balance_cents')
  const unallocatedCredit = sum(rows.filter(r => r.kind === 'credit' && r.included_in_balance), 'balance_cents')
  return { customer: { ...customer, contacts: customerContacts(customer), pay_methods: customer.pay_methods === null ? null : JSON.parse(customer.pay_methods), default_recipients: customerRecipients(customer) },
    asOf, rows, deliveries, certificates: certificates.map(c => ({ ...c, states: JSON.parse(c.states),
      href: documentHref(c.document_id), status: !c.active ? 'Replaced or retired' : c.valid_from > asOf ? 'Not yet valid' : c.expires_on < asOf ? 'Expired' : 'Valid' })),
    summary: { open_invoice_cents: open, unallocated_payment_cents: unallocatedPayment, unallocated_credit_cents: unallocatedCredit,
      open_balance_cents: open - unallocatedPayment - unallocatedCredit,
      ageing_href: `/app/reports?report=receivables&to=${asOf}`, ageing_items: openItems,
      ageing_totals: receivables.buckets.map(bucket => sum(openItems.filter(i => i.bucket === bucket), 'open')) },
    sections: { estimates: { available: true, rows: estimateRows }, statements: { available: includeStatements, rows: statements } } }
}

export type CustomerHistoryData = Awaited<ReturnType<typeof customerHistory>>
