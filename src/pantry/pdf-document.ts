// Small PDF primitives. Text uses the built-in Helvetica fonts and WinAnsi;
// unsupported characters become '?', without producing invalid PDF strings.
const CP1252: Record<string, number> = { '€': 128, '‘': 145, '’': 146, '“': 147, '”': 148, '•': 149, '–': 150, '—': 151, '…': 133, '−': 45 }
const encoded = (s: string) => Array.from(s, c => CP1252[c] ?? (c.charCodeAt(0) >= 32 && c.charCodeAt(0) <= 255 && (c.charCodeAt(0) < 127 || c.charCodeAt(0) >= 160) ? c.charCodeAt(0) : 63))

export function pdfLiteral(value: string) {
  return '(' + encoded(value).map(b => [40, 41, 92].includes(b) ? '\\' + String.fromCharCode(b) : b >= 127 ? '\\' + b.toString(8).padStart(3, '0') : String.fromCharCode(b)).join('') + ')'
}

// Helvetica advance widths for printable ASCII. Bold descriptions use a
// conservative allowance in the renderer; numeric widths agree in both fonts.
const WIDTHS = [278,278,355,556,556,889,667,191,333,333,389,584,278,333,278,278,556,556,556,556,556,556,556,556,556,556,278,278,584,584,584,556,1015,667,667,722,722,667,611,778,722,278,500,667,556,833,722,778,667,778,722,667,611,722,667,944,667,667,611,278,278,278,469,556,333,556,556,500,556,556,278,556,556,222,222,500,222,833,556,556,556,556,333,500,278,556,500,722,500,500,500,334,260,334,584]
export const pdfTextWidth = (text: string, size: number) => encoded(text).reduce((sum, b) => sum + (WIDTHS[b - 32] ?? 1000), 0) * size / 1000

/** Wrap without dropping long words; preserve explicit paragraph breaks. */
export function pdfWrap(value: string, width: number, size: number): string[] {
  const lines: string[] = []
  for (const paragraph of value.split(/\r?\n/)) {
    let line = ''
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      if (line && pdfTextWidth(`${line} ${word}`, size) > width) { lines.push(line); line = '' }
      if (line) { line += ' ' + word; continue }
      for (const c of word) {
        if (line && pdfTextWidth(line + c, size) > width) { lines.push(line); line = '' }
        line += c
      }
    }
    lines.push(line)
  }
  return lines
}

/** All streams are ASCII; string lengths therefore equal PDF byte offsets. */
export function pdfDocument(pages: string[][]): Uint8Array<ArrayBuffer> {
  const font = (name: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  const objects = ['<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, font('Helvetica'), font('Helvetica-Bold')]
  pages.forEach((ops, i) => {
    const stream = ops.join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`, `<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  })
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  objects.forEach((o, i) => { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` })
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Uint8Array.from(body, c => c.charCodeAt(0))
}
