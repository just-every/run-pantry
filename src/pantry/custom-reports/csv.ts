// Tidy, single-table CSV for the calculated cells of one report or an ordered
// package. Each cell retains its own basis, date range and unit, including formulas.
import type { SpreadsheetCell } from '../xlsx'
import type { CalculatedCustomReport } from './types'

type CsvReport = CalculatedCustomReport
const HEAD = ['Package', 'Report order', 'Report', 'Source', 'Basis', 'From', 'To', 'Row', 'Row kind', 'Column', 'Column from', 'Column to', 'Unit', 'Value', 'Note']
const cell = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`
// Labels/notes are text in a spreadsheet, never executable formulas. Calculated
// numbers bypass this text encoding so negative amounts remain numeric.
const literal = (value: string) => /^[\s]*[=+\-@]/.test(value) ? "'" + value : value

export function customReportsRows(reports: CsvReport[], title = '', commentary: string[] = []) {
  const rows: SpreadsheetCell[][] = [HEAD]
  for (const [index, report] of reports.entries()) {
    const base = [title, index + 1, report.name, report.source, report.basisLabel, report.from, report.to]
    for (const row of report.rows) {
      if (row.kind === 'note') { rows.push([...base, '', 'note', '', '', '', 'text', '', row.text ?? '']); continue }
      for (const column of report.columns) {
        const value = row.values[column.id]
        const unit = column.unit === 'text' ? 'text' : row.kind === 'formula' && !['share', 'percent'].includes(column.id) ? row.unit : column.unit
        const display = unit === 'text' ? String(value ?? '') : value === null || value === undefined ? 'undefined'
          : unit === 'money' ? Number(value) / 100 : Number(Number(value).toFixed(2))
        rows.push([...base, row.name, row.kind, column.label, column.from ?? report.from, column.to ?? report.to,
          unit === 'money' ? 'USD' : unit, display, ''])
      }
    }
    for (const note of report.notes) rows.push([...base, '', 'note', '', '', '', 'text', '', note])
    if (!report.rows.length) rows.push([...base, '', 'note', '', '', '', 'text', '', 'No posted activity matches this report.'])
  }
  for (const note of commentary) rows.push([title, '', '', '', '', '', '', '', 'commentary', '', '', '', 'text', '', note])
  return rows
}

export function customReportsCsv(reports: CsvReport[], title = '', commentary: string[] = []) {
  return customReportsRows(reports, title, commentary).map(row => row.map((value, index) => cell(typeof value === 'number' ? index === 13 ? value.toFixed(2) : value : literal(String(value ?? '')))).join(',')).join('\r\n') + '\r\n'
}
