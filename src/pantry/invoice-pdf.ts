// The invoice as a PDF: the same facts the customer page shows, set in the
// standard Helvetica fonts so the file needs no embedded font. Text outside
// Windows-1252 is replaced; long invoices continue onto further pages.
export type InvoiceDocument = {
  business: string
  title: string
  facts: [string, string][]
  lines: { description: string; quantity: string; amount: string }[]
  totals: [string, string][]
  notes: string[]
}

// Windows-1252 bytes for the punctuation an invoice uses outside Latin-1.
const CP1252: Record<string, number> = { '€': 0x80, '‘': 0x91, '’': 0x92, '“': 0x93, '”': 0x94, '•': 0x95, '–': 0x96, '—': 0x97, '…': 0x85, '−': 0x2d }

function encode(text: string): number[] {
  const out: number[] = []
  for (const ch of text) {
    const code = ch.codePointAt(0)!
    out.push(CP1252[ch] ?? (code >= 0x20 && code <= 0xff && (code < 0x7f || code >= 0xa0) ? code : 0x3f))
  }
  return out
}

/** A PDF string literal: (…) with its delimiters escaped. */
function literal(text: string) {
  return '(' + encode(text).map(b => b === 0x28 || b === 0x29 || b === 0x5c ? '\\' + String.fromCharCode(b) : b < 0x80 ? String.fromCharCode(b) : '\\' + b.toString(8).padStart(3, '0')).join('') + ')'
}

// Advance widths (per 1000 em) of the characters amounts use; Helvetica and
// Helvetica-Bold agree on these. Right-aligned text is otherwise approximate.
const FIGURE: Record<string, number> = { '0': 556, '1': 556, '2': 556, '3': 556, '4': 556, '5': 556, '6': 556, '7': 556, '8': 556, '9': 556, '$': 556, ',': 278, '.': 278, '-': 333, ' ': 278 }
const figureWidth = (text: string, size: number) => [...text].reduce((w, ch) => w + (FIGURE[ch] ?? 600), 0) * size / 1000

/** Wrap at roughly `max` characters on word boundaries. */
function wrap(text: string, max: number): string[] {
  const words = text.split(/\s+/).filter(Boolean), lines: string[] = []
  let line = ''
  for (const w of words) {
    if (line && (line + ' ' + w).length > max) { lines.push(line); line = '' }
    line = line ? line + ' ' + w : w.slice(0, max * 2)
  }
  if (line) lines.push(line)
  return lines.length ? lines : ['']
}

export function invoicePdf(doc: InvoiceDocument): Uint8Array<ArrayBuffer> {
  const W = 612, H = 792, M = 54, pages: string[][] = [[]]
  let y = H - M
  const page = () => pages[pages.length - 1]
  const text = (x: number, size: number, value: string, bold = false) => page().push(`BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td ${literal(value)} Tj ET`)
  const right = (xr: number, size: number, value: string, bold = false) => text(xr - figureWidth(value, size), size, value, bold)
  const rule = () => page().push(`0.75 w ${M} ${y.toFixed(2)} m ${W - M} ${y.toFixed(2)} l S`)
  const room = (needed: number) => { if (y - needed < M) { pages.push([]); y = H - M } }

  text(M, 11, doc.business, true); y -= 30
  text(M, 22, doc.title, true); y -= 26
  for (const [k, v] of doc.facts) { text(M, 10, k); text(M + 110, 10, v); y -= 15 }
  y -= 16
  text(M, 9, 'Description', true); right(W - M - 110, 9, 'Quantity', true); right(W - M, 9, 'Amount', true); y -= 6; rule(); y -= 16
  for (const l of doc.lines) {
    const rows = wrap(l.description, 62)
    room(rows.length * 13 + 6)
    rows.forEach((r, i) => { text(M, 10, r); if (i === 0) { right(W - M - 110, 10, l.quantity); right(W - M, 10, l.amount) } y -= 13 })
    y -= 4
  }
  room(24 + doc.totals.length * 16); y += 6; rule(); y -= 18
  for (const [k, v] of doc.totals) { text(W - M - 230, 10, k, k === 'Amount due'); right(W - M, 10, v, k === 'Amount due'); y -= 16 }
  y -= 12
  for (const n of doc.notes) for (const r of wrap(n, 95)) { room(13); text(M, 9, r); y -= 13 }

  // Objects: 1 catalog, 2 pages, 3 Helvetica, 4 Helvetica-Bold, then page + content pairs.
  const objects: string[] = []
  const font = (name: string) => `<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`
  const kids = pages.map((_, i) => `${5 + i * 2} 0 R`).join(' ')
  objects.push('<< /Type /Catalog /Pages 2 0 R >>', `<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`, font('Helvetica'), font('Helvetica-Bold'))
  for (const [i, ops] of pages.entries()) {
    const stream = ops.join('\n')
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${W} ${H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + i * 2} 0 R >>`)
    objects.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`)
  }
  let body = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n'
  const offsets: number[] = []
  for (const [i, o] of objects.entries()) { offsets.push(body.length); body += `${i + 1} 0 obj\n${o}\nendobj\n` }
  const xref = body.length
  body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n` + offsets.map(o => `${String(o).padStart(10, '0')} 00000 n \n`).join('')
  body += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  // Every character above is one byte (literals escape non-ASCII as octal).
  return Uint8Array.from(body, ch => ch.charCodeAt(0))
}
