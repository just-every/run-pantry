// A financial export issues a report/package to its reader. The immutable audit record
// remembers its scope so later corrections can name that exact issued copy.
import { all, audit, one, run, type AuditActor } from '../db'
import { date, requireThat, text, type Data } from '../core'
import type { Basis } from '../basis'
import { figuresDiffer, reportFigures, type FiguresReader } from './reports'
import { readReport } from '../report-reader'
import { budgetReport } from '../budgets/report'
import { calculateCustomReport } from '../custom-reports/calculate'
import type { CustomReportDefinition, CustomReportDrillGraph } from '../custom-reports/types'
import { reportFigure, type FigureQuery } from '../report-figures'

export type ReportIssue = { kind: string; name: string; from: string; to: string; basis: Basis; report?: string; reports?: string[]; account?: string; payee?: string; columns?: string;dimension?:string;dimensionValue?:string; budgetId?: string; definition?: CustomReportDefinition; definitions?: CustomReportDefinition[]; figure?: FigureQuery; customFigure?: { row: string; column: string; node?: string } }
// Activity is audit history, not a ledger-derived financial report. Recording
// its own export as a financial issue would change the very history exported.
const auditHistory = (issue: ReportIssue) => issue.report === 'audit-log' || issue.figure?.report === 'audit-log'
export async function recordReportIssue(db: D1Database, actor: AuditActor, issue: ReportIssue) {
  if (auditHistory(issue)) return
  const from = date(issue.from), to = date(issue.to)
  requireThat(from <= to, 'Report range is reversed')
  // A later edit of a saved report or business basis must never change which
  // definition/range an already issued copy represented.
  const freeze = (d: CustomReportDefinition) => ({ ...d, basis: d.basis ?? issue.basis })
  await run(db, [audit(actor, 'report.issued', issue.kind, `${from}:${to}`, { ...issue, name: text(issue.name, 'Report name', 300), from, to,
    ...(issue.definition ? { definition: freeze(issue.definition) } : {}), ...(issue.definitions ? { definitions: issue.definitions.map(freeze) } : {}) })])
}

const PROPERTY: Record<string, string> = { 'trial-balance': 'trialBalance', 'profit-and-loss': 'profitAndLoss', 'balance-sheet': 'balanceSheet', 'cash-flow': 'cashFlow', 'sales-tax': 'salesTax', contractors: 'contractors', 'general-ledger': 'generalLedger' }
export async function affectedIssues(db: D1Database, projected: D1Database, earliest: string, figures: FiguresReader = reportFigures) {
  const records = await all(db, "SELECT id, at, actor_email, subject_kind, detail FROM pt_audit WHERE action = 'report.issued' ORDER BY at, id")
  const out: Data[] = []
  for (const record of records) {
    const issue = JSON.parse(record.detail) as ReportIssue
    if (auditHistory(issue)) continue
    const sources = issue.report ? [issue.report] : issue.reports
    const definitions = issue.definition ? [issue.definition] : issue.definitions
    const latest = issue.figure?.report === 'contractors' ? `${issue.figure.year ?? issue.figure.to.slice(0, 4)}-12-31` : definitions?.length ? definitions.map(d => d.to).sort().at(-1)! : issue.to
    if (latest < earliest && !sources?.some(source => source === 'contractors' || source === 'contractor-summary')) continue
    let changed = false
    if (definitions?.length) {
      for (const definition of definitions) {
        const custom = issue.customFigure
        if (custom) {
          const selected = async (source: D1Database) => {
            const graph: CustomReportDrillGraph = { nodes: new Map(), roots: new Map() }
            await calculateCustomReport(source, definition, graph)
            const node = graph.nodes.get(custom.node ?? graph.roots.get(JSON.stringify([custom.row, custom.column])) ?? '')
            requireThat(node, 'Issued custom report figure is unavailable', 409)
            return { value: node.value, unit: node.unit, from: node.from, to: node.to, origins: node.origins,
              operands: node.operands.map(key => { const operand = graph.nodes.get(key)!; return { value: operand.value, unit: operand.unit, from: operand.from, to: operand.to, origins: operand.origins } }) }
          }
          const [before, after] = await Promise.all([selected(db), selected(projected)])
          changed ||= figuresDiffer(before, after)
          continue
        }
        const [before, after] = await Promise.all([calculateCustomReport(db, definition), calculateCustomReport(projected, definition)])
        const financial = (r: Awaited<ReturnType<typeof calculateCustomReport>>) => ({ source: r.source, basis: r.basis, from: r.from, to: r.to, columns: r.columns, rows: r.rows.filter(row => row.kind !== 'note').map(row => ({ id: row.id, kind: row.kind, unit: row.unit, values: row.values })) })
        changed ||= figuresDiffer(financial(before), financial(after))
      }
    } else if (issue.figure) {
      const entity = await one(db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
      const [before, after] = await Promise.all([reportFigure(db, issue.figure, Number(entity?.fiscal_year_start ?? 1)), reportFigure(projected, issue.figure, Number(entity?.fiscal_year_start ?? 1))])
      const financial = (r: Data) => ({ figure: r.figure, total: r.total, unit: r.unit, from: r.from, to: r.to, operands: r.operands,
        rows: r.rows?.map((row: Data) => ({ date: row.date, amount: row.amount, debit: row.debit, credit: row.credit, description: row.description, lineMemo: row.lineMemo })) })
      changed = figuresDiffer(financial(before), financial(after))
    } else if (issue.budgetId) {
      const [before, after] = await Promise.all([budgetReport(db, issue.budgetId, issue.from, issue.to, issue.basis,{dimension:issue.dimension,dimensionValue:issue.dimensionValue}), budgetReport(projected, issue.budgetId, issue.from, issue.to, issue.basis,{dimension:issue.dimension,dimensionValue:issue.dimensionValue})])
      changed = figuresDiffer(before, after)
    } else if (sources?.length) {
      for (const source of sources) {
        const key = PROPERTY[source]
        if (key && !issue.account && !issue.payee && !issue.columns && !issue.dimension) {
          const [before, after] = await Promise.all([figures(db, issue.from, issue.to, issue.basis), figures(projected, issue.from, issue.to, issue.basis)])
          changed ||= figuresDiffer((before as Data)[key], (after as Data)[key])
        } else {
          // Library reports and source-filtered exports use their own native
          // calculation, including all current report families. Unsupported
          // source names fail visibly instead of being silently ignored.
          const scope = { from: issue.from, to: issue.to, basis: issue.basis, account: issue.account, payee: issue.payee, columns: issue.columns,dimension:issue.dimension,dimensionValue:issue.dimensionValue }
          const [before, after] = await Promise.all([readReport(db, source, scope), readReport(projected, source, scope)])
          changed ||= figuresDiffer(before, after)
        }
      }
    } else {
      const [before, after] = await Promise.all([figures(db, issue.from, issue.to, issue.basis), figures(projected, issue.from, issue.to, issue.basis)])
      changed = Object.keys(before).filter(k => k !== 'contractors').some(k => figuresDiffer((before as Data)[k], (after as Data)[k]))
    }
    if (changed) out.push({ id: record.id, at: record.at, issuedBy: record.actor_email, ...issue })
  }
  return out
}
