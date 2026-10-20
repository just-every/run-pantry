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

type Row = { taxable: number; charged: number; collected: number; owed: number }
const zero = (): Row => ({ taxable: 0, charged: 0, collected: 0, owed: 0 })
const add = (a: Row, b: Partial<Row>) => { for (const k of ['taxable', 'charged', 'collected', 'owed'] as const) a[k] += b[k] ?? 0 }

export async function salesTax(db: D1Database, from: string, to: string, basis: Basis) {
  const codes = await all(db, 'SELECT t.*, a.code AS account_code, a.name AS account_name FROM pt_tax_codes t JOIN pt_accounts a ON a.id = t.account_id ORDER BY t.state, t.name')
  const byCode = new Map<string, Row>([['exempt', zero()], ...codes.map(c => [c.id, zero()] as [string, Row])])
  // Invoiced in the period (credits count against it): taxable sales and tax charged.
  const invoiced = await all(db, `SELECT i.kind, l.tax_code, l.amount_cents - l.discount_cents AS amount_cents, l.tax_cents FROM pt_invoice_lines l JOIN pt_invoices i ON i.id = l.invoice_id
    WHERE i.status = 'issued' AND i.journal_id IS NOT NULL AND i.write_off = 0 AND i.issue_date BETWEEN ? AND ?`, from, to)
  const accrual = new Map<string, Row>()
  for (const l of invoiced) {
    const s = l.kind === 'credit' ? -1 : 1, key = l.tax_code ?? 'exempt'
    const row = accrual.get(key) ?? zero(); add(row, { taxable: s * l.amount_cents, charged: s * l.tax_cents }); accrual.set(key, row)
  }
  // Paid in the period: the settled shares of each line and of its tax.
  const writeOffs = await writeOffCredits(db)
  const paid = new Map<string, Row>()
  for (const c of await cashLines(db, from, to)) {
    if (c.docKind === 'bill' || (c.role !== 'sale' && c.role !== 'tax') || writtenOff(c, writeOffs)) continue
    const key = c.taxCode ?? 'exempt', row = paid.get(key) ?? zero()
    add(row, c.role === 'sale' ? { taxable: -c.net } : { collected: -c.net }); paid.set(key, row)
  }
  for (const [key, row] of byCode) {
    const a = accrual.get(key) ?? zero(), p = paid.get(key) ?? zero()
    Object.assign(row, { taxable: basis === 'cash' ? p.taxable : a.taxable, charged: a.charged, collected: p.collected, owed: basis === 'cash' ? p.collected : a.charged })
  }
  const codeRows = codes.map(c => ({ id: c.id, name: c.name, state: c.state, rate: c.rate_milli_percent, accountId: c.account_id, ...byCode.get(c.id)! }))
  const states = [...new Set(codes.map(c => c.state))].map(state => {
    const rows = codeRows.filter(r => r.state === state), total = zero()
    for (const r of rows) add(total, r)
    return { state, codes: rows, ...total }
  })
  const totals = zero()
  for (const s of states) add(totals, s)
  return { basis, from, to, states, exempt: byCode.get('exempt')!.taxable, totals, ledger: await ledgerTie(db, from, to, basis, codeRows) }
}

const writeOffCredits = async (db: D1Database) => new Set((await all(db, 'SELECT id FROM pt_invoices WHERE write_off = 1')).map(r => r.id))
const writtenOff = (c: CashLine, ids: Set<string>) => ids.has(c.docId) || (c.settlement?.creditId ? ids.has(c.settlement.creditId) : false)

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
          WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND l.account_id = ? AND e.source_kind IN ('invoice', 'credit')`, from, to, a.id))?.n ?? 0)
    const owed = codes.filter(c => c.accountId === a.id).reduce((s, c) => s + c.owed, 0)
    const open = opening.get(a.id) ?? 0, close = closing.get(a.id) ?? 0
    rows.push({ id: a.id, code: a.code, name: a.name, opening: open, fromSales, other: close - open - fromSales, closing: close, owed, ties: fromSales === owed })
  }
  return { accounts: rows, ties: rows.every(r => r.ties) }
}
