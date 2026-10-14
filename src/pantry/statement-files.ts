// Bank statement files: CSV exports with a header row, and OFX 1.x (SGML) or 2.x
// (XML) downloads. Parsing is exact; anything unrecognised is refused, never guessed.
import { cents, requireThat, Fault } from './core'

export type ParsedLine = { date: string; amount: number; description: string; reference: string; fitid?: string }
export type ParsedStatement = {
  format: 'csv' | 'ofx'; lines: ParsedLine[]
  account?: { bankId: string; accountId: string }
  start?: string; end?: string; closing?: number
}

/** RFC 4180 rows: quoted fields, doubled quotes, CRLF or LF. */
export function csvRows(source: string): string[][] {
  const rows: string[][] = []
  let row: string[] = [], field = '', quoted = false
  const text = source.replace(/^﻿/, '')
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"' && field === '') quoted = true
    else if (ch === ',') { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); rows.push(row); row = []; field = ''
    } else field += ch
  }
  requireThat(!quoted, 'The CSV file ends inside a quoted field')
  if (field !== '' || row.length) { row.push(field); rows.push(row) }
  return rows.filter(r => r.some(c => c.trim() !== ''))
}

export function usDate(value: string, label: string) {
  const v = value.trim()
  let m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  const iso = m ? `${m[3]}-${m[1].padStart(2, '0')}-${m[2].padStart(2, '0')}` : (/^\d{4}-\d{2}-\d{2}$/.test(v) ? v : '')
  requireThat(iso && new Date(iso + 'T00:00:00Z').toISOString().slice(0, 10) === iso, `${label}: "${v}" is not a date (MM/DD/YYYY or YYYY-MM-DD)`)
  return iso
}

const HEADERS = {
  date: ['date', 'posting date', 'posted date', 'transaction date'],
  description: ['description', 'payee', 'name', 'memo'],
  amount: ['amount'],
  debit: ['debit', 'withdrawal', 'withdrawals'],
  credit: ['credit', 'deposit', 'deposits'],
  reference: ['check or slip #', 'check number', 'reference', 'ref', 'check #'],
}

export function parseCsvStatement(source: string): ParsedStatement {
  const rows = csvRows(source)
  requireThat(rows.length >= 2, 'The CSV file has no transactions')
  const head = rows[0].map(h => h.trim().toLowerCase())
  const find = (names: string[]) => head.findIndex(h => names.includes(h))
  const col = { date: find(HEADERS.date), description: find(HEADERS.description), amount: find(HEADERS.amount), debit: find(HEADERS.debit), credit: find(HEADERS.credit), reference: find(HEADERS.reference) }
  if (col.date < 0 || col.description < 0 || (col.amount < 0 && (col.debit < 0 || col.credit < 0)))
    throw new Fault(400, `Unrecognised statement columns (${rows[0].join(', ')}). Pantry reads a header with a date (Date, Posting Date), a description (Description, Payee) and either Amount or Debit and Credit columns.`)
  const lines = rows.slice(1).map((r, i) => {
    const label = `Row ${i + 2}`
    const amount = col.amount >= 0
      ? cents(r[col.amount], `${label} amount`, { signed: true })
      : (r[col.credit]?.trim() ? cents(r[col.credit], `${label} credit`) : 0) - (r[col.debit]?.trim() ? cents(r[col.debit], `${label} debit`) : 0)
    requireThat(amount !== 0, `${label}: amount is zero`)
    return { date: usDate(r[col.date] ?? '', label), amount, description: (r[col.description] ?? '').trim() || '(no description)', reference: col.reference >= 0 ? (r[col.reference] ?? '').trim() : '' }
  })
  return { format: 'csv', lines }
}

const tag = (block: string, name: string) => new RegExp(`<${name}>([^<\\r\\n]*)`, 'i').exec(block)?.[1]?.trim() ?? ''
const ofxDate = (v: string, label: string) => {
  requireThat(/^\d{8}/.test(v), `${label} is not an OFX date`)
  return usDate(`${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`, label)
}

export function parseOfxStatement(source: string): ParsedStatement {
  requireThat(/<OFX>/i.test(source), 'This is not an OFX file')
  const from = /<BANKACCTFROM>([\s\S]*?)(<\/BANKACCTFROM>|<BANKTRANLIST>)/i.exec(source)?.[1] ?? ''
  const accountId = tag(from, 'ACCTID')
  requireThat(accountId, 'The OFX file names no bank account (BANKACCTFROM/ACCTID)')
  const list = /<BANKTRANLIST>([\s\S]*?)<\/BANKTRANLIST>/i.exec(source)?.[1] ?? ''
  const blocks = [...list.matchAll(/<STMTTRN>([\s\S]*?)(?=<\/STMTTRN>|<STMTTRN>|$)/gi)].map(m => m[1])
  requireThat(blocks.length, 'The OFX file has no transactions')
  const lines = blocks.map((b, i) => {
    const label = `Transaction ${i + 1}`, fitid = tag(b, 'FITID')
    requireThat(fitid, `${label} has no FITID`)
    const amount = cents(tag(b, 'TRNAMT'), `${label} amount`, { signed: true })
    return { date: ofxDate(tag(b, 'DTPOSTED'), `${label} date`), amount, description: [tag(b, 'NAME'), tag(b, 'MEMO')].filter(Boolean).join(' — ') || '(no description)', reference: tag(b, 'CHECKNUM') || tag(b, 'REFNUM'), fitid }
  })
  const ledger = /<LEDGERBAL>([\s\S]*?)(<\/LEDGERBAL>|<AVAILBAL>|<\/STMTRS>)/i.exec(source)?.[1] ?? ''
  const balance = tag(ledger, 'BALAMT')
  return {
    format: 'ofx', lines, account: { bankId: tag(from, 'BANKID'), accountId },
    start: tag(list, 'DTSTART') ? ofxDate(tag(list, 'DTSTART'), 'Statement start') : undefined,
    end: tag(list, 'DTEND') ? ofxDate(tag(list, 'DTEND'), 'Statement end') : undefined,
    closing: balance ? cents(balance, 'Ledger balance', { signed: true, zero: true }) : undefined,
  }
}
