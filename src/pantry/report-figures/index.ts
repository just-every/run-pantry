import { dimensionScope } from '../dimensions/scope'
// One door for every report figure's sources: statements, ledgers and the
// grouped, comparison, budget, 1099, sales tax, ageing and everyday-library reports built on them.
import { requireThat } from '../core'
import type { Basis } from '../basis'
import { figureDetail } from '../drilldown'
import { bridgeFigure, columnFigure } from './columns'
import { contactFigure, itemFigure } from './groups'
import { budgetFigure } from './budget'
import { contractorFigure } from './contractors'
import { ageingFigure } from './open-items'
import { libraryFigure } from './library'
import { salesTaxFigure } from './sales-tax'
import { isLibrary } from '../report-library'

export type FigureQuery = { report: string; line: string; from: string; to: string; basis: Basis; account?: string; columns?: string; column?: string; budget?: string; year?: string; payee?: string;dimension?:string;dimensionValue?:string }
export async function reportFigure(db: D1Database, q: FigureQuery, startMonth: number) {
  const dimension = await dimensionScope(db,q.dimension,q.dimensionValue)
  requireThat(!q.dimension||['general-ledger','trial-balance','profit-and-loss','balance-sheet','sales-by-customer','expenses-by-vendor','sales-by-item','cash-flow','sales-tax','receivables','payables','receivables-summary','payables-summary','open-invoices','unpaid-bills','customer-balances','vendor-balances','reconciliations','deposits','check-detail','contractor-summary','transactions','journal','contractors','budget-actual'].includes(q.report),'This report figure does not yet support a dimension filter',409)
  if ((q.report === 'profit-and-loss' || q.report === 'balance-sheet') && q.columns && q.columns !== 'single') return columnFigure(db, q, startMonth)
  if (q.report === 'profit-and-loss' && q.line.startsWith('bridge:')) return bridgeFigure(db, q, startMonth)
  if (q.report === 'sales-by-customer' || q.report === 'expenses-by-vendor') return contactFigure(db, q.report, q.line, q.from, q.to, q.basis, dimension)
  if (q.report === 'sales-by-item') return itemFigure(db, q.line, q.from, q.to, q.basis, dimension)
  if (q.report === 'budget-actual') return budgetFigure(db, q)
  if (q.report === 'contractors') return contractorFigure(db, q)
  if (q.report === 'sales-tax') return salesTaxFigure(db, q.line, q.from, q.to, q.basis, dimension)
  if (q.report === 'receivables' || q.report === 'payables') return ageingFigure(db, q.report, q.line, q.to, dimension)
  if (isLibrary(q.report)) return libraryFigure(db, q.report, q.line, q.from, q.to, q.basis, q.account || undefined, q.payee || undefined, dimension)
  return figureDetail(db, q, startMonth)
}
