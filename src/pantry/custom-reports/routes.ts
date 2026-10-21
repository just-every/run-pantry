import { who } from '../access'
import { narrow, projectAccess } from '../access-policy/doors'
import { reportBasis } from '../basis'
import { recordReportIssue } from '../effects/issues'
import { FIRST_DAY } from '../report-sources'
import { xlsxResponse } from '../xlsx'
import { customReportsCsv, customReportsRows } from './csv'
import type { Hono, Context as HonoContext } from 'hono'
import type { Bindings } from '../../auth.server'
import type { Context } from '../context'
import { requireThat, type Data } from '../core'
import { figureExport } from '../detail-export'
import { one } from '../db'
import { customReportFigure } from './drill'
import { customReportPdf, managementReportPdf } from './pdf'
import { assertReportRead, renderSavedPackage, renderSavedReport, savedReport, savedReportList } from './store'
import type { CalculatedCustomReport, CustomReportLayoutRow } from './types'

type C = HonoContext<{ Bindings: Bindings }>
const pdfResponse = (bytes: Uint8Array<ArrayBuffer>, name: string) => new Response(bytes, { headers: {
  'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"`, 'cache-control': 'no-store',
} })
const csvResponse = (csv: string, name: string) => new Response(csv, { headers: {
  'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}.csv"`, 'cache-control': 'no-store',
} })
const sharingNote = (saved: Data) => saved.shared_roles.length
  ? `Sharing: ${saved.shared_roles.join(', ')} (read/export only); creator and owner can read/edit.`
  : 'Sharing: personal (creator + owner can read/edit).'
function exportReport(rendered: { saved: Data; report: CalculatedCustomReport }): CalculatedCustomReport {
  const formulas = (rendered.saved.definition.layout ?? []).filter((row: CustomReportLayoutRow) => row.kind === 'formula')
    .map((row: Data) => `Formula ${row.label}: ${row.expression} (${row.unit})`)
  return { ...rendered.report, notes: [...rendered.report.notes, ...formulas, sharingNote(rendered.saved)] }
}
const jsonResponse = (saved: Data, filename: string) => new Response(JSON.stringify(saved, null, 2), { headers: {
  'content-type': 'application/json; charset=utf-8', 'content-disposition': `attachment; filename="${filename}.json"`, 'cache-control': 'no-store',
} })

// Build the complete file first; only a successfully generated export is an
// issued copy. Reads and on-screen renders never add issuance records.
const nativeSources = new Set(['profit-and-loss', 'balance-sheet', 'trial-balance'])
async function issuedReport(ctx: Context, saved: Data, response: Response, scope?: Data) {
  const current = await savedReport(ctx, saved.id)
  requireThat(current.revision === saved.revision, 'Report changed; reload', 409)
  await assertReportRead(ctx)
  const d = scope ?? saved.definition, basis = await reportBasis(ctx.db, d.basis)
  await recordReportIssue(ctx.db, who(ctx.actor), { kind: 'custom-report', name: saved.name,
    from: d.from, to: d.to, basis, definition: { ...saved.definition, basis },
    ...(scope?.customFigure ? { customFigure: scope.customFigure } : {}),
    ...(nativeSources.has(d.source) ? { report: d.source } : {}) })
  const final = await savedReport(ctx, saved.id)
  requireThat(final.revision === saved.revision, 'Report changed; reload', 409)
  await assertReportRead(ctx)
  return response
}
async function issuedPackage(ctx: Context, rendered: Awaited<ReturnType<typeof renderSavedPackage>>, response: Response) {
  for (const { saved } of rendered.reports) {
    const current = await savedReport(ctx, saved.id)
    requireThat(current.revision === saved.revision, 'Report changed; reload', 409)
  }
  const current = await savedReport(ctx, rendered.saved.id, 'package')
  requireThat(current.revision === rendered.saved.revision, 'Management package changed; reload', 409)
  await assertReportRead(ctx)
  // Freeze every constituent's own range, formulas and resolved basis. A
  // later definition edit cannot change what this issued package represented.
  await recordReportIssue(ctx.db, who(ctx.actor), {
    kind: 'management-package', name: rendered.saved.name,
    from: rendered.reports.map(r => r.report.from).sort()[0], to: rendered.reports.map(r => r.report.to).sort().at(-1)!,
    basis: rendered.reports[0].report.basis,
    definitions: rendered.reports.map(r => ({ ...r.saved.definition, basis: r.report.basis })),
  })
  for (const { saved } of rendered.reports) {
    const final = await savedReport(ctx, saved.id)
    requireThat(final.revision === saved.revision, 'Report changed; reload', 409)
  }
  const final = await savedReport(ctx, rendered.saved.id, 'package')
  requireThat(final.revision === rendered.saved.revision, 'Management package changed; reload', 409)
  await assertReportRead(ctx)
  return response
}

/** A permitted customer/vendor total does not grant its bank, payment or
 * journal evidence. Keep complete source totals; refuse a figure rather than
 * returning a subset when an underlying business record is outside the role. */
async function figureForReader(ctx: Context, detail: Awaited<ReturnType<typeof customReportFigure>>) {
  if (!narrow(ctx.actor) || !detail.rows) return projectAccess(ctx, detail)
  const recordKind = ctx.actor.kind === 'person' && ctx.actor.role === 'sales' ? 'invoice' : 'bill'
  requireThat(detail.rows.every(row => row.record?.kind === recordKind), 'Figure not found', 404)
  return projectAccess(ctx, { ...detail, rows: detail.rows.map(row => ({
    key: row.key, date: row.date, account: row.account, amount: row.amount, debit: row.debit, credit: row.credit,
    description: row.description, lineMemo: row.lineMemo, record: row.record, bank: [], documents: [],
  })) }) as Promise<typeof detail>
}

export function registerCustomReportRoutes(api: Hono<{ Bindings: Bindings }>, reader: (c: C) => Promise<Context>) {
  api.get('/api/pantry/custom-reports', async c => c.json({ reports: await savedReportList(await reader(c)) }))
  api.get('/api/pantry/custom-reports/:id/figures/export', async c => {
    const ctx = await reader(c), detail = await figureForReader(ctx, await customReportFigure(ctx, c.req.param('id'), { row: c.req.query('row'), column: c.req.query('column'), node: c.req.query('node') }))
    const format = c.req.query('format') ?? 'json'
    requireThat(format === 'json' || format === 'csv', 'Choose JSON or source CSV')
    requireThat(format === 'json' || detail.rows !== undefined, 'This derived figure exports as JSON with its operands; open an operand for source CSV')
    const response = format === 'json' ? jsonResponse(detail, 'pantry-report-figure') : figureExport({ ...detail, figure: detail.value }, detail.context)
    const saved = await savedReport(ctx, c.req.param('id'))
    requireThat(saved.revision === detail.context.revision, 'Report changed; reload', 409)
    return issuedReport(ctx, saved, response, { ...detail.context, from: detail.from ?? FIRST_DAY, to: detail.to, basis: detail.basis,
      customFigure: { row: detail.context.row, column: detail.context.column, node: detail.context.node } })
  })
  api.get('/api/pantry/custom-reports/:id/figures', async c => {
    const ctx = await reader(c)
    return c.json(await figureForReader(ctx, await customReportFigure(ctx, c.req.param('id'), { row: c.req.query('row'), column: c.req.query('column'), node: c.req.query('node') })))
  })
  api.get('/api/pantry/custom-reports/:id/render', async c => c.json(await renderSavedReport(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/custom-reports/:id/export.json', async c => {
    const ctx = await reader(c), saved = await savedReport(ctx, c.req.param('id'))
    return issuedReport(ctx, saved, jsonResponse(saved, 'pantry-custom-report'))
  })
  api.get('/api/pantry/custom-reports/:id/export.csv', async c => {
    const ctx = await reader(c), rendered = await renderSavedReport(ctx, c.req.param('id'))
    const csv = customReportsCsv([exportReport(rendered)])
    await savedReport(ctx, rendered.saved.id)
    await assertReportRead(ctx)
    return issuedReport(ctx, rendered.saved, csvResponse(csv, 'pantry-custom-report'), rendered.report)
  })
  api.get('/api/pantry/custom-reports/:id/export.xlsx', async c => {
    const ctx = await reader(c), rendered = await renderSavedReport(ctx, c.req.param('id'))
    const rows = customReportsRows([exportReport(rendered)])
    await savedReport(ctx, rendered.saved.id)
    await assertReportRead(ctx)
    return issuedReport(ctx, rendered.saved, xlsxResponse(rows, 'pantry-custom-report', { 'x-pantry-basis': rendered.report.basisLabel }), rendered.report)
  })
  api.get('/api/pantry/custom-reports/:id/export.pdf', async c => {
    const ctx = await reader(c), rendered = await renderSavedReport(ctx, c.req.param('id'))
    const business = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
    const bytes = customReportPdf(exportReport(rendered), business?.legal_name ?? '')
    await savedReport(ctx, rendered.saved.id)
    await assertReportRead(ctx)
    return issuedReport(ctx, rendered.saved, pdfResponse(bytes, 'pantry-custom-report'), rendered.report)
  })
  api.get('/api/pantry/custom-reports/:id', async c => c.json(await savedReport(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/management-packages', async c => c.json({ packages: await savedReportList(await reader(c), 'package') }))
  api.get('/api/pantry/management-packages/:id/render', async c => c.json(await renderSavedPackage(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/management-packages/:id/export.json', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    return issuedPackage(ctx, rendered, jsonResponse({ ...rendered.saved, reports: rendered.reports.map(report => report.saved) }, 'pantry-management-package'))
  })
  api.get('/api/pantry/management-packages/:id/export.csv', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    const csv = customReportsCsv(rendered.reports.map(exportReport), rendered.saved.name,
      [rendered.saved.cover, ...rendered.saved.commentary, sharingNote(rendered.saved)].filter(Boolean))
    for (const report of rendered.reports) await savedReport(ctx, report.saved.id)
    await savedReport(ctx, rendered.saved.id, 'package')
    await assertReportRead(ctx)
    return issuedPackage(ctx, rendered, csvResponse(csv, 'pantry-management-package'))
  })
  api.get('/api/pantry/management-packages/:id/export.xlsx', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    const rows = customReportsRows(rendered.reports.map(exportReport), rendered.saved.name,
      [rendered.saved.cover, ...rendered.saved.commentary, sharingNote(rendered.saved)].filter(Boolean))
    for (const report of rendered.reports) await savedReport(ctx, report.saved.id)
    await savedReport(ctx, rendered.saved.id, 'package')
    await assertReportRead(ctx)
    return issuedPackage(ctx, rendered, xlsxResponse(rows, 'pantry-management-package'))
  })
  api.get('/api/pantry/management-packages/:id/export.pdf', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    const business = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
    const bytes = managementReportPdf({ business: business?.legal_name ?? '', title: rendered.saved.name,
      cover: rendered.saved.cover, commentary: [...rendered.saved.commentary, sharingNote(rendered.saved)], reports: rendered.reports.map(exportReport) })
    for (const report of rendered.reports) await savedReport(ctx, report.saved.id)
    await savedReport(ctx, rendered.saved.id, 'package')
    await assertReportRead(ctx)
    return issuedPackage(ctx, rendered, pdfResponse(bytes, 'pantry-management-package'))
  })
  api.get('/api/pantry/management-packages/:id', async c => c.json(await savedReport(await reader(c), c.req.param('id'), 'package')))
}
