import { all, one } from '../db'
import { balanceSheet, balances, generalLedger, profitAndLoss, trialBalance } from '../reports'
import { cashFlow } from '../cash-flow'
import { salesTax } from '../sales-tax'
import { vendorYear } from '../contractors'
import { addDays, monthBounds, type Data } from '../core'
import type { Basis } from '../basis'

const amounts = (rows: Data[], fields: string[]) => rows.map(r => Object.fromEntries(fields.map(k => [k, r[k]])))

/** The actual report calculators, with source rows and tax identifiers omitted. */
export async function reportFigures(db: D1Database, from: string, to: string, basis: Basis) {
  const entity = await one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  const [tb, pl, bs, flow, tax, vendors, opening, ledger] = await Promise.all([
    trialBalance(db, to, basis), profitAndLoss(db, from, to, basis), balanceSheet(db, to, Number(entity?.fiscal_year_start ?? 1), basis),
    cashFlow(db, from, to), salesTax(db, from, to, basis), vendorYear(db, Number(to.slice(0, 4))), balances(db, to, undefined, basis), generalLedger(db, from, to, undefined, basis),
  ])
  const accountRows = (rows: Data[]) => amounts(rows, ['id', 'code', 'name', 'amount'])
  const flowRows = (rows: Data[]) => amounts(rows, ['id', 'code', 'name', 'amount'])
  return {
    basis, from, to,
    generalLedger: ledger.accounts.map(a => ({ id: a.id, opening: a.opening, closing: a.closing, rows: amounts(a.rows, ['entry_date', 'entry_memo', 'debit_cents', 'credit_cents', 'memo']) })),
    trialBalance: { rows: amounts(tb.rows, ['id', 'code', 'name', 'net', 'debitBalance', 'creditBalance']), debit: tb.debit, credit: tb.credit, balanced: tb.balanced },
    profitAndLoss: { income: accountRows(pl.income), expenses: accountRows(pl.expenses), totalIncome: pl.totalIncome, totalExpenses: pl.totalExpenses, netIncome: pl.netIncome },
    balanceSheet: { assets: accountRows(bs.assets), liabilities: accountRows(bs.liabilities), equity: accountRows(bs.equity), totalAssets: bs.totalAssets, totalLiabilities: bs.totalLiabilities, totalEquity: bs.totalEquity, balanced: bs.balanced },
    cashFlow: { operating: flowRows(flow.operating), investing: flowRows(flow.investing), financing: flowRows(flow.financing), totalOperating: flow.totalOperating, totalInvesting: flow.totalInvesting, totalFinancing: flow.totalFinancing, opening: flow.opening, closing: flow.closing, netChange: flow.netChange, ties: flow.ties },
    salesTax: { totals: tax.totals, states: tax.states.map(s => ({ state: s.state, taxable: s.taxable, charged: s.charged, collected: s.collected, owed: s.owed })), ledger: tax.ledger },
    contractors: { year: Number(to.slice(0, 4)), vendors: vendors.map(v => ({ id: v.id, name: v.name, is1099: v.is1099, box1: v.box1, excluded: v.excluded, unrecorded: v.unrecorded, reversed: v.reversed })), total: vendors.filter(v => v.is1099).reduce((n, v) => n + v.box1, 0) },
    // Opening is the previous day's closing ledger, not the following day's
    // transactions. Balance-sheet retained earnings follow the fiscal calendar.
    nextOpening: { date: addDays(to, 1), rows: amounts(opening.filter(r => r.net !== 0), ['id', 'code', 'name', 'net']), balanceSheet: { assets: accountRows(bs.assets), liabilities: accountRows(bs.liabilities), equity: accountRows(bs.equity) } },
  }
}

export const figuresDiffer = (before: unknown, after: unknown) => JSON.stringify(before) !== JSON.stringify(after)
export type FiguresReader = typeof reportFigures

export async function affectedLocks(db: D1Database, projected: D1Database, earliest: string, figures: FiguresReader = reportFigures) {
  const locks = await all(db, "SELECT id, start_date, end_date, locked_by, locked_at, revision FROM pt_periods WHERE status = 'locked' AND end_date >= ? ORDER BY start_date", earliest)
  const affected: Data[] = []
  for (const lock of locks) {
    const [before, after] = await Promise.all([figures(db, lock.start_date, lock.end_date, 'accrual'), figures(projected, lock.start_date, lock.end_date, 'accrual')])
    // 1099 is an annual report, so its separate year-wide effect must not make
    // an otherwise unchanged earlier locked month appear changed.
    const monthly = (r: Data) => ({ ...r, contractors: undefined })
    if (figuresDiffer(monthly(before), monthly(after))) affected.push({ ...lock, reopenRequest: (await one(db, "SELECT id FROM pt_reopen_requests WHERE period = ? AND status = 'pending'", lock.id))?.id ?? null })
  }
  return affected
}

export const correctionRange = (day: string) => monthBounds(day.slice(0, 7))
