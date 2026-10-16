// Cash or accrual: one ledger, two ways of reading it. The books are always
// accrual; the cash basis is calculated from them and never written back.
//
// On the cash basis an invoice, credit or bill counts only as it is settled.
// Its journal entry (and any reversal of it) is set aside, and each settlement
// (a payment allocated to it, a credit applied to it, or a payment reversed)
// recognises that share of every line of the document, tax included, on the
// settlement's date. Shares are spread by largest remainder on the cumulative
// amount settled, so a fully paid document recognises exactly its lines and
// every settlement is a balanced set of lines. Every other entry (payments,
// bank items, journals, opening balances) reads the same on both bases.
import { requireThat } from './core'
import { all } from './db'

export type Basis = 'accrual' | 'cash'
export const BASIS_LABEL: Record<Basis, string> = { accrual: 'Accrual basis', cash: 'Cash basis' }

export function basisOf(value: unknown): Basis {
  if (value === undefined || value === null || value === '') return 'accrual'
  requireThat(value === 'cash' || value === 'accrual', 'Basis is cash or accrual')
  return value
}

const DOCUMENT_KINDS = "('invoice', 'credit', 'bill')"
/** SQL condition: entry `e` reads the same on the cash basis (it is not a document's own entry or its reversal). */
export const sameOnCash = (e = 'e') => `NOT (${e}.source_kind IN ${DOCUMENT_KINDS} OR (${e}.source_kind = 'reversal' AND EXISTS (SELECT 1 FROM pt_journal_entries o WHERE o.id = ${e}.reverses_id AND o.source_kind IN ${DOCUMENT_KINDS})))`

export type Settlement = {
  kind: 'payment' | 'payment-reversed' | 'credit' | 'credit-applied'
  date: string; amount: number
  paymentId: string | null; paymentReference: string; paymentJournalId: string | null; reversalJournalId: string | null
  creditId: string | null; creditNumber: string | null; appliedToId: string | null; appliedToNumber: string | null
}

/** One recognised share of a document line on the cash basis. `net` is debit-positive cents. */
export type CashLine = {
  accountId: string; date: string; net: number
  docKind: 'invoice' | 'credit' | 'bill'; docId: string; docRef: string; docJournalId: string; docTotal: number
  contactId: string; contactName: string
  role: 'control' | 'sale' | 'tax' | 'expense'; description: string; taxCode: string | null
  settledBefore: number; settledAfter: number
  settlement: Settlement
}

type Component = { accountId: string; sign: 1 | -1; magnitude: number; role: CashLine['role']; description: string; taxCode: string | null }
type Doc = { kind: CashLine['docKind']; id: string; ref: string; journalId: string; total: number; contactId: string; contactName: string; control: Component; parts: Component[] }
type Event = { docId: string; date: string; order: string; delta: number; settlement: Settlement }

/** The shares of `settled` (0..total) across parts, by largest remainder; they sum to exactly `settled`. */
function spread(parts: Component[], total: number, settled: number): number[] {
  const t = BigInt(total), s = BigInt(settled)
  const exact = parts.map(p => BigInt(p.magnitude) * s)
  const base = exact.map(x => x / t)
  let left = settled - base.reduce((a, b) => a + Number(b), 0)
  const order = exact.map((x, i) => ({ i, rem: x % t })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
  const out = base.map(Number)
  for (const { i } of order) { if (left <= 0) break; out[i] += 1; left -= 1 }
  return out
}

async function documents(db: D1Database): Promise<Map<string, Doc>> {
  const docs = new Map<string, Doc>()
  const control = new Map((await all(db, "SELECT subtype, id FROM pt_accounts WHERE subtype IN ('receivable', 'payable')")).map(a => [a.subtype, a.id]))
  // Only documents something has settled matter on the cash basis.
  const invoices = await all(db, `SELECT i.id, i.kind, i.number, i.total_cents, i.journal_id, i.customer_id, c.name AS contact_name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id
    WHERE i.journal_id IS NOT NULL AND (i.id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'invoice') OR i.id IN (SELECT source_id FROM pt_allocations WHERE source_kind = 'credit'))`)
  const invoiceLines = await all(db, `SELECT l.invoice_id, l.description, l.amount_cents, l.tax_cents, l.tax_code, l.account_id, t.account_id AS tax_account FROM pt_invoice_lines l LEFT JOIN pt_tax_codes t ON t.id = l.tax_code
    WHERE l.invoice_id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'invoice' UNION SELECT source_id FROM pt_allocations WHERE source_kind = 'credit') ORDER BY l.invoice_id, l.line_no`)
  for (const i of invoices) {
    // An invoice debits receivables and credits income and tax; a credit note the reverse.
    const s: 1 | -1 = i.kind === 'invoice' ? 1 : -1
    const parts: Component[] = []
    for (const l of invoiceLines.filter(x => x.invoice_id === i.id)) {
      parts.push({ accountId: l.account_id, sign: (-s) as 1 | -1, magnitude: l.amount_cents, role: 'sale', description: l.description, taxCode: l.tax_code })
      if (l.tax_cents) parts.push({ accountId: l.tax_account, sign: (-s) as 1 | -1, magnitude: l.tax_cents, role: 'tax', description: `Sales tax · ${l.description}`, taxCode: l.tax_code })
    }
    docs.set(i.id, { kind: i.kind, id: i.id, ref: i.number, journalId: i.journal_id, total: i.total_cents, contactId: i.customer_id, contactName: i.contact_name,
      control: { accountId: control.get('receivable')!, sign: s, magnitude: i.total_cents, role: 'control', description: `${i.number} ${i.contact_name}`, taxCode: null }, parts })
  }
  const bills = await all(db, `SELECT b.id, b.reference, b.total_cents, b.journal_id, b.vendor_id, c.name AS contact_name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE b.journal_id IS NOT NULL AND b.id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'bill')`)
  const billLines = await all(db, "SELECT bill_id, description, amount_cents, account_id FROM pt_bill_lines WHERE bill_id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'bill') ORDER BY bill_id, line_no")
  for (const b of bills) docs.set(b.id, { kind: 'bill', id: b.id, ref: b.reference, journalId: b.journal_id, total: b.total_cents, contactId: b.vendor_id, contactName: b.contact_name,
    control: { accountId: control.get('payable')!, sign: -1, magnitude: b.total_cents, role: 'control', description: `${b.contact_name} ${b.reference}`, taxCode: null },
    parts: billLines.filter(l => l.bill_id === b.id).map(l => ({ accountId: l.account_id, sign: 1, magnitude: l.amount_cents, role: 'expense', description: l.description, taxCode: null })) })
  return docs
}

async function events(db: D1Database, docs: Map<string, Doc>): Promise<Event[]> {
  const rows = await all(db, `SELECT a.*, p.reference AS payment_reference, p.journal_id AS payment_journal, p.reversal_id, r.entry_date AS reversal_date, cr.number AS credit_number, ti.number AS target_number
    FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id LEFT JOIN pt_journal_entries r ON r.id = p.reversal_id
    LEFT JOIN pt_invoices cr ON a.source_kind = 'credit' AND cr.id = a.source_id LEFT JOIN pt_invoices ti ON a.target_kind = 'invoice' AND ti.id = a.target_id
    ORDER BY a.allocation_date, a.created_at, a.id`)
  const out: Event[] = []
  for (const a of rows) {
    const base = { paymentId: a.source_kind === 'payment' ? a.source_id : null, paymentReference: a.payment_reference ?? '', paymentJournalId: a.payment_journal ?? null, reversalJournalId: null,
      creditId: a.source_kind === 'credit' ? a.source_id : null, creditNumber: a.credit_number ?? null, appliedToId: a.target_id, appliedToNumber: a.target_number ?? null }
    const order = `${a.created_at}|${a.id}`
    if (docs.has(a.target_id)) {
      out.push({ docId: a.target_id, date: a.allocation_date, order, delta: a.amount_cents, settlement: { ...base, kind: a.source_kind === 'credit' ? 'credit' : 'payment', date: a.allocation_date, amount: a.amount_cents } })
      // Money that went back (a reversed payment) un-recognises the same share on the reversal's date.
      if (a.reversal_id) out.push({ docId: a.target_id, date: a.reversal_date, order: `~${order}`, delta: -a.amount_cents, settlement: { ...base, kind: 'payment-reversed', date: a.reversal_date, amount: -a.amount_cents, reversalJournalId: a.reversal_id } })
    }
    if (a.source_kind === 'credit' && docs.has(a.source_id))
      out.push({ docId: a.source_id, date: a.allocation_date, order, delta: a.amount_cents, settlement: { ...base, kind: 'credit-applied', date: a.allocation_date, amount: a.amount_cents } })
  }
  return out.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.order < y.order ? -1 : x.order > y.order ? 1 : 0)
}

/** Every recognised share on the cash basis dated from..to (inclusive). */
export async function cashLines(db: D1Database, from: string, to: string): Promise<CashLine[]> {
  const docs = await documents(db)
  const settled = new Map<string, number>(), out: CashLine[] = []
  for (const e of await events(db, docs)) {
    const d = docs.get(e.docId)!
    const before = settled.get(d.id) ?? 0, after = before + e.delta
    settled.set(d.id, after)
    if (e.date < from || e.date > to) continue
    const was = spread(d.parts, d.total, before), now = spread(d.parts, d.total, after)
    const common = { date: e.date, docKind: d.kind, docId: d.id, docRef: d.ref, docJournalId: d.journalId, docTotal: d.total, contactId: d.contactId, contactName: d.contactName, settledBefore: before, settledAfter: after, settlement: e.settlement }
    out.push({ ...common, accountId: d.control.accountId, net: d.control.sign * e.delta, role: 'control', description: d.control.description, taxCode: null })
    d.parts.forEach((p, i) => { const share = now[i] - was[i]; if (share) out.push({ ...common, accountId: p.accountId, net: p.sign * share, role: p.role, description: p.description, taxCode: p.taxCode }) })
  }
  return out
}
