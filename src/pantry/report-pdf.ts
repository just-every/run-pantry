import { pdfDocument, pdfLiteral, pdfTextWidth, pdfWrap } from './pdf-document'

export type ReportPdfRow = { description: string; amount: number }
export type ReportPdfDocument = {
  business: string
  title: string
  basis: string
  range: string
  rows: ReportPdfRow[]
  totals?: ReportPdfRow[]
  notes?: string[]
}

/** Amounts are integer cents. Every page repeats the report identity and basis. */
export function reportPdf(doc: ReportPdfDocument): Uint8Array<ArrayBuffer> {
  const pages: string[][] = []
  let y = 738
  const page = () => pages[pages.length - 1]
  const text = (x: number, size: number, value: string, bold = false) => page().push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${pdfLiteral(value)} Tj ET`)
  const rule = () => page().push(`0.6 w 54 ${y.toFixed(2)} m 558 ${y.toFixed(2)} l S`)
  const basis = doc.basis === 'cash' ? 'Cash basis' : doc.basis === 'accrual' ? 'Accrual basis' : doc.basis
  // Bound identity space so even unusually long names leave room for data.
  const heading = (value: string, size: number, bold = false) => {
    const lines = pdfWrap(value, 450, size).slice(0, 3)
    for (const line of lines) { text(54, size, line, bold); y -= size + 4 }
  }
  const newPage = () => {
    pages.push([]); y = 738
    heading(doc.business, 10, true)
    heading(doc.title, 17, true)
    heading(basis, 10)
    heading(doc.range, 10)
    y -= 12
    text(54, 9, 'Description', true); text(520, 9, 'Amount', true)
    y -= 7; rule(); y -= 18
  }
  const room = (height: number) => { if (y - height < 58) newPage() }
  const amount = (cents: number) => {
    if (!Number.isSafeInteger(cents)) throw new Error('Report PDF amounts must be integer cents')
    const digits = String(Math.abs(cents)), dollars = (digits.slice(0, -2) || '0').replace(/\B(?=(\d{3})+(?!\d))/g, ',')
    return `${cents < 0 ? '-' : ''}$${dollars}.${digits.padStart(3, '0').slice(-2)}`
  }
  const row = (r: ReportPdfRow, bold = false) => {
    const formatted = amount(r.amount), lines = pdfWrap(r.description, 350, bold ? 11 : 10)
    // Keep normal rows together; very long rows continue line by line.
    if (lines.length <= 15) room(lines.length * 14 + 5)
    lines.forEach((line, i) => {
      room(14); text(54, 10, line, bold)
      if (i === 0) text(558 - pdfTextWidth(formatted, 10), 10, formatted, bold)
      y -= 14
    })
    y -= 5
  }
  newPage()
  for (const r of doc.rows) row(r)
  if (doc.totals?.length) { room(36); rule(); y -= 18; for (const r of doc.totals) row(r, true) }
  for (const note of doc.notes ?? []) {
    y -= 8
    for (const line of pdfWrap(note, 500, 9)) { room(13); text(54, 9, line); y -= 13 }
  }
  pages.forEach((ops, i) => ops.push(`BT /F1 8 Tf 54 34 Td ${pdfLiteral(`Page ${i + 1} of ${pages.length}`)} Tj ET`))
  return pdfDocument(pages)
}
