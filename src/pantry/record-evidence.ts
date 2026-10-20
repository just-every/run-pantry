// Retained authority and provider evidence for a transaction. Provider
// configuration/credentials never enter this read model.
import { all } from './db'
import type { Data } from './core'

export async function recordEvidence(db: D1Database, record: Data) {
  const subjects = [{ kind: record.kind === 'entry' ? 'journal' : record.kind, id: record.id }, ...record.entries.map((e: Data) => ({ kind: 'journal', id: e.id }))]
  if (record.kind === 'invoice' && record.sourceKind === 'credit') subjects.push({ kind: 'credit', id: record.id })
  // Vendor credits open through their native journal entry.
  if (record.kind === 'entry') for (const c of await all(db, 'SELECT id FROM pt_vendor_credits WHERE journal_id = ?', record.id)) subjects.push({ kind: 'vendor-credit', id: c.id })
  const nativeKind = record.kind === 'entry' ? 'journal' : record.kind
  const captures = await all(db, `SELECT d.id, d.kind, d.receipt_id FROM pt_capture_drafts d JOIN pt_receipts r ON r.id = d.receipt_id WHERE d.bill_id = ? OR (r.linked_kind = ? AND r.linked_id = ?)`, record.kind === 'bill' ? record.id : '', nativeKind, record.id)
  for (const d of captures) subjects.push({ kind: 'capture-draft', id: d.id }, { kind: d.kind, id: record.kind === 'bill' ? record.id : d.id }, { kind: 'receipt', id: d.receipt_id })
  const entries = record.entries.map((e: Data) => e.id) as string[]
  const list = entries.map(() => '?').join(',') || 'NULL'
  const [checkout, clearing, payouts, payroll, feed] = await Promise.all([
    all(db, `SELECT id, invoice_id, method, amount_cents, status, payment_intent, payment_id, fee_cents, fee_entry_id, created_at, updated_at FROM pt_stripe_payments WHERE invoice_id = ? OR payment_id = ? OR fee_entry_id IN (${list})`, record.kind === 'invoice' ? record.id : '', record.kind === 'payment' ? record.id : '', ...entries),
    all(db, `SELECT id, type, event_date, currency, amount_cents, net_cents, fee_cents, payment_intent, source_id, payout_id, status, reason, entry_id, fee_entry_id FROM pt_stripe_clearing_items WHERE entry_id IN (${list}) OR fee_entry_id IN (${list})`, ...entries, ...entries),
    all(db, `SELECT id, arrival_date, currency, amount_cents, gross_cents, fee_cents, refund_cents, status, reason, entry_id FROM pt_stripe_payouts WHERE entry_id IN (${list})`, ...entries),
    all(db, `SELECT uuid, check_date, period_start, period_end, gross_cents, employer_tax_cents, withheld_cents, net_cents, debit_cents, status, reason, entry_id FROM pt_gusto_payrolls WHERE entry_id IN (${list})`, ...entries),
    all(db, `SELECT DISTINCT b.feed_txn_id, b.posted_date, b.amount_cents, b.description, b.feed_snapshot, b.arrived_at FROM pt_bank_lines b JOIN pt_match_bank_lines mb ON mb.bank_line_id = b.id AND mb.active = 1 JOIN pt_match_postings mp ON mp.match_id = mb.match_id AND mp.active = 1 JOIN pt_journal_lines l ON l.id = mp.journal_line_id WHERE l.entry_id IN (${list}) AND b.feed_txn_id IS NOT NULL`, ...entries),
  ])
  const providerEvents = [
    ...checkout.map(e => ({ provider: 'Stripe', kind: 'checkout', id: e.id, evidence: e })),
    ...clearing.map(e => ({ provider: 'Stripe', kind: 'balance-transaction', id: e.id, evidence: e })),
    ...payouts.map(e => ({ provider: 'Stripe', kind: 'payout', id: e.id, evidence: e })),
    ...payroll.map(e => ({ provider: 'Gusto', kind: 'payroll', id: e.uuid, evidence: e })),
    ...feed.map(e => ({ provider: 'Plaid', kind: 'transaction', id: e.feed_txn_id, evidence: e })),
  ]
  for (const event of checkout) subjects.push({ kind: 'invoice', id: event.invoice_id })
  for (const event of clearing) subjects.push({ kind: 'stripe-item', id: event.id })
  for (const event of payouts) subjects.push({ kind: 'stripe-payout', id: event.id })
  for (const event of payroll) subjects.push({ kind: 'gusto-payroll', id: event.uuid })
  const unique = [...new Map(subjects.map(s => [`${s.kind}:${s.id}`, s])).values()]
  const where = unique.map(() => '(subject_kind = ? AND subject_id = ?)').join(' OR '), params = unique.flatMap(s => [s.kind, s.id])
  const audit = await all(db, `SELECT * FROM pt_audit WHERE ${where} ORDER BY at, rowid`, ...params)
  const relied = [...new Set(audit.map(a => a.approval_id).filter(Boolean))]
  const approvals = await all(db, `SELECT * FROM pt_approvals WHERE ${where}${relied.length ? ` OR id IN (${relied.map(() => '?').join(',')})` : ''} ORDER BY at, rowid`, ...params, ...relied)
  return { audit: audit.map(a => ({ ...a, approval: approvals.find(p => p.id === a.approval_id) ?? null })), approvals, providerEvents }
}
