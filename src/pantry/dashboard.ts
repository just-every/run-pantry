// Read-only dashboard figures, calculated from the same books as the reports. The home
// (home.ts) shows the same figures, so each rule lives here once.
import { monthBounds, type Data } from './core'
import { all, one } from './db'
import { ageing, profitAndLoss } from './reports'
import { type Basis } from './basis'
import { entity } from './settings'
import { missingReceipts } from './receipts/attachments'
import { feedHealth } from './feeds/health'
import { clearingState } from './stripe-clearing'

/** Each active bank or card account's latest bank-reported balance; cash totals the asset accounts that report one. */
export async function cashAcrossAccounts(db: D1Database) {
  const accounts = await all(db, `SELECT b.id, b.name, b.number_last4, a.type,
      f.balance_cents, f.last_synced_at, i.institution_name
    FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id
    LEFT JOIN pt_feed_accounts f ON f.bank_account_id = b.id
    LEFT JOIN pt_feed_items i ON i.id = f.item_id AND i.status <> 'disconnected'
    WHERE a.active = 1 ORDER BY b.name`)
  // A disconnected connection is never a current bank balance. Each bank
  // account contributes at most once even if multiple connections were mapped.
  const cashAccounts: Data[] = [], seen = new Set<string>()
  for (const a of accounts.sort((a, b) => String(b.last_synced_at ?? '').localeCompare(String(a.last_synced_at ?? '')))) {
    if (seen.has(a.id)) continue
    seen.add(a.id)
    cashAccounts.push({ ...a, balance_cents: a.institution_name && a.last_synced_at ? a.balance_cents : null })
  }
  return { accounts: cashAccounts, total: cashAccounts.filter(a => a.type === 'asset' && a.balance_cents !== null).reduce((sum, a) => sum + a.balance_cents, 0), observed: cashAccounts.filter(a => a.type === 'asset' && a.balance_cents !== null).length, expected: cashAccounts.filter(a => a.type === 'asset').length }
}

/** Money in and out of the cash accounts from `from` through `asOf`, including transfers. */
export async function bankMovements(db: D1Database, from: string, asOf: string) {
  return one(db, `SELECT COALESCE(SUM(CASE WHEN l.amount_cents > 0 THEN l.amount_cents ELSE 0 END), 0) AS moneyIn,
      COALESCE(SUM(CASE WHEN l.amount_cents < 0 THEN -l.amount_cents ELSE 0 END), 0) AS moneyOut
    FROM pt_bank_lines l JOIN pt_bank_accounts b ON b.id = l.bank_account_id JOIN pt_accounts a ON a.id = b.account_id
    WHERE a.type = 'asset' AND l.removed_at IS NULL AND l.posted_date BETWEEN ? AND ?`, from, asOf)
}

/** Positive open amounts due before the as-of date. */
export async function overdueBalances(db: D1Database, asOf: string) {
  const overdue = (r: { items: Data[] }) => ({ count: r.items.filter((i: Data) => i.open > 0 && i.due_date < asOf).length, amount: r.items.filter((i: Data) => i.open > 0 && i.due_date < asOf).reduce((s: number, i: Data) => s + i.open, 0) })
  return { receivables: overdue(await ageing(db, 'receivable', asOf)), payables: overdue(await ageing(db, 'payable', asOf)) }
}

/** Costs and posted bills still without their receipt or bill document, by month. */
export async function missingSources(db: D1Database, booksStart: string, asOf: string) {
  const sources = [
    ...await missingReceipts(db, booksStart, asOf),
    ...await all(db, `SELECT b.id, b.bill_date AS entry_date FROM pt_bills b WHERE b.status = 'posted' AND b.bill_date <= ? AND b.evidence_waived IS NULL AND NOT EXISTS (SELECT 1 FROM pt_documents d WHERE d.linked_kind = 'bill' AND d.linked_id = b.id)`, asOf),
  ]
  const missingByMonth = new Map<string, number>()
  for (const item of sources) { const month = item.entry_date.slice(0, 7); missingByMonth.set(month, (missingByMonth.get(month) ?? 0) + 1) }
  return { missingReceipts: sources.length, missingByMonth: [...missingByMonth].sort().map(([month, count]) => ({ month, count })) }
}

export async function billsToApprove(db: D1Database) {
  const bills = await one(db, `SELECT
      (SELECT COUNT(*) FROM pt_bills b WHERE b.status = 'draft' AND (b.approved_revision IS NULL OR b.approved_revision <> b.revision) AND NOT EXISTS (SELECT 1 FROM pt_capture_drafts d WHERE d.bill_id = b.id)) +
      (SELECT COUNT(*) FROM pt_capture_drafts WHERE kind = 'bill' AND status = 'draft') AS n`)
  return Number(bills?.n ?? 0)
}

/** "Books up to date through": the later of the latest locked month end and the least-recent
 * completed reconciliation across every active bank or card account opened before the as-of date. */
export async function booksCurrent(db: D1Database, asOf: string) {
  const latestLocked = (await one(db, "SELECT MAX(end_date) AS through FROM pt_periods WHERE status = 'locked' AND end_date <= ?", asOf))?.through ?? null
  const reconciled = await all(db, `SELECT b.id, (SELECT MAX(end_date) FROM pt_reconciliations r WHERE r.bank_account_id = b.id AND end_date <= ?) AS through
    FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE a.active = 1 AND b.opening_date < ?`, asOf, asOf)
  const fullyReconciled = reconciled.length && reconciled.every(r => r.through) ? reconciled.map(r => r.through as string).sort()[0] : null
  const currentThrough = [latestLocked, fullyReconciled].filter(Boolean).sort().at(-1) ?? null
  return { currentThrough, currentSource: currentThrough ? (currentThrough === latestLocked ? 'locked' : 'fully-reconciled') : null }
}

export async function dashboard(db: D1Database, asOf: string, selectedBasis?: Basis) {
  const business = await entity(db), basis = selectedBasis ?? (business?.tax_method === 'cash' ? 'cash' : 'accrual')
  const from = asOf.slice(0, 8) + '01'
  const cash = await cashAcrossAccounts(db), movements = await bankMovements(db, from, asOf)
  const trend = []
  const [year, month] = asOf.split('-').map(Number)
  for (let offset = -5; offset <= 0; offset++) {
    const at = new Date(Date.UTC(year, month - 1 + offset, 1)), id = at.toISOString().slice(0, 7), bounds = monthBounds(id)
    const report = await profitAndLoss(db, bounds.start, offset === 0 ? asOf : bounds.end, basis)
    trend.push({ month: id, from: report.from, to: report.to, income: report.totalIncome, expenses: report.totalExpenses, netIncome: report.netIncome })
  }
  const overdue = await overdueBalances(db, asOf), missing = await missingSources(db, business?.books_start ?? '0001-01-01', asOf), current = await booksCurrent(db, asOf)
  return { asOf, from, basis, cash, movements, trend, clearing: await clearingState(db), overdue,
    work: { missingReceipts: missing.missingReceipts, missingByMonth: missing.missingByMonth, billsToApprove: await billsToApprove(db), brokenConnections: (await feedHealth(db)).length },
    currentThrough: current.currentThrough, currentSource: current.currentSource }
}
