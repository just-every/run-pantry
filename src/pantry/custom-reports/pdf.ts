import { requireThat, usd } from '../core'
import { pdfDocument, pdfLiteral, pdfTextWidth, pdfWrap } from '../pdf-document'
import type { CalculatedCustomReport, CalculatedCustomReportRow, CustomReportColumn, ManagementReportPackage, ReportUnit } from './types'

/** Composes page operations once, including management covers and commentary.
 * Every page repeats its report/package identity and the relevant basis labels.
 */
class Pages {
  readonly pages: string[][] = []
  y = 738
  private heading: string[] = []
  private repeat: (() => void) | undefined
  constructor(private business: string) {}
  text(x: number, y: number, size: number, value: string, bold = false) {
    this.pages[this.pages.length - 1].push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfLiteral(value)} Tj ET`)
  }
  rule() { this.pages[this.pages.length - 1].push(`0.5 w 54 ${this.y.toFixed(2)} m 558 ${this.y.toFixed(2)} l S`) }
  start(heading: string[], repeat?: () => void) { this.heading = heading; this.repeat = repeat; this.newPage() }
  newPage() {
    this.pages.push([]); this.y = 738
    for (const [index, value] of [this.business, ...this.heading].entries()) {
      const size = index === 1 ? 15 : 9
      for (const line of pdfWrap(value, 500, size)) { this.text(54, this.y, size, line, index <= 1); this.y -= size + 4 }
    }
    this.y -= 10; this.rule(); this.y -= 17
    requireThat(this.y > 260, 'PDF identity is too long; shorten the business, report or package name')
    this.repeat?.()
  }
  room(height: number) { if (this.y - height < 58) this.newPage() }
  paragraph(value: string, bold = false, size = 10) {
    for (const line of pdfWrap(value, 500, size)) { this.room(size + 5); this.text(54, this.y, size, line, bold); this.y -= size + 5 }
    this.y -= 6
  }
  finish(): Uint8Array<ArrayBuffer> {
    this.pages.forEach((ops, index) => ops.push(`BT /F1 8 Tf 54 34 Td ${pdfLiteral(`Page ${index + 1} of ${this.pages.length}`)} Tj ET`))
    return pdfDocument(this.pages)
  }
}

function valueOf(row: CalculatedCustomReportRow, column: CustomReportColumn): string {
  const value = row.values[column.id]
  if (column.unit === 'text') return typeof value === 'string' ? value : ''
  if (value === null || value === undefined) return 'undefined'
  requireThat(typeof value === 'number' && Number.isFinite(value), 'PDF requires calculated numeric report values')
  const unit: ReportUnit = row.kind === 'formula' && !['share', 'percent'].includes(column.id) ? row.unit : column.unit
  if (unit === 'money') { requireThat(Number.isSafeInteger(value), 'PDF money must be integer cents'); return usd(value) }
  return value.toFixed(2) + (unit === 'percent' ? '%' : ' ratio')
}

function renderReport(pages: Pages, report: CalculatedCustomReport) {
  requireThat(report.columns.length > 0, 'Choose report columns for the PDF')
  const text = report.columns.filter(column => column.unit === 'text')
  const numeric = report.columns.filter(column => column.unit !== 'text')
  // Repeat the selected identity columns beside each narrow band of financial
  // columns, keeping monthly/customer reports readable on letter-size pages.
  const bands: CustomReportColumn[][] = []
  const bandSize = text.some(c => c.id === 'name') ? 3 : 4
  if (numeric.length === 0) bands.push(text)
  for (let i = 0; i < numeric.length; i += bandSize) bands.push([...text, ...numeric.slice(i, i + bandSize)])
  for (const [bandIndex, columns] of bands.entries()) {
    const textWidth = text.length === 2 ? 236 : text[0]?.id === 'name' ? 196 : text.length ? 66 : 0
    const numericWidth = (504 - textWidth) / Math.max(1, columns.length - text.length)
    const widths = columns.map(column => column.unit === 'text' ? column.id === 'code' ? 56 : text.length === 2 ? 180 : 196 : numericWidth)
    if (numeric.length === 0) {
      if (columns.length === 1) widths[0] = 504
      else widths[widths.length - 1] += 504 - widths.reduce((a, b) => a + b, 0)
    }
    const labels = columns.map((column, index) => pdfWrap(column.label + (column.from && column.id !== 'amount' ? `\n${column.from} to ${column.to}` : ''), widths[index] - 12, 8))
    const headHeight = Math.max(...labels.map(lines => lines.length)) * 11 + 10
    const tableHeading = () => {
      let x = 54
      columns.forEach((_, index) => {
        labels[index].forEach((line, lineIndex) => pages.text(x + 3, pages.y - lineIndex * 11, 8, line, true))
        x += widths[index]
      })
      pages.y -= headHeight; pages.rule(); pages.y -= 15
    }
    pages.start([report.name, `Source: ${report.source}${report.id ? ` | Report ID: ${report.id}` : ''}`, report.basisLabel, report.range, ...(bands.length > 1 ? [`Columns ${bandIndex + 1} of ${bands.length}`] : [])], tableHeading)
    for (const row of report.rows) {
      if (row.kind === 'note') { pages.paragraph(row.text ?? '', false, 9); continue }
      const formatted = columns.map(column => valueOf(row, column))
      const lines = formatted.map((value, index) => pdfWrap(value, widths[index] - 12, 9))
      const count = Math.max(1, ...lines.map(value => value.length))
      const bold = row.kind === 'section' || row.kind === 'formula'
      if (count <= 12) pages.room(count * 13 + 8)
      for (let lineIndex = 0; lineIndex < count; lineIndex++) {
        pages.room(13)
        let x = 54
        columns.forEach((column, index) => {
          const value = lines[index][lineIndex] ?? ''
          const left = column.unit === 'text' ? x + 3 : x + widths[index] - 9 - pdfTextWidth(value, 9)
          pages.text(left, pages.y, 9, value, bold); x += widths[index]
        })
        pages.y -= 13
      }
      pages.y -= 8
    }
    if (report.rows.length === 0) pages.paragraph('No posted activity matches this report.')
    // Notes and formula units are not swallowed by the chosen numeric bands.
    if (bandIndex === bands.length - 1) {
      for (const note of report.notes) pages.paragraph(note, false, 9)
      if (report.rows.some(row => row.kind === 'formula')) pages.paragraph('Formula money values are USD. Ratios and percentages are labelled in each cell. Undefined means a formula has no defined result, including division by zero.', false, 8)
    }
  }
}

export function customReportPdf(report: CalculatedCustomReport, business: string): Uint8Array<ArrayBuffer> {
  const pages = new Pages(business)
  renderReport(pages, report)
  return pages.finish()
}

export function managementReportPdf(document: ManagementReportPackage): Uint8Array<ArrayBuffer> {
  requireThat(document.reports.length > 0, 'Choose at least one report for the management package')
  requireThat(document.title.trim().length > 0 && document.title.length <= 200, 'Management package title needs 1–200 characters')
  const pages = new Pages(document.business)
  const bases = [...new Set(document.reports.map(report => report.basisLabel))].join(' | ')
  const identity = [document.title, 'Management report package', bases]
  pages.start(identity)
  if (document.cover) pages.paragraph(document.cover)
  pages.paragraph('Included reports', true, 12)
  for (const [index, report] of document.reports.entries()) pages.paragraph(`${index + 1}. ${report.name}${report.id ? ` (${report.id})` : ''} | ${report.basisLabel} | ${report.range}`)
  for (const report of document.reports) renderReport(pages, report)
  if (document.commentary?.length) {
    pages.start([document.title, 'Management commentary', bases])
    for (const paragraph of document.commentary) pages.paragraph(paragraph)
  }
  return pages.finish()
}
