// Column exports retain each column's dates, units, basis and exact cent values.
import { xlsxResponse } from './xlsx'
import { Fault } from './core'
import { BASIS_LABEL } from './basis'
import { reportPdf } from './report-pdf'
import type { StatementColumns } from './statement-columns'

const cell = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`
export function statementExport(r: StatementColumns, business: string, format: string) {
  const title = r.kind === 'profit-and-loss' ? 'Profit and loss' : 'Balance sheet'
  const basis = BASIS_LABEL[r.basis], lines = [...r.rows, ...r.totals]
  const headers = { 'content-disposition': `attachment; filename="${r.kind}-${r.mode}-${r.to}-${r.basis}.${format}"`, 'cache-control': 'no-store', 'x-pantry-basis': basis }
  if (format === 'xlsx') return xlsxResponse([[business, title, basis, r.from, r.to], ['Account', 'Section', 'Code', 'Basis', ...r.columns.map(c => `${c.label} · ${c.from} to ${c.to} · ${c.unit === 'percent' ? '%' : 'USD'}`)], ...lines.map(l => [l.name, l.section, l.code, basis, ...l.values.map((v, i) => v === null ? 'Not comparable (prior is zero)' : r.columns[i].unit === 'percent' ? v : v / 100)])], `${r.kind}-${r.mode}-${r.to}-${r.basis}`, { 'x-pantry-basis': basis })
  if (format === 'csv') {
    const head = ['Account', 'Section', 'Code', 'Basis', ...r.columns.map(c => `${c.label} · ${c.from} to ${c.to} · ${c.unit === 'percent' ? '%' : 'USD'}`)]
    const rows = lines.map(l => [l.name, l.section, l.code, basis, ...l.values.map((v, i) => v === null ? 'Not comparable (prior is zero)' : r.columns[i].unit === 'percent' ? `${v}%` : (v / 100).toFixed(2))])
    return new Response([head, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', { headers: { ...headers, 'content-type': 'text/csv; charset=utf-8' } })
  }
  if (format === 'pdf') {
    // A long-form column layout stays legible for a twelve-month or many-customer report.
    const rows = r.columns.flatMap((c, i) => c.unit === 'percent' ? [] : lines.map(l => ({ description: `${c.label} · ${c.from} to ${c.to} · ${l.section} · ${l.code} ${l.name}`, amount: l.values[i] ?? 0 })))
    const percent = r.columns.findIndex(c => c.unit === 'percent')
    const notes = percent < 0 ? [] : lines.map(l => `${l.code} ${l.name} · Change %: ${l.values[percent] === null ? 'Not comparable (prior is zero)' : `${l.values[percent]}%`}`)
    return new Response(reportPdf({ business, title: `${title} · ${r.mode}`, basis, range: `${r.from} to ${r.to}`, rows, notes }), { headers: { ...headers, 'content-type': 'application/pdf' } })
  }
  throw new Fault(400, 'Export format is pdf, csv or xlsx')
}
