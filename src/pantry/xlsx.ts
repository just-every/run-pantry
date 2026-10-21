// Minimal Office Open XML workbook. Text is always an inline string, never a
// spreadsheet formula; calculated values remain numbers that Excel can sum.
import { requireThat } from './core'
import { zip } from './zip'

export type SpreadsheetCell = string | number | null
const XML = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main'
const escape = (value: string) => value.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\ufffe\uffff]/g, '')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll('\r', '&#13;')
function column(index: number): string {
  let name = ''
  for (let n = index + 1; n; n = Math.floor((n - 1) / 26)) name = String.fromCharCode(65 + (n - 1) % 26) + name
  return name
}
export function workbook(rows: SpreadsheetCell[][]): Uint8Array<ArrayBuffer> {
  requireThat(rows.length <= 1_048_576 && rows.every(row => row.length <= 16_384), 'This report exceeds Excel worksheet limits', 409)
  const sheet = rows.map((row, y) => `<row r="${y + 1}">${row.map((value, x) => {
    const ref = `${column(x)}${y + 1}`
    if (value === null) return `<c r="${ref}"/>`
    if (typeof value === 'number') {
      requireThat(Number.isFinite(value), 'A report value cannot be represented in Excel', 409)
      return `<c r="${ref}" s="1"><v>${value}</v></c>`
    }
    requireThat(value.length <= 32_767, 'A report text cell exceeds Excel limits', 409)
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escape(value)}</t></is></c>`
  }).join('')}</row>`).join('')
  return zip([
    { name: '[Content_Types].xml', data: XML + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>' },
    { name: '_rels/.rels', data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', data: XML + `<workbook xmlns="${NS}" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Report" sheetId="1" r:id="rId1"/></sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', data: XML + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>' },
    { name: 'xl/styles.xml', data: XML + `<styleSheet xmlns="${NS}"><fonts count="1"><font><sz val="11"/><name val="Calibri"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border/></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>` },
    { name: 'xl/worksheets/sheet1.xml', data: XML + `<worksheet xmlns="${NS}"><sheetData>${sheet}</sheetData></worksheet>` },
  ])
}
export const XLSX_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
export function xlsxResponse(rows: SpreadsheetCell[][], filename: string, extra: Record<string, string> = {}) {
  return new Response(workbook(rows), { headers: { ...extra, 'content-type': XLSX_TYPE,
    'content-disposition': `attachment; filename="${filename}.xlsx"`, 'cache-control': 'no-store' } })
}
