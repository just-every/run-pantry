// Accounting report exports saved as CSV (QuickBooks Online and Xero alike): a
// few title rows (company, report name, date), one header row, data rows
// (grouped reports put a group heading row before each group and a "Total …"
// row after it), a total row and sometimes a footer. See MOVE-IN.md.
import { cents, Fault, requireThat } from '../core'
import { csvRows } from '../statement-files'

export type Row = { row: number; group: string; cells: Record<string, string> }
export type Report = { title: string[]; header: string[]; rows: Row[] }

/** Header cells compared without case or the asterisk Xero puts on required columns. */
const lower = (s: string) => s.trim().toLowerCase().replace(/^\*/, '')

export function report(source: string, required: string[], label: string, hint: string): Report {
  const all = csvRows(source)
  const at = all.findIndex(r => required.every(h => r.some(c => lower(c) === h)))
  if (at < 0) throw new Fault(400, `${label}: no header row with ${required.join(', ')}. ${hint}`)
  const header = all[at].map(lower)
  const rows: Row[] = []
  let group = ''
  for (let i = at + 1; i < all.length; i++) {
    const r = all[i], first = (r[0] ?? '').trim(), rest = r.slice(1).every(c => c.trim() === '')
    if (/^total\b/i.test(first)) continue
    if (rest && first) {
      if (/basis/i.test(first) && /\d{4}/.test(first)) continue // QuickBooks' footer: "Accrual Basis Wednesday, October 1, 2026 09:12 AM"
      group = first; continue
    }
    if (r.every(c => c.trim() === '')) continue
    rows.push({ row: i + 1, group, cells: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])) })
  }
  return { title: all.slice(0, at).map(r => r.join(',').trim()).filter(Boolean), header, rows }
}

/** A report amount: "1,234.56", "$1,234.56", "(1,234.56)" or "-1,234.56"; blank is zero. */
export const amount = (v: string, label: string) => v.trim() === '' ? 0 : cents(v.replace(/\$/g, '').replace(/^\((.*)\)$/, '-$1'), label, { signed: true, zero: true })

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
const month = (name: string) => MONTHS.findIndex(m => m === name.toLowerCase() || (name.length === 3 && m.startsWith(name.toLowerCase())))
const iso = (y: string, m: number, d: string) => `${y}-${String(m + 1).padStart(2, '0')}-${d.padStart(2, '0')}`
const real = (x: string) => { const t = new Date(x + 'T00:00:00Z'); return !isNaN(t.getTime()) && t.toISOString().slice(0, 10) === x }

/** A date written as "August 31, 2026" or "31 August 2026" (or "31 Aug 2026"), or null. */
function written(s: string): string | null {
  let m = /^(\w+) (\d{1,2}), (\d{4})$/.exec(s.trim())
  if (m && month(m[1]) >= 0) return iso(m[3], month(m[1]), m[2])
  m = /^(\d{1,2}) (\w+),? (\d{4})$/.exec(s.trim())
  if (m && month(m[2]) >= 0) return iso(m[3], month(m[2]), m[1])
  return null
}

/** The as-of date in a report's title rows: "As of August 31, 2026" (QuickBooks, Xero US) or "As at 31 August 2026" (Xero). */
export function asOf(title: string[]): string | null {
  for (const t of title) {
    const m = /as (?:of|at) ([\w ,]+\d{4})/i.exec(t)
    const day = m && written(m[1])
    if (day) return day
  }
  return null
}

/** The last day of "For the period 1 August 2026 to 31 August 2026" in a report's title rows. */
export function periodEnd(title: string[]): string | null {
  for (const t of title) {
    const m = / to ([\w ,]+\d{4})\s*$/i.exec(t.replace(/^"|"$/g, ''))
    const day = m && written(m[1])
    if (day) return day
  }
  return null
}

/** An export's date cell: MM/DD/YYYY (a US company's exports), YYYY-MM-DD, or "31 Aug 2026". */
export function exportDate(value: string, label: string) {
  const v = value.trim()
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(v)
  const day = m ? iso(m[3], Number(m[1]) - 1, m[2]) : /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : written(v)
  requireThat(day && real(day), `${label}: "${v}" is not a date (MM/DD/YYYY, YYYY-MM-DD or 31 Aug 2026)`)
  return day
}
