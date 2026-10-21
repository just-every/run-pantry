// CSV and OOXML values only. Workbook formulas are refused instead of trusting
// stale cached results. ZIP and worksheet bounds apply before inflation/allocation.
import { inflateRawSync } from 'node:zlib'
import { Buffer } from 'node:buffer'
import { Fault, requireThat, type Data } from '../core'

export type Sheet = { headers: string[]; rows: { row: number; cells: string[]; error?: string }[] }
const MAX_FILE = 2_000_000, MAX_XML = 12_000_000
const CRC = Uint32Array.from({ length: 256 }, (_, i) => { let n = i; for (let b = 0; b < 8; b++) n = (n >>> 1) ^ (n & 1 ? 0xedb88320 : 0); return n >>> 0 })
const crc32 = (bytes: Uint8Array) => { let crc = 0xffffffff; for (const byte of bytes) crc = (crc >>> 8) ^ CRC[(crc ^ byte) & 255]; return (crc ^ 0xffffffff) >>> 0 }
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, v: string) => {
  if (v[0] === '#') { const n = v[1].toLowerCase() === 'x' ? parseInt(v.slice(2), 16) : Number(v.slice(1)); requireThat(n > 0 && n <= 0x10ffff && !(n >= 0xd800 && n <= 0xdfff), 'Invalid XML character'); return String.fromCodePoint(n) }
  return ({ amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" } as Record<string, string>)[v.toLowerCase()]
})
const attr = (s: string, name: string) => decode(new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`).exec(s)?.slice(1).find(v => v !== undefined) ?? '')
const text = (s: string) => [...s.matchAll(/<(?:\w+:)?t\b[^>]*>([\s\S]*?)<\/(?:\w+:)?t>/g)].map(m => decode(m[1])).join('')


function csvSheet(source: string): { row: number; cells: string[] }[] {
  const rows: { row: number; cells: string[] }[] = []
  const input = source.replace(/^\uFEFF/, '')
  let cells: string[] = [], value = '', quoted = false, closed = false, line = 1, start = 1
  const finish = () => { cells.push(value); if (cells.some(v => v.trim())) rows.push({ row: start, cells }); cells = []; value = ''; closed = false }
  for (let i = 0; i < input.length; i++) {
    const ch = input[i]
    if (quoted) {
      if (ch === '"' && input[i + 1] === '"') { value += '"'; i++ }
      else if (ch === '"') { quoted = false; closed = true }
      else { value += ch; if (ch === '\n' || (ch === '\r' && input[i + 1] !== '\n')) line++ }
    } else if (ch === '"' && value === '' && !closed) quoted = true
    else if (ch === ',') { cells.push(value); value = ''; closed = false }
    else if (ch === '\n' || ch === '\r') { if (ch === '\r' && input[i + 1] === '\n') i++; finish(); line++; start = line }
    else { requireThat(!closed, `CSV row ${start} has text after a closing quote`); requireThat(ch !== '"', `CSV row ${start} has a quote inside an unquoted field`); value += ch }
  }
  requireThat(!quoted, 'The CSV file ends inside a quoted field')
  if (value || cells.length || closed) finish()
  return rows
}

function zip(bytes: Uint8Array): Map<string, string> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength), files = new Map<string, string>()
  let end = bytes.length - 22
  for (; end >= Math.max(0, bytes.length - 65557); end--) if (view.getUint32(end, true) === 0x06054b50) break
  requireThat(end >= 0 && end + 22 <= bytes.length && view.getUint32(end, true) === 0x06054b50, 'The .xlsx ZIP directory is missing')
  requireThat(view.getUint16(end + 4, true) === 0 && view.getUint16(end + 6, true) === 0, 'Split workbooks are not supported')
  const count = view.getUint16(end + 10, true), centralEnd = view.getUint32(end + 16, true) + view.getUint32(end + 12, true)
  requireThat(count <= 2000 && centralEnd <= end, 'The workbook ZIP directory is invalid or too large')
  let pos = view.getUint32(end + 16, true), expanded = 0
  for (let n = 0; n < count; n++) {
    requireThat(pos + 46 <= centralEnd && view.getUint32(pos, true) === 0x02014b50, 'Invalid workbook ZIP entry')
    const flags = view.getUint16(pos + 8, true), method = view.getUint16(pos + 10, true), size = view.getUint32(pos + 24, true), packed = view.getUint32(pos + 20, true)
    const nameLength = view.getUint16(pos + 28, true), extra = view.getUint16(pos + 30, true), comment = view.getUint16(pos + 32, true), offset = view.getUint32(pos + 42, true)
    const name = new TextDecoder().decode(bytes.subarray(pos + 46, pos + 46 + nameLength))
    requireThat(pos + 46 + nameLength + extra + comment <= centralEnd, 'Invalid workbook ZIP entry length')
    requireThat(!(flags & 1) && (method === 0 || method === 8), 'Encrypted or unsupported workbook compression')
    expanded += size
    requireThat(expanded <= MAX_XML && size <= MAX_XML, 'The expanded workbook exceeds 12 MB')
    requireThat(!files.has(name), 'The workbook contains duplicate ZIP paths')
    if (name.endsWith('.xml') || name.endsWith('.rels')) {
      requireThat(offset + 30 <= bytes.length && view.getUint32(offset, true) === 0x04034b50, 'Invalid workbook ZIP local entry')
      const start = offset + 30 + view.getUint16(offset + 26, true) + view.getUint16(offset + 28, true)
      requireThat(start + packed <= bytes.length, 'Truncated workbook ZIP entry')
      const raw = bytes.subarray(start, start + packed)
      const data = method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_XML }) : raw
      requireThat(data.length === size && crc32(data) === view.getUint32(pos + 16, true), 'Workbook ZIP entry size or checksum differs from its directory')
      const xml = new TextDecoder('utf-8', { fatal: true }).decode(data)
      requireThat(!/<!DOCTYPE|<!ENTITY/i.test(xml), 'Workbook XML must not declare external entities')
      files.set(name, xml)
    }
    pos += 46 + nameLength + extra + comment
  }
  return files
}

function xlsx(bytes: Uint8Array, requested?: string): { row: number; cells: string[]; error?: string }[] {
  const files = zip(bytes), workbook = files.get('xl/workbook.xml')
  requireThat(workbook, 'This is not an Excel .xlsx workbook')
  const sheets = [...workbook.matchAll(/<(?:\w+:)?sheet\b([^>]*?)\/?\s*>/g)]
  const sheet = requested ? sheets.find(m => attr(m[1], 'name') === requested) : sheets[0]
  requireThat(sheet, requested ? `Worksheet "${requested}" was not found` : 'The workbook has no worksheet')
  const relId = attr(sheet[1], 'r:id'), rels = files.get('xl/_rels/workbook.xml.rels') ?? ''
  const relation = [...rels.matchAll(/<(?:\w+:)?Relationship\b([^>]*?)\/?\s*>/g)].find(m => attr(m[1], 'Id') === relId)
  requireThat(relation && attr(relation[1], 'TargetMode') !== 'External', 'Worksheet relationship is missing or external')
  const target = attr(relation[1], 'Target'), path = target.startsWith('/') ? target.slice(1) : `xl/${target}`
  requireThat(!path.includes('..'), 'Worksheet paths must stay in the workbook')
  const xml = files.get(path)
  requireThat(xml, 'The worksheet bytes are missing')
  const shared = [...(files.get('xl/sharedStrings.xml') ?? '').matchAll(/<(?:\w+:)?si\b[^>]*>([\s\S]*?)<\/(?:\w+:)?si>/g)].map(m => text(m[1]))
  const styles = files.get('xl/styles.xml') ?? '', formats = new Map([...styles.matchAll(/<numFmt\b([^>]*?)\/?\s*>/g)].map(m => [Number(attr(m[1], 'numFmtId')), attr(m[1], 'formatCode')]))
  const cellXfs = /<cellXfs\b[^>]*>([\s\S]*?)<\/cellXfs>/.exec(styles)?.[1] ?? ''
  const dates = [...cellXfs.matchAll(/<xf\b([^>]*?)\/?\s*>/g)].map(m => { const id = Number(attr(m[1], 'numFmtId')); return (id >= 14 && id <= 22) || (id >= 27 && id <= 36) || (id >= 45 && id <= 47) || (id >= 50 && id <= 58) || /[yd]/i.test((formats.get(id) ?? '').replace(/"[^"]*"|\[[^\]]*\]|\\./g, '')) })
  const epoch = /date1904\s*=\s*["'](?:1|true)["']/i.test(workbook) ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)
  const rows: { row: number; cells: string[]; error?: string }[] = []
  requireThat(/<(?:\w+:)?sheetData\b/.test(xml), 'Worksheet data is missing')
  const blocks = [...xml.matchAll(/<(?:\w+:)?row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?row>)/g)]
  requireThat(blocks.length === [...xml.matchAll(/<(?:\w+:)?row\b/g)].length, 'The worksheet has an incomplete data row')
  for (const match of blocks) {
    const cells: string[] = [], row = Number(attr(match[1], 'r')) || rows.length + 1
    let error: string | undefined
    for (const cell of (match[2] ?? '').matchAll(/<(?:\w+:)?c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:\w+:)?c>)/g)) {
      const ref = attr(cell[1], 'r'), letters = /^([A-Z]+)\d+$/.exec(ref)?.[1]
      let col = 0
      if (letters) for (const ch of letters) col = col * 26 + ch.charCodeAt(0) - 64
      else col = cells.length + 1
      const body = cell[2] ?? '', type = attr(cell[1], 't'), raw = decode(/<(?:\w+:)?v\b[^>]*>([\s\S]*?)<\/(?:\w+:)?v>/.exec(body)?.[1] ?? '')
      if (!raw && type !== 'inlineStr' && !/<(?:\w+:)?f\b/.test(body)) continue
      requireThat(col <= 100, 'A spreadsheet may have at most 100 columns')
      if (/<(?:\w+:)?f\b/.test(body)) error = 'Formula cell: replace formulas with values before importing'
      if (type === 'e') error = `Excel error cell: ${raw}`
      if (type === 's') { requireThat(/^\d+$/.test(raw) && Number(raw) < shared.length, 'Invalid shared-string reference'); cells[col - 1] = shared[Number(raw)] }
      else if (type === 'inlineStr') cells[col - 1] = text(body)
      else if (type === 'b') cells[col - 1] = raw === '1' ? 'true' : 'false'
      else if (raw && dates[Number(attr(cell[1], 's'))] && (!type || type === 'n')) {
        requireThat(Number.isFinite(Number(raw)) && Number(raw) >= 0 && Number(raw) <= 2958465, 'Invalid Excel date')
        cells[col - 1] = new Date(epoch + (Math.floor(Number(raw)) + (epoch === Date.UTC(1899, 11, 30) && Number(raw) < 60 ? 1 : 0)) * 86400000).toISOString().slice(0, 10)
      } else cells[col - 1] = raw
    }
    if (cells.some(v => v?.trim()) || error) rows.push({ row, cells, ...(error ? { error } : {}) })
    requireThat(rows.length <= 10001, 'A spreadsheet may have at most 10,000 data rows')
  }
  return rows
}

export function spreadsheetFile(file: Data): { sheet: Sheet; content: string; base64?: string } {
  requireThat(file && typeof file.name === 'string', 'Choose a CSV or .xlsx file')
  let rows: { row: number; cells: string[]; error?: string }[], content = '', base64: string | undefined
  if (/\.xlsx$/i.test(file.name)) {
    requireThat(typeof file.base64 === 'string' && file.base64.length <= Math.ceil(MAX_FILE / 3) * 4 && /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(file.base64), 'Upload .xlsx bytes as base64 (up to 2 MB)')
    const bytes = Buffer.from(file.base64, 'base64'); requireThat(bytes.length <= MAX_FILE, 'Workbook exceeds 2 MB')
    try { rows = xlsx(bytes, file.sheet) } catch (error) { if (error instanceof Fault) throw error; throw new Fault(400, 'The .xlsx workbook is damaged or contains invalid XML; export it again') }; base64 = file.base64
  } else {
    requireThat(/\.csv$/i.test(file.name) && typeof file.content === 'string' && new TextEncoder().encode(file.content).length <= MAX_FILE, 'Choose CSV text or an Excel .xlsx (up to 2 MB)')
    content = file.content; rows = csvSheet(content)
  }
  requireThat(rows.length && rows[0].cells.length <= 100 && rows.length <= 10001, 'The spreadsheet needs a header row and at most 10,000 data rows / 100 columns')
  requireThat(!rows[0].error, 'The header must contain text values')
  const headers = Array.from(rows[0].cells, v => (v ?? '').trim())
  requireThat(headers.every(Boolean) && new Set(headers.map(v => v.toLowerCase())).size === headers.length, 'Every column needs a unique, nonempty header')
  return { sheet: { headers, rows: rows.slice(1) }, content, ...(base64 ? { base64 } : {}) }
}
