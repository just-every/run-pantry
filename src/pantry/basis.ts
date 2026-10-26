import { documentCoding } from './dimensions/corrections'
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
import { all, one } from './db'
import { afterTaxShares } from './discounts'

export type Basis = 'accrual' | 'cash'
export const BASIS_LABEL: Record<Basis, string> = { accrual: 'Accrual basis', cash: 'Cash basis' }

export function basisOf(value: unknown): Basis {
  if (value === undefined || value === null || value === '') return 'accrual'
  requireThat(value === 'cash' || value === 'accrual', 'Basis is cash or accrual')
  return value
}

/** Report defaults follow the business declaration; explicit callers keep their choice. */
export async function reportBasis(db: D1Database, value: unknown): Promise<Basis> {
  if (value !== undefined && value !== null && value !== '') return basisOf(value)
  return (await one(db, 'SELECT tax_method FROM pt_entity WHERE id = 1'))?.tax_method === 'cash' ? 'cash' : 'accrual'
}

const DOCUMENT_KINDS = "('invoice', 'credit', 'bill')"
/** SQL condition: entry `e` reads the same on the cash basis (it is not a document's own entry or its reversal). */
export const sameOnCash = (e = 'e') => `NOT (${e}.source_kind IN ${DOCUMENT_KINDS} OR EXISTS (SELECT 1 FROM pt_reclassifications dc WHERE dc.correcting_entry_id=${e}.id AND dc.document_line_id IS NOT NULL) OR (${e}.source_kind = 'reversal' AND EXISTS (SELECT 1 FROM pt_journal_entries o WHERE o.id = ${e}.reverses_id AND o.source_kind IN ${DOCUMENT_KINDS})))`

export type Settlement = {
  allocationId?: string; kind: 'payment' | 'payment-reversed' | 'credit' | 'credit-applied' | 'credit-reversed' | 'credit-refunded'
  date: string; amount: number
  paymentId: string | null; paymentReference: string; paymentJournalId: string | null; reversalJournalId: string | null
  creditId: string | null; creditNumber: string | null; appliedToId: string | null; appliedToNumber: string | null
}

/** One recognised share of a document line on the cash basis. `net` is debit-positive cents. */
export type CashLine = {
  accountId: string; date: string; net: number
  docKind: 'invoice' | 'credit' | 'bill'; docId: string; docRef: string; docJournalId: string; docTotal: number
  contactId: string; contactName: string
  class_name?:string;location_name?:string;project_name?:string
  role: 'control' | 'sale' | 'tax' | 'expense' | 'discount'; description: string; taxCode: string | null; itemId?: string | null
  /** On an early-payment discount credit's line (INVOICE-010): the treatment it applied. */
  early?: string | null
  settledBefore: number; settledAfter: number
  settlement: Settlement
}

type Component = { ordinal?:number; class_name?:string;location_name?:string;project_name?:string; accountId: string; sign: 1 | -1; magnitude: number; role: CashLine['role']; description: string; taxCode: string | null; itemId?: string | null; early?: string | null }
type Doc = { kind: CashLine['docKind']; id: string; ref: string; journalId: string; total: number; contactId: string; contactName: string; control: Component; parts: Component[] }
type Event = { docId: string; date: string; order: string; delta: number; settlement: Settlement }

/** The shares of `settled` (0..total) across parts, by largest remainder; they sum to exactly `settled`.
 *  A part on the control's own side (an invoice discount) counts against the others, so shares are signed. */
function spread(parts: Component[], control: Component, total: number, settled: number): number[] {
  const t = BigInt(total), s = BigInt(settled)
  const exact = parts.map(p => BigInt(p.sign === control.sign ? -p.magnitude : p.magnitude) * s)
  const floor = (x: bigint) => x >= 0n || x % t === 0n ? x / t : x / t - 1n
  const base = exact.map(floor)
  let left = settled - base.reduce((a, b) => a + Number(b), 0)
  const order = exact.map((x, i) => ({ i, rem: x - base[i] * t })).sort((a, b) => (a.rem === b.rem ? a.i - b.i : a.rem > b.rem ? -1 : 1))
  const out = base.map(Number)
  for (const { i } of order) { if (left <= 0) break; out[i] += 1; left -= 1 }
  return out
}

async function documents(db: D1Database): Promise<Map<string, Doc>> {
  const docs = new Map<string, Doc>()
  const control = new Map((await all(db, "SELECT subtype, id FROM pt_accounts WHERE subtype IN ('receivable', 'payable')")).map(a => [a.subtype, a.id]))
  // Only documents something has settled matter on the cash basis.
  const invoices = await all(db, `SELECT i.id, i.kind, i.number, i.total_cents, i.journal_id, i.customer_id, i.after_tax_discount_cents, i.discounts, i.discount_account_id, c.name AS contact_name FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id
    WHERE i.journal_id IS NOT NULL AND (i.id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'invoice') OR i.id IN (SELECT source_id FROM pt_allocations WHERE source_kind = 'credit' UNION SELECT source_id FROM pt_customer_refunds WHERE source_kind='credit' AND status='succeeded'))`)
  const invoiceLines = await all(db, `SELECT l.invoice_id, l.line_no, l.line_kind, l.description, l.amount_cents, l.discount_cents, l.tax_cents, l.tax_code, l.account_id, l.item_id, l.early_treatment, l.class_name,l.location_name,l.project_name, t.account_id AS tax_account FROM pt_invoice_lines l LEFT JOIN pt_tax_codes t ON t.id = l.tax_code
    WHERE l.invoice_id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'invoice' UNION SELECT source_id FROM pt_allocations WHERE source_kind = 'credit' UNION SELECT source_id FROM pt_customer_refunds WHERE source_kind='credit' AND status='succeeded') ORDER BY l.invoice_id, l.line_no`)
  for (const i of invoices) {
    // An invoice debits receivables and credits income and tax; a credit note the reverse.
    const s: 1 | -1 = i.kind === 'invoice' ? 1 : -1
    const parts: Component[] = []
    const sourceLines=invoiceLines.filter(x=>x.invoice_id===i.id),after=afterTaxShares(sourceLines,JSON.parse(i.discounts??'[]'),i.after_tax_discount_cents)
    for (const l of sourceLines) {
      parts.push({ ordinal:Number(l.line_no)+1,class_name:l.class_name,location_name:l.location_name,project_name:l.project_name,accountId: l.account_id, sign: (-s) as 1 | -1, magnitude: l.amount_cents, role: 'sale', description: l.description, taxCode: l.tax_code, itemId: l.item_id, early: l.early_treatment })
      // A before-tax discount (INVOICE-010) is a debit to the discounts account that lowers the line's taxable sale.
      if (l.discount_cents) parts.push({ class_name:l.class_name,location_name:l.location_name,project_name:l.project_name,accountId: i.discount_account_id, sign: s, magnitude: l.discount_cents, role: 'sale', description: `Discount · ${l.description}`, taxCode: l.tax_code })
      if (l.tax_cents) parts.push({ class_name:l.class_name,location_name:l.location_name,project_name:l.project_name,accountId: l.tax_account, sign: (-s) as 1 | -1, magnitude: l.tax_cents, role: 'tax', description: `Sales tax · ${l.description}`, taxCode: l.tax_code, early: l.early_treatment })
    }
    const groupedAfter=new Map<string,{class_name:string;location_name:string;project_name:string;magnitude:number}>()
    sourceLines.forEach((l,n)=>{if(!after[n])return;const key=JSON.stringify([l.class_name,l.location_name,l.project_name]),previous=groupedAfter.get(key);if(previous)previous.magnitude+=after[n];else groupedAfter.set(key,{class_name:l.class_name,location_name:l.location_name,project_name:l.project_name,magnitude:after[n]})})
    for(const part of groupedAfter.values())parts.push({...part,accountId:i.discount_account_id,sign:s,role:'discount',description:`Discount after tax · ${i.number}`,taxCode:null})
    docs.set(i.id, { kind: i.kind, id: i.id, ref: i.number, journalId: i.journal_id, total: i.total_cents, contactId: i.customer_id, contactName: i.contact_name,
      control: { accountId: control.get('receivable')!, sign: s, magnitude: i.total_cents, role: 'control', description: `${i.number} ${i.contact_name}`, taxCode: null }, parts })
  }
  const bills = await all(db, `SELECT b.id, b.reference, b.total_cents, b.journal_id, b.vendor_id, c.name AS contact_name FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id
    WHERE b.journal_id IS NOT NULL AND b.id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'bill')`)
  const billLines = await all(db, "SELECT bill_id, line_no, description, amount_cents, account_id, class_name,location_name,project_name FROM pt_bill_lines WHERE bill_id IN (SELECT target_id FROM pt_allocations WHERE target_kind = 'bill') ORDER BY bill_id, line_no")
  for (const b of bills) docs.set(b.id, { kind: 'bill', id: b.id, ref: b.reference, journalId: b.journal_id, total: b.total_cents, contactId: b.vendor_id, contactName: b.contact_name,
    control: { accountId: control.get('payable')!, sign: -1, magnitude: b.total_cents, role: 'control', description: `${b.contact_name} ${b.reference}`, taxCode: null },
    parts: billLines.filter(l => l.bill_id === b.id).map(l => ({ ordinal:Number(l.line_no),class_name:l.class_name,location_name:l.location_name,project_name:l.project_name,accountId: l.account_id, sign: 1, magnitude: l.amount_cents, role: 'expense', description: l.description, taxCode: null })) })
  const vendorCredits = await all(db, `SELECT v.*, c.name AS contact_name FROM pt_vendor_credits v JOIN pt_contacts c ON c.id = v.vendor_id
    WHERE v.id IN (SELECT source_id FROM pt_allocations WHERE source_kind = 'credit' AND target_kind = 'bill')`)
  for (const v of vendorCredits) docs.set(v.id, { kind: 'credit', id: v.id, ref: v.reference, journalId: v.journal_id, total: v.amount_cents, contactId: v.vendor_id, contactName: v.contact_name,
    control: { accountId: control.get('payable')!, sign: 1, magnitude: v.amount_cents, role: 'control', description: `${v.contact_name} ${v.reference}`, taxCode: null },
    parts: [{ ordinal:1,class_name:v.class_name,location_name:v.location_name,project_name:v.project_name,accountId: v.account_id, sign: -1, magnitude: v.amount_cents, role: 'expense', description: `Vendor credit ${v.reference}`, taxCode: null }] })
  return docs
}

async function events(db: D1Database, docs: Map<string, Doc>): Promise<Event[]> {
  const rows = await all(db, `SELECT a.*, p.reference AS payment_reference, p.journal_id AS payment_journal, p.reversal_id, r.entry_date AS reversal_date, COALESCE(cr.number, vc.reference) AS credit_number, COALESCE(ti.number, tb.reference) AS target_number
    FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind = 'payment' AND p.id = a.source_id LEFT JOIN pt_journal_entries r ON r.id = p.reversal_id
    LEFT JOIN pt_invoices cr ON a.source_kind = 'credit' AND cr.id = a.source_id LEFT JOIN pt_invoices ti ON a.target_kind = 'invoice' AND ti.id = a.target_id
    LEFT JOIN pt_vendor_credits vc ON a.source_kind = 'credit' AND vc.id = a.source_id LEFT JOIN pt_bills tb ON a.target_kind = 'bill' AND tb.id = a.target_id
    ORDER BY a.allocation_date, a.created_at, a.id`)
  const out: Event[] = []
  for (const a of rows) {
    const base = { allocationId:a.id, paymentId: a.source_kind === 'payment' ? a.source_id : null, paymentReference: a.payment_reference ?? '', paymentJournalId: a.payment_journal ?? null, reversalJournalId: null,
      creditId: a.source_kind === 'credit' ? a.source_id : null, creditNumber: a.credit_number ?? null, appliedToId: a.target_id, appliedToNumber: a.target_number ?? null }
    const order = `${a.created_at}|${a.id}`
    if (docs.has(a.target_id)) {
      out.push({ docId: a.target_id, date: a.allocation_date, order, delta: a.amount_cents, settlement: { ...base, kind: a.source_kind === 'credit' ? 'credit' : 'payment', date: a.allocation_date, amount: a.amount_cents } })
      // Money that went back (a reversed payment) un-recognises the same share on the reversal's date.
      if (a.reversal_id) out.push({ docId: a.target_id, date: a.reversal_date, order: `~${order}`, delta: -a.amount_cents, settlement: { ...base, kind: 'payment-reversed', date: a.reversal_date, amount: -a.amount_cents, reversalJournalId: a.reversal_id } })
    }
    if (a.source_kind === 'credit' && docs.has(a.source_id))
      out.push({ docId: a.source_id, date: a.allocation_date, order, delta: a.amount_cents, settlement: { ...base, kind: 'credit-applied', date: a.allocation_date, amount: a.amount_cents } })
    // A credit allocation voided by a linked reversal (a reversed early-payment discount) un-recognises both sides on its date.
    if (a.voided_on && !a.reversal_id) for (const docId of [a.target_id, a.source_id]) if (docs.has(docId))
      out.push({ docId, date: a.voided_on, order: `~${order}`, delta: -a.amount_cents, settlement: { ...base, kind: 'credit-reversed', date: a.voided_on, amount: -a.amount_cents, reversalJournalId: a.voided_by } })
  }
  for (const refund of await all(db, "SELECT r.*,i.number FROM pt_customer_refunds r JOIN pt_invoices i ON i.id=r.source_id WHERE r.source_kind='credit' AND r.status='succeeded' ORDER BY r.refund_date,r.created_at,r.id")) {
    if (!docs.has(refund.source_id)) continue
    out.push({docId:refund.source_id,date:refund.refund_date,order:`${refund.created_at}|${refund.id}`,delta:refund.amount_cents,settlement:{kind:'credit-refunded',date:refund.refund_date,amount:refund.amount_cents,paymentId:refund.payment_id,paymentReference:refund.provider_id??'Recorded refund',paymentJournalId:refund.journal_id,reversalJournalId:null,creditId:refund.source_id,creditNumber:refund.number,appliedToId:null,appliedToNumber:null}})
  }
  return out.sort((x, y) => x.date < y.date ? -1 : x.date > y.date ? 1 : x.order < y.order ? -1 : x.order > y.order ? 1 : 0)
}

/** Every recognised share on the cash basis dated from..to (inclusive). */
export async function cashLines(db: D1Database, from: string, to: string): Promise<CashLine[]> {
  const docs = await documents(db)
  const coding=await documentCoding(db),posted=await all(db,'SELECT * FROM pt_journal_lines ORDER BY entry_id,line_no')
  const settled = new Map<string, number>(), out: CashLine[] = []
  for (const e of await events(db, docs)) {
    const d = docs.get(e.docId)!
    const before = settled.get(d.id) ?? 0, after = before + e.delta
    settled.set(d.id, after)
    if (e.date < from || e.date > to) continue
    const was = spread(d.parts, d.control, d.total, before), now = spread(d.parts, d.control, d.total, after)
    const common = { date: e.date, docKind: d.kind, docId: d.id, docRef: d.ref, docJournalId: d.journalId, docTotal: d.total, contactId: d.contactId, contactName: d.contactName, settledBefore: before, settledAfter: after, settlement: e.settlement }
    const source=posted.filter(l=>l.entry_id===d.journalId)
    d.parts.forEach((p, i) => {
      const share = now[i] - was[i]; if (!share) return
      const original=p.ordinal?source.find(l=>l.line_no===p.ordinal):source.find(l=>l.account_id===p.accountId&&(l.debit_cents-l.credit_cents)*p.sign>0&&['class','location','project'].every(k=>(l[k+'_name']??'')===(p[k+'_name' as keyof Component]??''))&&(p.role==='tax'?l.memo.startsWith('Sales tax '):l.memo.startsWith('Discounts ')))
      const corrected=original?coding.get(original.id):undefined,tags=corrected??p
      // Split recognized controls by the original reviewed component shares.
      // Recoding an income/expense component does not silently recode its AR/AP.
      out.push({ ...common,class_name:p.class_name??'',location_name:p.location_name??'',project_name:p.project_name??'',accountId:d.control.accountId,net:d.control.sign*share,role:'control',description:d.control.description,taxCode:null })
      out.push({ ...common,class_name:tags.class_name??'',location_name:tags.location_name??'',project_name:tags.project_name??'', accountId: p.accountId, net: -d.control.sign * share, role: p.role, description: p.description+(corrected?` · dimension correction entry ${corrected.number}`:''), taxCode: p.taxCode, itemId: p.itemId ?? null, early: p.early ?? null })
    })
  }
  return out
}
