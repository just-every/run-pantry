import type { Context } from '../context'
import { requireThat, type Data } from '../core'
import { all, one } from '../db'
import { figureDetail } from '../drilldown'
import { calculateCustomReport } from './calculate'
import { assertReportRead, renderSavedReport, savedReport } from './store'
import type { CustomReportDrillGraph, CustomReportDrillNode, CustomReportDrillOrigin, CustomReportFigureDetail, CustomReportFigureOperand } from './types'

const START = '0000-01-01'

/** Only graph nodes reachable from this selected cell can be requested. */
function reachable(graph: CustomReportDrillGraph, root: string, target: string): boolean {
  const visited = new Set<string>(), pending = [root]
  while (pending.length) {
    const key = pending.pop()!
    if (key === target) return true
    if (visited.has(key)) continue
    visited.add(key)
    pending.push(...(graph.nodes.get(key)?.operands ?? []))
  }
  return false
}

export async function customReportFigure(c: Context, id: string, query: { row?: string; column?: string; node?: string }): Promise<CustomReportFigureDetail> {
  const rendered = await renderSavedReport(c, id)
  const row = rendered.report.rows.find(row => row.id === query.row)
  const column = rendered.report.columns.find(column => column.id === query.column)
  requireThat(row && row.kind !== 'note' && column && column.unit !== 'text', 'Choose a numeric figure in this report', 404)
  const graph: CustomReportDrillGraph = { nodes: new Map(), roots: new Map() }
  const report = await calculateCustomReport(c.db, { ...rendered.saved.definition, id }, graph)
  const root = graph.roots.get(JSON.stringify([row.id, column.id]))
  const key = query.node ?? root
  requireThat(root && key && key.length <= 2000 && reachable(graph, root, key), 'Figure operand not found', 404)
  const node = graph.nodes.get(key)
  requireThat(node, 'Figure operand not found', 404)
  const path = (key: string) => `/api/pantry/custom-reports/${encodeURIComponent(id)}/figures?${new URLSearchParams({ row: row.id, column: column.id, node: key })}`
  const operand = (key: string): CustomReportFigureOperand => {
    const node = graph.nodes.get(key)
    requireThat(node, 'Figure operand not found', 404)
    return { label: node.label, value: node.value, unit: node.unit, basis: report.basis, from: node.from, to: node.to, href: path(key), ...(node.exact ? { exact: { numerator: node.exact.numerator.toString(), denominator: node.exact.denominator.toString() } } : {}) }
  }
  const result: CustomReportFigureDetail = { ...operand(key),
    context: { reportId: id, revision: rendered.saved.revision, source: report.source, basis: report.basis, from: report.from, to: report.to, filters: rendered.saved.definition.filters ?? {}, comparison: rendered.saved.definition.comparison ?? 'single', row: row.id, column: column.id, node: key }, ...(node.expression ? { expression: node.expression } : {}),
    ...(node.exact ? { exact: { numerator: node.exact.numerator.toString(), denominator: node.exact.denominator.toString() } } : {}),
    operands: node.operands.map(operand) }
  if (node.origins) {
    const entity = await one(c.db, 'SELECT fiscal_year_start FROM pt_entity WHERE id = 1')
    const startMonth = Number(entity?.fiscal_year_start ?? 1)
    const accounts = new Map((await all(c.db, 'SELECT id, type FROM pt_accounts')).map(a => [a.id, a.type]))
    const contacts = new Map((await all(c.db, 'SELECT id, kind FROM pt_contacts')).map(a => [a.id, a.kind]))
    const native = new Map<string, Awaited<ReturnType<typeof figureDetail>>>()
    const rows: Data[] = []
    const contactSummary = report.source === 'sales-by-customer' || report.source === 'expenses-by-vendor'
    const contactKind = report.source === 'expenses-by-vendor' ? 'vendor' : 'customer'
    const originRows = async (origin: CustomReportDrillOrigin, node: CustomReportDrillNode) => {
      const type = origin.accountId ? accounts.get(origin.accountId) ?? origin.type : origin.type
      const nativeReport = report.source === 'balance-sheet' || report.source === 'trial-balance' && !['income', 'expense'].includes(type) ? 'balance-sheet' : 'profit-and-loss'
      const line = origin.accountId ?? (type === 'income' ? 'income' : 'expenses')
      const from = report.source === 'trial-balance' ? START : node.from ?? START
      const to = node.sourceTo ?? node.to
      const nativeKey = JSON.stringify([nativeReport, line, from, to, origin.dimension, origin.dimensionValue])
      let detail = native.get(nativeKey)
      if (!detail) {
        detail = await figureDetail(c.db, { report: nativeReport, line, from, to, basis: report.basis, dimension:origin.dimension,dimensionValue:origin.dimensionValue }, startMonth)
        native.set(nativeKey, detail)
      }
      const selected = origin.contactId === undefined ? detail.rows : detail.rows.filter(row => {
        // These are the same counterparty rules as the source report. In
        // particular customer columns use invoices only; vendor summaries
        // also inherit the bill/vendor-credit counterparty.
        const contact = row.contactId || (contactSummary ? row.sourceContactId : row.invoiceContactId)
        const group = contacts.get(contact) === contactKind ? contact : 'unassigned'
        return group === origin.contactId
      })
      const sign = report.source === 'trial-balance' && ['income', 'liability', 'equity'].includes(type) ? -1 : 1
      return selected.map(row => ({ ...row, amount: sign * row.amount }))
    }
    for (const origin of node.origins) rows.push(...await originRows(origin, node))
    rows.sort((a, b) => a.date.localeCompare(b.date))
    result.rows = rows
    result.total = rows.reduce((total, row) => total + row.amount, 0)
    result.ties = result.total === node.value
  }
  // A share, role, or definition change during any ledger read closes this
  // door, just as it closes the saved render and export doors.
  const current = await savedReport(c, id)
  requireThat(current.revision === rendered.saved.revision, 'Report changed; reload', 409)
  await assertReportRead(c)
  return result
}
