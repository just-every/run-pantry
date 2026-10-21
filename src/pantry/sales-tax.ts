// Sales tax by state for a period, from invoice and credit lines, tied to the
// ledger's sales tax liability accounts. On the accrual basis tax is owed when
// an invoice is issued; on the cash basis when it is paid (the same settled
// shares the cash-basis reports use). Tax collected is always what customers
// actually paid in the period. A line's taxable sale is its amount less its
// before-tax discount (INVOICE-010). Write-off credits (ACCT-003) are bad debts, not
// returns: they are left out until the accountant can record a state's bad-debt
// deduction.
import { type Data } from './core'
import { all, one } from './db'
import { cashLines, type Basis, type CashLine } from './basis'
import { balances, prevDay } from './reports'
import { suggestionFor } from './early-payment-table'

// Early-payment discounts (INVOICE-010) are their own columns. On reduce lines the
// discount lowers taxable sales and tax in the period of the discount's date;
// retain lines keep taxable sales and tax as invoiced (column "tax kept"); a
// discount on an exempt line is shown for information only.
type Early = { reduced: number; taxReduced: number; kept: number; exempt: number }
const noEarly = (): Early => ({ reduced: 0, taxReduced: 0, kept: 0, exempt: 0 })

type Row = { taxable: number; charged: number; collected: number; owed: number }
const zero = (): Row => ({ taxable: 0, charged: 0, collected: 0, owed: 0 })
const add = (a: Row, b: Partial<Row>) => { for (const k of ['taxable', 'charged', 'collected', 'owed'] as const) a[k] += b[k] ?? 0 }

/** One source line's share of one figure: invoiced (accrual), paid (settled shares) or an early-payment column. */
export type Contribution = { set: 'accrual' | 'paid' | 'accrualEarly' | 'cashEarly'; key: string; metric: string; amount: number; source: Data }

/** Every line the report adds up, so each figure and its drill-through read the same contributions. */
export async function salesTaxContributions(db: D1Database, from: string, to: string): Promise<Contribution[]> {
  const out: Contribution[] = []
  const put = (set: Contribution['set'], key: string, metric: string, amount: number, source: Data) => { if (amount) out.push({ set, key, metric, amount, source }) }
  const early = (set: 'accrualEarly' | 'cashEarly', key: string, treatment: string, amount: number, tax: number, source: Data) => {
    if (treatment === 'reduce') { put(set, key, 'reduced', amount, source); put(set, key, 'taxReduced', tax, source) } else put(set, key, treatment === 'retain' ? 'kept' : 'exempt', amount, source)
  }
  // Invoiced in the period (credits count against it): taxable sales and tax charged.
  const invoiced = await all(db, `SELECT i.id, i.number, i.kind, i.issue_date, i.credit_for, i.early_discount, l.id AS line_id, l.description, l.early_treatment, l.tax_code, l.amount_cents - l.discount_cents AS amount_cents, l.tax_cents FROM pt_invoice_lines l JOIN pt_invoices i ON i.id = l.invoice_id
    WHERE i.status = 'issued' AND i.journal_id IS NOT NULL AND i.write_off = 0 AND i.issue_date BETWEEN ? AND ? ORDER BY i.issue_date, i.number, l.line_no`, from, to)
  // A reversed early-payment discount gives back its reduction in the reversal's period.
  const reversed = await all(db, `SELECT i.id, i.number, i.kind, i.credit_for, r.id AS reversal_id, r.entry_date, l.id AS line_id, l.description, l.early_treatment, l.tax_code, l.amount_cents, l.tax_cents FROM pt_invoice_lines l JOIN pt_invoices i ON i.id = l.invoice_id JOIN pt_journal_entries r ON r.id = i.early_reversal_id
    WHERE i.early_discount = 1 AND r.entry_date BETWEEN ? AND ? ORDER BY r.entry_date, i.number, l.line_no`, from, to)
  for (const l of reversed) {
    const key = l.tax_code ?? 'exempt', source = { kind: 'reversal', ...l }
    early('accrualEarly', key, l.early_treatment, -l.amount_cents, -l.tax_cents, source)
    if (l.early_treatment === 'reduce') { put('accrual', key, 'taxable', l.amount_cents, source); put('accrual', key, 'charged', l.tax_cents, source) }
  }
  for (const l of invoiced) {
    const key = l.tax_code ?? 'exempt', source = { kind: 'invoiced', ...l }
    if (l.early_discount) { early('accrualEarly', key, l.early_treatment, l.amount_cents, l.tax_cents, source); if (l.early_treatment !== 'reduce') continue }
    const sign = l.kind === 'credit' ? -1 : 1
    put('accrual', key, 'taxable', sign * l.amount_cents, source); put('accrual', key, 'charged', sign * l.tax_cents, source)
  }
  // Paid in the period: the settled shares of each line and of its tax.
  const writeOffs = await writeOffCredits(db)
  for (const [index, c] of (await cashLines(db, from, to)).entries()) {
    if (c.docKind === 'bill' || (c.role !== 'sale' && c.role !== 'tax') || writtenOff(c, writeOffs)) continue
    const key = c.taxCode ?? 'exempt', source = { kind: 'settled', index, line: c }
    if (c.early) {
      early('cashEarly', key, c.early, c.role === 'sale' ? c.net : 0, c.role === 'tax' ? c.net : 0, source)
      if (c.early !== 'reduce') continue
    }
    put('paid', key, c.role === 'sale' ? 'taxable' : 'collected', -c.net, source)
  }
  return out
}

/** Which contributions make a code's figure on a basis. */
export function figureParts(metric: string, basis: Basis): [Contribution['set'], string] {
  if (['reduced', 'taxReduced', 'kept', 'exempt'].includes(metric)) return [basis === 'cash' ? 'cashEarly' : 'accrualEarly', metric]
  if (metric === 'charged') return ['accrual', 'charged']
  if (metric === 'collected' || (metric === 'owed' && basis === 'cash')) return ['paid', 'collected']
  if (metric === 'owed') return ['accrual', 'charged']
  return [basis === 'cash' ? 'paid' : 'accrual', 'taxable']
}

export async function salesTax(db: D1Database, from: string, to: string, basis: Basis) {
  const codes = await all(db, 'SELECT t.*, a.code AS account_code, a.name AS account_name FROM pt_tax_codes t JOIN pt_accounts a ON a.id = t.account_id ORDER BY t.state, t.name')
  const contributions = await salesTaxContributions(db, from, to), sums = new Map<string, number>()
  for (const c of contributions) sums.set(`${c.set}|${c.key}|${c.metric}`, (sums.get(`${c.set}|${c.key}|${c.metric}`) ?? 0) + c.amount)
  const value = (key: string, metric: string) => { const [set, m] = figureParts(metric, basis); return sums.get(`${set}|${key}|${m}`) ?? 0 }
  const row = (key: string): Row => ({ taxable: value(key, 'taxable'), charged: value(key, 'charged'), collected: value(key, 'collected'), owed: value(key, 'owed') })
  const earlyOf = (key: string): Early => ({ reduced: value(key, 'reduced'), taxReduced: value(key, 'taxReduced'), kept: value(key, 'kept'), exempt: value(key, 'exempt') })
  const byCode = new Map<string, Row>([['exempt', row('exempt')], ...codes.map(c => [c.id, row(c.id)] as [string, Row])])
  const codeRows = codes.map(c => ({ id: c.id, name: c.name, state: c.state, rate: c.rate_milli_percent, accountId: c.account_id, ...byCode.get(c.id)!,
    early: earlyOf(c.id), treatment: c.early_treatment, againstSuggestion: !!suggestionFor(c.state) && c.early_treatment !== 'undecided' && suggestionFor(c.state)!.suggested !== c.early_treatment }))
  const states = [...new Set(codes.map(c => c.state))].map(state => {
    const rows = codeRows.filter(r => r.state === state), total = zero(), early = noEarly()
    for (const r of rows) { add(total, r); for (const k of ['reduced', 'taxReduced', 'kept', 'exempt'] as const) early[k] += r.early[k] }
    return { state, codes: rows, ...total, early }
  })
  const totals = zero()
  for (const s of states) add(totals, s)
  return { basis, from, to, states, exempt: byCode.get('exempt')!.taxable, totals, earlyExempt: earlyOf('exempt').exempt,
    earlyColumns: ['Early-payment discounts, tax kept', 'Early-payment discounts, tax reduced', 'Tax reduced'],
    againstSuggestion: codeRows.filter(r => r.againstSuggestion).map(r => ({ id: r.id, name: r.name, state: r.state, treatment: r.treatment })),
    earlyItems: await earlyItems(db, from, to), ledger: await ledgerTie(db, from, to, basis, codeRows) }
}

/** Each early-payment discount line taken in the range; a sale invoiced before the range is flagged as an earlier-period sale. */
async function earlyItems(db: D1Database, from: string, to: string) {
  const rows = await all(db, `SELECT cr.number AS credit, cr.issue_date AS taken_on, cr.early_reversal_id, inv.number AS invoice, inv.issue_date AS invoice_date, l.tax_code, t.name AS code_name, t.state, l.amount_cents, l.tax_cents, l.early_treatment
    FROM pt_invoices cr JOIN pt_invoices inv ON inv.id = cr.credit_for JOIN pt_invoice_lines l ON l.invoice_id = cr.id LEFT JOIN pt_tax_codes t ON t.id = l.tax_code
    WHERE cr.early_discount = 1 AND cr.status = 'issued' AND cr.issue_date BETWEEN ? AND ? ORDER BY cr.issue_date, cr.number, l.line_no`, from, to)
  return rows.map(r => ({ credit: r.credit, invoice: r.invoice, invoiceDate: r.invoice_date, takenOn: r.taken_on, state: r.state ?? '', code: r.code_name ?? 'Exempt', treatment: r.early_treatment,
    discount: r.amount_cents, taxReduced: r.tax_cents, reversed: !!r.early_reversal_id, earlierPeriod: r.invoice_date < from, label: r.invoice_date < from ? 'Sale in an earlier period' : '' }))
}

/** Liability postings that come from invoices and credits, or from reversing an early-payment discount credit. */
export const FROM_SALES = "(e.source_kind IN ('invoice', 'credit') OR (e.source_kind = 'reversal' AND EXISTS (SELECT 1 FROM pt_invoices d WHERE d.journal_id = e.reverses_id AND d.early_discount = 1)))"

export const writeOffCredits = async (db: D1Database) => new Set((await all(db, 'SELECT id FROM pt_invoices WHERE write_off = 1')).map(r => r.id))
export const writtenOff = (c: CashLine, ids: Set<string>) => ids.has(c.docId) || (c.settlement?.creditId ? ids.has(c.settlement.creditId) : false)

/** Each liability account: opening, tax from invoices and credits, everything else (payments to the state), closing. */
async function ledgerTie(db: D1Database, from: string, to: string, basis: Basis, codes: Data[]) {
  const accounts = await all(db, "SELECT id, code, name FROM pt_accounts WHERE subtype = 'tax' ORDER BY code")
  const opening = new Map((await balances(db, prevDay(from), undefined, basis)).map(b => [b.id, -b.net]))
  const closing = new Map((await balances(db, to, undefined, basis)).map(b => [b.id, -b.net]))
  const writeOffs = await writeOffCredits(db)
  const cash = basis === 'cash' ? (await cashLines(db, from, to)).filter(c => !writtenOff(c, writeOffs)) : []
  const rows = []
  for (const a of accounts) {
    // Read from the ledger, not from the invoice lines the report adds up.
    const fromSales = basis === 'cash'
      ? cash.filter(c => c.accountId === a.id && c.role === 'tax').reduce((s, c) => s - c.net, 0)
      : Number((await one(db, `SELECT COALESCE(SUM(l.credit_cents - l.debit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id
          WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND l.account_id = ? AND ${FROM_SALES}`, from, to, a.id))?.n ?? 0)
    const owed = codes.filter(c => c.accountId === a.id).reduce((s, c) => s + c.owed, 0)
    const open = opening.get(a.id) ?? 0, close = closing.get(a.id) ?? 0
    rows.push({ id: a.id, code: a.code, name: a.name, opening: open, fromSales, other: close - open - fromSales, closing: close, owed, ties: fromSales === owed })
  }
  return { accounts: rows, ties: rows.every(r => r.ties) }
}
