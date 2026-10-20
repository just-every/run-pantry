import type { Hono, Context as HonoContext } from 'hono'
import type { Bindings } from '../../auth.server'
import type { Context } from '../context'
import type { Data } from '../core'
import { one } from '../db'
import { customReportFigure } from './drill'
import { customReportPdf, managementReportPdf } from './pdf'
import { assertReportRead, renderSavedPackage, renderSavedReport, savedReport, savedReportList } from './store'
import type { CalculatedCustomReport, CustomReportLayoutRow } from './types'

type C = HonoContext<{ Bindings: Bindings }>
const pdfResponse = (bytes: Uint8Array<ArrayBuffer>, name: string) => new Response(bytes, { headers: {
  'content-type': 'application/pdf', 'content-disposition': `attachment; filename="${name}.pdf"`, 'cache-control': 'no-store',
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

export function registerCustomReportRoutes(api: Hono<{ Bindings: Bindings }>, reader: (c: C) => Promise<Context>) {
  api.get('/api/pantry/custom-reports', async c => c.json({ reports: await savedReportList(await reader(c)) }))
  api.get('/api/pantry/custom-reports/:id/figures', async c => c.json(await customReportFigure(await reader(c), c.req.param('id'), { row: c.req.query('row'), column: c.req.query('column'), node: c.req.query('node') })))
  api.get('/api/pantry/custom-reports/:id/render', async c => c.json(await renderSavedReport(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/custom-reports/:id/export.json', async c => jsonResponse(await savedReport(await reader(c), c.req.param('id')), 'pantry-custom-report'))
  api.get('/api/pantry/custom-reports/:id/export.pdf', async c => {
    const ctx = await reader(c), rendered = await renderSavedReport(ctx, c.req.param('id'))
    const business = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
    const bytes = customReportPdf(exportReport(rendered), business?.legal_name ?? '')
    await savedReport(ctx, rendered.saved.id)
    await assertReportRead(ctx)
    return pdfResponse(bytes, 'pantry-custom-report')
  })
  api.get('/api/pantry/custom-reports/:id', async c => c.json(await savedReport(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/management-packages', async c => c.json({ packages: await savedReportList(await reader(c), 'package') }))
  api.get('/api/pantry/management-packages/:id/render', async c => c.json(await renderSavedPackage(await reader(c), c.req.param('id'))))
  api.get('/api/pantry/management-packages/:id/export.json', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    return jsonResponse({ ...rendered.saved, reports: rendered.reports.map(report => report.saved) }, 'pantry-management-package')
  })
  api.get('/api/pantry/management-packages/:id/export.pdf', async c => {
    const ctx = await reader(c), rendered = await renderSavedPackage(ctx, c.req.param('id'))
    const business = await one(ctx.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
    const bytes = managementReportPdf({ business: business?.legal_name ?? '', title: rendered.saved.name,
      cover: rendered.saved.cover, commentary: [...rendered.saved.commentary, sharingNote(rendered.saved)], reports: rendered.reports.map(exportReport) })
    for (const report of rendered.reports) await savedReport(ctx, report.saved.id)
    await savedReport(ctx, rendered.saved.id, 'package')
    await assertReportRead(ctx)
    return pdfResponse(bytes, 'pantry-management-package')
  })
  api.get('/api/pantry/management-packages/:id', async c => c.json(await savedReport(await reader(c), c.req.param('id'), 'package')))
}
