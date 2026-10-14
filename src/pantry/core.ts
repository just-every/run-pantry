// Shared request facts and input parsing. Money is integer US cents and every
// amount a person or agent sends is a decimal string the server converts exactly.
export type Data = Record<string, any>

export class Fault extends Error {
  constructor(public status: number, message: string) { super(message) }
}

export function requireThat(value: unknown, message: string, status = 400): asserts value {
  if (!value) throw new Fault(status, message)
}

export const uid = () => crypto.randomUUID()
export const now = () => new Date().toISOString()

export function text(value: unknown, label: string, max = 2000): string {
  requireThat(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `${label} is required (at most ${max} characters)`)
  return value.trim()
}

export function optionalText(value: unknown, label: string, max = 2000): string {
  if (value === undefined || value === null || value === '') return ''
  requireThat(typeof value === 'string' && value.length <= max, `${label} must be text (at most ${max} characters)`)
  return value.trim()
}

export function date(value: unknown, label = 'Date'): string {
  const x = text(value, label, 10)
  requireThat(/^\d{4}-\d{2}-\d{2}$/.test(x) && new Date(x + 'T00:00:00Z').toISOString().slice(0, 10) === x, `${label} must be a real date (YYYY-MM-DD)`)
  return x
}

export const period = (day: string) => day.slice(0, 7)

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
/** "2026-09-30" → "Sep 30, 2026", the way the screens show a day. */
export function longDay(day: string) {
  const [y, m, d] = day.split('-').map(Number)
  return `${MONTHS[m - 1].slice(0, 3)} ${d}, ${y}`
}
/** "2026-09" → "September 2026". */
export function monthName(id: string) {
  const [y, m] = id.split('-').map(Number)
  return `${MONTHS[m - 1]} ${y}`
}

export function monthBounds(id: string) {
  requireThat(/^\d{4}-(0[1-9]|1[0-2])$/.test(id), 'Period must be YYYY-MM')
  const [y, m] = id.split('-').map(Number)
  const end = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10)
  return { start: `${id}-01`, end }
}

export function addDays(day: string, days: number) {
  return new Date(Date.parse(day + 'T00:00:00Z') + days * 86400000).toISOString().slice(0, 10)
}

export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000)

const MAX_CENTS = 100_000_000_000_00

/** "1,250.5" → 125050. Signs only where `signed`; never floats, exponents or symbols. */
export function cents(value: unknown, label: string, { signed = false, zero = false } = {}): number {
  requireThat(typeof value === 'string' || typeof value === 'number', `${label} is required`)
  const raw = String(value).trim().replace(/^\$/, '')
  const match = /^(-)?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?$/.exec(raw)
  requireThat(match, `${label} must be an amount like 1250.00`)
  requireThat(signed || !match[1], `${label} cannot be negative`)
  const whole = BigInt(match[2].replaceAll(',', '')), fraction = BigInt((match[3] ?? '').padEnd(2, '0'))
  const n = Number(whole * 100n + fraction) * (match[1] ? -1 : 1)
  requireThat(Number.isSafeInteger(n) && Math.abs(n) <= MAX_CENTS, `${label} is too large`)
  requireThat(zero || n !== 0, `${label} cannot be zero`)
  return n
}

/** Quantity as thousandths: "2.5" → 2500. */
export function quantity(value: unknown, label = 'Quantity'): number {
  const raw = String(value ?? '').trim()
  requireThat(/^\d{1,9}(\.\d{1,3})?$/.test(raw), `${label} must be a positive number with up to three decimals`)
  const [w, f = ''] = raw.split('.')
  const q = Number(w) * 1000 + Number(f.padEnd(3, '0'))
  requireThat(q > 0, `${label} must be positive`)
  return q
}

/** Round half up on exact integers: amount × numerator / denominator. */
export function scale(amount: number, numerator: number, denominator: number) {
  const n = BigInt(amount) * BigInt(numerator), d = BigInt(denominator)
  return Number((n * 2n + d) / (2n * d))
}

export function list<T>(value: unknown, label: string, max = 500): T[] {
  requireThat(Array.isArray(value) && value.length > 0 && value.length <= max, `${label} needs 1–${max} items`)
  return value as T[]
}

export function usd(c: number) {
  const sign = c < 0 ? '-' : '', abs = Math.abs(c)
  return `${sign}$${Math.floor(abs / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',')}.${String(abs % 100).padStart(2, '0')}`
}

export async function sha256(bytes: Uint8Array | string) {
  const data = typeof bytes === 'string' ? new TextEncoder().encode(bytes) : new Uint8Array(bytes)
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', data))].map(b => b.toString(16).padStart(2, '0')).join('')
}
