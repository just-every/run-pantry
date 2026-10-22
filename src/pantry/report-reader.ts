// The native and scoped API use the same posted-data report dispatch.
import { dimensionScope } from './dimensions/scope'
import { Fault, requireThat } from './core'
import { one } from './db'
import type { Basis } from './basis'
import { ageing, balanceSheet, generalLedger, profitAndLoss, trialBalance } from './reports'
import { cashFlow } from './cash-flow'
import { contactTotals } from './contact-totals'
import { statementColumns } from './statement-columns'
import { isLibrary, libraryReport, LIBRARY } from './report-library'
import { salesTax } from './sales-tax'
import { salesByItem } from './items/report'

// Financial reports only: the native audit-history report has its own data class.
export const FINANCIAL_REPORTS = [
  'trial-balance', 'general-ledger', 'profit-and-loss', 'balance-sheet',
  'sales-by-customer', 'expenses-by-vendor', 'sales-by-item', 'cash-flow',
  'sales-tax', 'receivables', 'payables', ...Object.keys(LIBRARY).filter(kind => kind !== 'audit-log'),
] as const

type Options = { from: string; to: string; basis: Basis; account?: string; payee?: string; columns?: string;dimension?:string;dimensionValue?:string }

export async function readReport(db: D1Database, kind: string, { from, to, basis, account, payee, columns,dimension,dimensionValue }: Options) {
  requireThat(!dimension||['general-ledger','trial-balance'].includes(kind),'Dimension filters are currently available on general ledger and trial balance; use P&L dimension columns for a split',409)
  const scope=await dimensionScope(db,dimension,dimensionValue)
  if (isLibrary(kind)) return libraryReport(db, kind, from, to, basis, account, payee)
  const e = await one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
  if (kind === 'sales-by-customer' || kind === 'expenses-by-vendor') return contactTotals(db, kind === 'sales-by-customer' ? 'customer' : 'vendor', from, to, basis)
  if (kind === 'sales-by-item') return salesByItem(db, from, to, basis)
  if (kind === 'cash-flow') return cashFlow(db, from, to)
  if (kind === 'trial-balance') return trialBalance(db, to, basis,scope)
  if (kind === 'general-ledger') return generalLedger(db, from, to, account || undefined, basis,scope)
  if ((kind === 'profit-and-loss' || kind === 'balance-sheet') && columns && columns !== 'single') return statementColumns(db, kind, columns, from, to, Number(e?.fiscal_year_start ?? 1), basis)
  if (kind === 'profit-and-loss') return profitAndLoss(db, from, to, basis)
  if (kind === 'balance-sheet') return balanceSheet(db, to, Number(e?.fiscal_year_start ?? 1), basis)
  if (kind === 'sales-tax') return salesTax(db, from, to, basis)
  if (kind === 'receivables' || kind === 'payables') return ageing(db, kind === 'receivables' ? 'receivable' : 'payable', to)
  throw new Fault(404, 'Unknown report')
}
