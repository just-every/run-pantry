// Each download uses the same read model as its displayed level. Monetary
// amounts in the CSV are exact integer cents; nested source evidence is JSON.
import type { Data } from './core'
import { BASIS_LABEL } from './basis'

const cell = (v: unknown) => `"${String(v ?? '').replaceAll('"', '""')}"`
export function figureExport(detail: Data, context: Record<string, unknown>) {
  const headings = ['Date', 'Account', 'Description', 'Record kind', 'Record ID', 'Amount (cents)', 'Figure (cents)', 'Total (cents)', 'Basis', 'From', 'To', 'Context', 'Documents', 'Bank lines']
  const label = detail.basisLabel ?? BASIS_LABEL[detail.basis as 'cash' | 'accrual']
  const rows = detail.rows.map((r: Data) => [r.date, `${r.account.code} · ${r.account.name}`, r.description, r.record.kind, r.record.id, r.amount, detail.figure, detail.total, label, detail.from ?? '', detail.to, JSON.stringify(context), JSON.stringify(r.documents), JSON.stringify(r.bank)])
  if (!rows.length) rows.push(['', '', 'No source lines', '', '', 0, detail.figure, detail.total, label, detail.from ?? '', detail.to, JSON.stringify(context), '[]', '[]'])
  return new Response([headings, ...rows].map(row => row.map(cell).join(',')).join('\r\n') + '\r\n', { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': 'attachment; filename="report-source-lines.csv"', 'cache-control': 'no-store', 'x-pantry-basis': label } })
}
export function recordExport(record: Data, context: Record<string, string>) {
  return Response.json({ context, record }, { headers: { 'content-disposition': 'attachment; filename="report-record.json"', 'cache-control': 'no-store' } })
}
