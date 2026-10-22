// Reports, all calculated from posted journal lines (and, for ageing, the open
// items those lines carry). Nothing here stores or accepts a total. Each ledger
// report reads on the accrual or the cash basis (basis.ts) and names its basis.
import { daysBetween, longDay, requireThat, type Data } from './core'
import { all, one } from './db'
import { cashLines, sameOnCash, type Basis } from './basis'
import { appliedAsOf, unappliedRows } from './open-items'

type Balance = { id: string; code: string; name: string; type: string; subtype: string; debit: number; credit: number; net: number }

export async function balances(db: D1Database, to: string, from = '0000-01-01', basis: Basis = 'accrual'): Promise<Balance[]> {
  const kept = basis === 'cash' ? `AND ${sameOnCash()}` : ''
  const rows = await all(db, `SELECT a.id, a.code, a.name, a.type, a.subtype,
      COALESCE(SUM(CASE WHEN e.status = 'posted' AND e.entry_date BETWEEN ? AND ? ${kept} THEN l.debit_cents END), 0) AS debit,
      COALESCE(SUM(CASE WHEN e.status = 'posted' AND e.entry_date BETWEEN ? AND ? ${kept} THEN l.credit_cents END), 0) AS credit
    FROM pt_accounts a LEFT JOIN pt_journal_lines l ON l.account_id = a.id LEFT JOIN pt_journal_entries e ON e.id = l.entry_id
    GROUP BY a.id ORDER BY a.code`, from, to, from, to)
  const out = rows.map(r => ({ ...r, debit: Number(r.debit), credit: Number(r.credit) })) as Balance[]
  if (basis === 'cash') {
    const byId = new Map(out.map(b => [b.id, b]))
    for (const l of await cashLines(db, from, to)) { const b = byId.get(l.accountId)!; if (l.net > 0) b.debit += l.net; else b.credit -= l.net }
  }
  return out.map(b => ({ ...b, net: b.debit - b.credit }))
}

export async function trialBalance(db: D1Database, asOf: string, basis: Basis = 'accrual') {
  const rows = (await balances(db, asOf, undefined, basis)).filter(r => r.net !== 0).map(r => ({ ...r, debitBalance: r.net > 0 ? r.net : 0, creditBalance: r.net < 0 ? -r.net : 0 }))
  const debit = rows.reduce((s, r) => s + r.debitBalance, 0), credit = rows.reduce((s, r) => s + r.creditBalance, 0)
  return { basis, asOf, rows, debit, credit, balanced: debit === credit }
}

export async function generalLedger(db: D1Database, from: string, to: string, accountId?: string, basis: Basis = 'accrual') {
  const opening = new Map((await balances(db, prevDay(from), undefined, basis)).map(b => [b.id, b.net]))
  const lines = await all(db, `SELECT l.*, e.number, e.entry_date, e.memo AS entry_memo, e.source_kind, e.reverses_id, e.reversed_by_id, a.code, a.name AS account_name, c.name AS contact_name
    FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id LEFT JOIN pt_contacts c ON c.id = l.contact_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? ${accountId ? 'AND l.account_id = ?' : ''} ${basis === 'cash' ? `AND ${sameOnCash()}` : ''} ORDER BY a.code, e.entry_date, e.number, l.line_no`, from, to, ...(accountId ? [accountId] : []))
  if (basis === 'cash') {
    // Settled shares of invoices, credits and bills, dated when they were settled.
    for (const [i, l] of (await cashLines(db, from, to)).entries()) if (!accountId || l.accountId === accountId)
      lines.push({ id: `cash-${i}`, entry_id: l.docJournalId, account_id: l.accountId, entry_date: l.date, number: null, entry_memo: settlementMemo(l), memo: l.description, contact_name: l.contactName, contact_id: l.contactId, debit_cents: Math.max(l.net, 0), credit_cents: Math.max(-l.net, 0), class_name:l.class_name??'',location_name:l.location_name??'',project_name:l.project_name??'',source_kind: l.docKind, item_id: l.itemId ?? null })
    lines.sort((x, y) => x.entry_date < y.entry_date ? -1 : x.entry_date > y.entry_date ? 1 : (x.number ?? Infinity) - (y.number ?? Infinity))
  }
  const accounts = await all(db, `SELECT id, code, name, type FROM pt_accounts ${accountId ? 'WHERE id = ?' : ''} ORDER BY code`, ...(accountId ? [accountId] : []))
  return { basis, from, to, accounts: accounts.map(a => {
    let running = opening.get(a.id) ?? 0
    const rows = lines.filter(l => l.account_id === a.id).map(l => ({ ...l, running: (running += l.debit_cents - l.credit_cents) }) as Data)
    return { ...a, opening: opening.get(a.id) ?? 0, rows, closing: running } as Data
  }).filter(a => a.rows.length || a.opening !== 0) }
}

/** How a cash-basis share reads in a ledger: the document, and what settled it. */
export function settlementMemo(l: { docKind: string; docRef: string; contactName: string; docTotal: number; settlement: { kind: string; amount: number; paymentReference: string; creditNumber: string | null; appliedToNumber: string | null } }) {
  const doc = `${l.docKind === 'bill' ? 'Bill' : l.docKind === 'credit' ? 'Credit' : 'Invoice'} ${l.docRef} — ${l.contactName}`
  const s = l.settlement, amount = (Math.abs(s.amount) / 100).toFixed(2), of = (l.docTotal / 100).toFixed(2)
  if (s.kind === 'payment') return `${doc}: ${amount} of ${of} paid${s.paymentReference ? ` (${s.paymentReference})` : ''}`
  if (s.kind === 'payment-reversed') return `${doc}: payment of ${amount} reversed`
  if (s.kind === 'credit-reversed') return `${doc}: early-payment discount of ${amount} reversed`
  if (s.kind === 'credit') return `${doc}: ${amount} of ${of} settled by credit ${s.creditNumber}`
  return `${doc}: ${amount} of ${of} applied to ${s.appliedToNumber}`
}

export async function profitAndLoss(db: D1Database, from: string, to: string, basis: Basis = 'accrual') {
  const rows = (await balances(db, to, from, basis)).filter(r => (r.type === 'income' || r.type === 'expense') && r.net !== 0)
  const income = rows.filter(r => r.type === 'income').map(r => ({ ...r, amount: -r.net }))
  const expenses = rows.filter(r => r.type === 'expense').map(r => ({ ...r, amount: r.net }))
  const totalIncome = income.reduce((s, r) => s + r.amount, 0), totalExpenses = expenses.reduce((s, r) => s + r.amount, 0)
  const report = { basis, from, to, income, expenses, totalIncome, totalExpenses, netIncome: totalIncome - totalExpenses }
  return basis === 'cash' ? { ...report, bridge: await bridge(db, from, to, report.netIncome) } : report
}

/** Accrual net income to cash net income: documents recorded in the range out, their settlements in the range in. */
async function bridge(db: D1Database, from: string, to: string, cashNet: number): Promise<{ accrualNetIncome: number; recordedInRange: number; settledInRange: number; cashNetIncome: number; ties: boolean }> {
  const accrual = { netIncome: -(await balances(db, to, from)).filter(r => r.type === 'income' || r.type === 'expense').reduce((s, r) => s + r.net, 0) }
  const recorded = -Number((await one(db, `SELECT COALESCE(SUM(l.debit_cents - l.credit_cents), 0) AS n FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id
    WHERE e.status = 'posted' AND e.entry_date BETWEEN ? AND ? AND a.type IN ('income', 'expense') AND NOT ${sameOnCash()}`, from, to))?.n ?? 0)
  const types = new Map((await all(db, 'SELECT id, type FROM pt_accounts')).map(a => [a.id, a.type]))
  const settled = -(await cashLines(db, from, to)).filter(l => ['income', 'expense'].includes(types.get(l.accountId))).reduce((s, l) => s + l.net, 0)
  return { accrualNetIncome: accrual.netIncome, recordedInRange: recorded, settledInRange: settled, cashNetIncome: cashNet, ties: accrual.netIncome - recorded + settled === cashNet }
}

export function fiscalYearStart(asOf: string, startMonth: number) {
  const [y, m] = asOf.split('-').map(Number)
  const year = m >= startMonth ? y : y - 1
  return `${year}-${String(startMonth).padStart(2, '0')}-01`
}

export async function balanceSheet(db: D1Database, asOf: string, startMonth: number, basis: Basis = 'accrual') {
  const all_ = await balances(db, asOf, undefined, basis)
  const fyStart = fiscalYearStart(asOf, startMonth)
  const current = await profitAndLoss(db, fyStart, asOf, basis)
  const prior = (await balances(db, prevDay(fyStart), undefined, basis)).filter(r => r.type === 'income' || r.type === 'expense').reduce((s, r) => s - r.net, 0)
  const assets = all_.filter(r => r.type === 'asset' && r.net !== 0).map(r => ({ ...r, amount: r.net }))
  const liabilities = all_.filter(r => r.type === 'liability' && r.net !== 0).map(r => ({ ...r, amount: -r.net }))
  const equity = all_.filter(r => r.type === 'equity' && r.net !== 0).map(r => ({ ...r, amount: -r.net }))
  // Earnings not yet closed to an equity account appear as calculated lines, labelled as such.
  if (prior) equity.push({ id: 'prior-earnings', code: '', name: "Prior years' earnings (calculated)", type: 'equity', subtype: 'retained', debit: 0, credit: 0, net: -prior, amount: prior })
  if (current.netIncome) equity.push({ id: 'current-earnings', code: '', name: `Net income since ${longDay(fyStart)} (calculated)`, type: 'equity', subtype: 'retained', debit: 0, credit: 0, net: -current.netIncome, amount: current.netIncome })
  const totalAssets = assets.reduce((s, r) => s + r.amount, 0), totalLiabilities = liabilities.reduce((s, r) => s + r.amount, 0), totalEquity = equity.reduce((s, r) => s + r.amount, 0)
  return { basis, asOf, fyStart, assets, liabilities, equity, totalAssets, totalLiabilities, totalEquity, balanced: totalAssets === totalLiabilities + totalEquity }
}

export const BUCKETS = ['Current', '1–30 days', '31–60 days', '61–90 days', 'Over 90 days']
const bucket = (overdue: number) => overdue <= 0 ? 0 : overdue <= 30 ? 1 : overdue <= 60 ? 2 : overdue <= 90 ? 3 : 4

/** Open items as of a date and their tie-out to the control account. */
export async function ageing(db: D1Database, kind: 'receivable' | 'payable', asOf: string) {
  const items = kind === 'receivable'
    ? await all(db, "SELECT i.id, i.number AS ref, i.issue_date AS doc_date, i.due_date, i.total_cents, c.name AS contact, c.id AS contact_id FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.kind = 'invoice' AND i.status = 'issued' AND i.issue_date <= ? ORDER BY i.due_date, i.number, i.id", asOf)
    : await all(db, "SELECT b.id, b.reference AS ref, b.bill_date AS doc_date, b.due_date, b.total_cents, c.name AS contact, c.id AS contact_id FROM pt_bills b JOIN pt_contacts c ON c.id = b.vendor_id WHERE (b.status = 'posted' OR (b.opening = 1 AND b.status <> 'void')) AND b.bill_date <= ? ORDER BY b.due_date, b.reference, b.id", asOf)
  const applied = new Map<string, number>()
  for (const a of await appliedAsOf(db, kind, asOf)) applied.set(a.target_id, (applied.get(a.target_id) ?? 0) + a.amount_cents)
  const open = items.map(i => ({ ...i, open: i.total_cents - (applied.get(i.id) ?? 0), overdue: daysBetween(i.due_date, asOf) })).filter(i => i.open !== 0)
  for (const i of open) (i as Data).bucket = BUCKETS[bucket(i.overdue)]
  // Money received or credited but not yet applied lowers what is owed overall.
  const unapplied = (await unappliedRows(db, kind, asOf)).reduce((n, r) => n + r.amount, 0)
  const totals = BUCKETS.map(name => open.filter(i => (i as Data).bucket === name).reduce((s, i) => s + i.open, 0))
  const itemsTotal = open.reduce((s, i) => s + i.open, 0)
  const control = (await balances(db, asOf)).find(b => b.subtype === kind)
  const controlBalance = control ? (kind === 'receivable' ? control.net : -control.net) : 0
  return { basis: 'accrual' as const, kind, asOf, buckets: BUCKETS, items: open, totals, itemsTotal, unapplied, subledger: itemsTotal - unapplied, control: control ? { id: control.id, code: control.code, name: control.name, balance: controlBalance } : null, agrees: !!control && itemsTotal - unapplied === controlBalance }
}

export function prevDay(day: string) {
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(day), 'Use YYYY-MM-DD dates')
  return new Date(Date.parse(day + 'T00:00:00Z') - 86400000).toISOString().slice(0, 10)
}
