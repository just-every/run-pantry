// QuickBooks Online report exports, saved as CSV: a few title rows (company,
// report name, date), one header row, data rows (grouped reports put a group
// heading row before each group and a "Total for …" row after it), a TOTAL row
// and a footer naming the basis and the time it ran. See MOVE-IN.md.
import { cents, Fault } from '../core'
import { csvRows, usDate } from '../statement-files'

export type Row = { row: number; group: string; cells: Record<string, string> }
export type Report = { title: string[]; header: string[]; rows: Row[] }

export function report(source: string, required: string[], label: string): Report {
  const all = csvRows(source)
  const lower = (s: string) => s.trim().toLowerCase()
  const at = all.findIndex(r => required.every(h => r.some(c => lower(c) === lower(h))))
  if (at < 0) throw new Fault(400, `${label}: no header row with ${required.join(', ')}. Export the report from QuickBooks Online unchanged.`)
  const header = all[at].map(lower)
  const rows: Row[] = []
  let group = ''
  for (let i = at + 1; i < all.length; i++) {
    const r = all[i], first = (r[0] ?? '').trim(), rest = r.slice(1).every(c => c.trim() === '')
    if (/^total\b/i.test(first)) continue
    if (rest && first) {
      if (/basis/i.test(first) && /\d{4}/.test(first)) continue // the footer: "Accrual Basis Wednesday, October 1, 2026 09:12 AM"
      group = first; continue
    }
    rows.push({ row: i + 1, group, cells: Object.fromEntries(header.map((h, j) => [h, (r[j] ?? '').trim()])) })
  }
  return { title: all.slice(0, at).map(r => r.join(',').trim()).filter(Boolean), header, rows }
}

export const amount = (v: string, label: string) => v.trim() === '' ? 0 : cents(v.replace(/\$/g, '').replace(/^\((.*)\)$/, '-$1'), label, { signed: true, zero: true })
export const qboDate = (v: string, label: string) => usDate(v, label)

const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']
/** "As of September 30, 2026" in a report's title rows. */
export function asOf(title: string[]): string | null {
  for (const t of title) {
    const m = /as of (\w+) (\d{1,2}), (\d{4})/i.exec(t)
    if (m && MONTHS.includes(m[1].toLowerCase())) return `${m[3]}-${String(MONTHS.indexOf(m[1].toLowerCase()) + 1).padStart(2, '0')}-${m[2].padStart(2, '0')}`
  }
  return null
}

/** QuickBooks Online account types → Pantry type and role. */
export const ACCOUNT_TYPES: Record<string, [string, string]> = {
  'bank': ['asset', 'bank'],
  'accounts receivable (a/r)': ['asset', 'receivable'],
  'other current assets': ['asset', 'other'],
  'fixed assets': ['asset', 'other'],
  'other assets': ['asset', 'other'],
  'accounts payable (a/p)': ['liability', 'payable'],
  'credit card': ['liability', 'other'],
  'other current liabilities': ['liability', 'other'],
  'long term liabilities': ['liability', 'other'],
  'equity': ['equity', 'other'],
  'income': ['income', 'other'],
  'other income': ['income', 'other'],
  'cost of goods sold': ['expense', 'other'],
  'expenses': ['expense', 'other'],
  'other expense': ['expense', 'other'],
}
