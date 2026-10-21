// Tidy, single-table CSV for the calculated cells of one report or an ordered
// package. Each cell retains its own basis, date range and unit, including formulas.
import type { CalculatedCustomReport } from './types'

type CsvReport = CalculatedCustomReport
const HEAD = ['Package', 'Report order', 'Report', 'Source', 'Basis', 'From', 'To', 'Row', 'Row kind', 'Column', 'Column from', 'Column to', 'Unit', 'Value', 'Note']
const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
// Labels/notes are text in a spreadsheet, never executable formulas. Calculated
// numbers bypass this text encoding so negative amounts remain numeric.
const literal = (value: string) => /^[\s]*[=+\-@]/.test(value) ? "'" + value : value

export function customReportsCsv(reports: CsvReport[], title = '', commentary: string[] = []) {
  const rows: unknown[][] = [HEAD]
  for (const [index, report] of reports.entries()) {
    const base = [literal(title), index + 1, literal(report.name), report.source, report.basisLabel, report.from, report.to]
    for (const row of report.rows) {
      if (row.kind === 'note') { rows.push([...base, '', 'note', '', '', '', 'text', '', literal(row.text ?? '')]); continue }
      for (const column of report.columns) {
        const value = row.values[column.id]
        const unit = column.unit === 'text' ? 'text' : row.kind === 'formula' && !['share', 'percent'].includes(column.id) ? row.unit : column.unit
        const display = unit === 'text' ? literal(String(value ?? '')) : value === null || value === undefined ? 'undefined'
          : unit === 'money' ? (Number(value) / 100).toFixed(2) : Number(value).toFixed(2)
        rows.push([...base, literal(row.name), row.kind, literal(column.label), column.from ?? report.from, column.to ?? report.to,
          unit === 'money' ? 'USD' : unit, display, ''])
      }
    }
    for (const note of report.notes) rows.push([...base, '', 'note', '', '', '', 'text', '', literal(note)])
    if (!report.rows.length) rows.push([...base, '', 'note', '', '', '', 'text', '', 'No posted activity matches this report.'])
  }
  for (const note of commentary) rows.push([literal(title), '', '', '', '', '', '', '', 'commentary', '', '', '', 'text', '', literal(note)])
  return rows.map(row => row.map(cell).join(',')).join('\r\n') + '\r\n'
}
