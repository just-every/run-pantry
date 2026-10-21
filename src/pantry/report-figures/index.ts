// One door for every report figure's sources: statements, ledgers and the
// grouped, comparison, budget and 1099 reports built on them.
import type { Basis } from '../basis'
import { figureDetail } from '../drilldown'
import { bridgeFigure, columnFigure } from './columns'
import { contactFigure, itemFigure } from './groups'
import { budgetFigure } from './budget'
import { contractorFigure } from './contractors'

export type FigureQuery = { report: string; line: string; from: string; to: string; basis: Basis; account?: string; columns?: string; column?: string; budget?: string; year?: string }
export async function reportFigure(db: D1Database, q: FigureQuery, startMonth: number) {
  if ((q.report === 'profit-and-loss' || q.report === 'balance-sheet') && q.columns && q.columns !== 'single') return columnFigure(db, q, startMonth)
  if (q.report === 'profit-and-loss' && q.line.startsWith('bridge:')) return bridgeFigure(db, q, startMonth)
  if (q.report === 'sales-by-customer' || q.report === 'expenses-by-vendor') return contactFigure(db, q.report, q.line, q.from, q.to, q.basis)
  if (q.report === 'sales-by-item') return itemFigure(db, q.line, q.from, q.to, q.basis)
  if (q.report === 'budget-actual') return budgetFigure(db, q)
  if (q.report === 'contractors') return contractorFigure(db, q)
  return figureDetail(db, q, startMonth)
}
