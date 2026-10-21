import { xlsxResponse } from '../xlsx'
import { Fault } from '../core'
import { one } from '../db'
import { reportPdf } from '../report-pdf'
import type { LibraryReport } from './types'
const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
export async function libraryExport(db: D1Database, report: LibraryReport, format: string) {
  const headers = { 'content-disposition': `attachment; filename="${report.kind}-${report.to}.${format}"`, 'cache-control': 'no-store', 'x-pantry-basis': report.basisLabel }
  const display = (v: string | number, i: number) => report.moneyColumns.includes(i) ? (Number(v) / 100).toFixed(2) : String(v)
  if (format === 'xlsx') return xlsxResponse([[report.title, report.basisLabel, report.from, report.to], [report.note], report.columns, ...report.rows.map(r => r.cells.map((v, i) => report.moneyColumns.includes(i) ? Number(v) / 100 : v)), ...report.totals.map(t => [t.label, t.amount / 100])], `${report.kind}-${report.to}`, { 'x-pantry-basis': report.basisLabel })
  if (format === 'csv') {
    const rows = [[report.title, report.basisLabel, report.from, report.to], [report.note], report.columns, ...report.rows.map(r => r.cells.map(display)), ...report.totals.map(t => [t.label, (t.amount / 100).toFixed(2)])]
    return new Response(rows.map(r => r.map(cell).join(',')).join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' } })
  }
  if (format === 'pdf') {
    const business = await one(db, 'SELECT legal_name FROM pt_entity WHERE id=1')
    const rows = report.rows.flatMap(r => {
      const description = r.cells.filter((_, i) => !report.moneyColumns.includes(i)).join(' · ')
      // Repeat a label for each monetary column rather than dropping secondary figures.
      return report.moneyColumns.length ? report.moneyColumns.map(i => ({ description: `${description} · ${report.columns[i]}`, amount: Number(r.cells[i]) })) : [{ description, amount: 0 }]
    })
    return new Response(reportPdf({ business: business?.legal_name ?? 'Pantry', title: report.title, basis: report.basisLabel, range: `${report.from} to ${report.to}`, rows, totals: report.totals.map(t => ({ description: t.label, amount: t.amount })), notes: [report.note] }), { headers: { ...headers, 'content-type': 'application/pdf' } })
  }
  throw new Fault(400, 'Export format is pdf, csv or xlsx')
}
