import { requireThat } from '../core'

/** Decimal rendering uses integer arithmetic, including beyond binary float cent precision. */
export function decimal(minor: number, scale = 2): string {
  requireThat(Number.isSafeInteger(minor), 'Export contains an unsafe monetary integer', 409)
  const n = BigInt(minor), base = 10n ** BigInt(scale), abs = n < 0n ? -n : n
  return `${n < 0n ? '-' : ''}${abs / base}.${String(abs % base).padStart(scale, '0')}`
}

/** Quoting alone does not stop spreadsheets evaluating formulas. JSON retains exact text. */
const numericCell = Symbol('trusted CSV decimal')
export const csvNumber = (minor: number, scale = 2) => ({ [numericCell]: decimal(minor, scale) })
export function csv(rows: unknown[][]) {
  return rows.map(row => row.map(value => {
    let s = value && typeof value === 'object' && numericCell in value ? (value as ReturnType<typeof csvNumber>)[numericCell] : value === null || value === undefined ? '' : String(value)
    if (typeof value === 'string' && /^[\s\u0000-\u001f]*[=+\-@]/.test(s)) s = `'${s}`
    return `"${s.replaceAll('"', '""')}"`
  }).join(',')).join('\r\n') + '\r\n'
}

/** Money in transport templates stays a decimal token until serialization. */
export const amount = (minor: number) => ({ $decimal: decimal(minor) })
export function transportJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value !== 'object') return JSON.stringify(value)
  if (Array.isArray(value)) return `[${value.map(transportJson).join(',')}]`
  const obj = value as Record<string, unknown>
  if (Object.keys(obj).length === 1 && typeof obj.$decimal === 'string') {
    requireThat(/^-?\d+\.\d{2}$/.test(obj.$decimal), 'Invalid transport decimal')
    return obj.$decimal
  }
  return `{${Object.entries(obj).map(([k,v]) => `${JSON.stringify(k)}:${transportJson(v)}`).join(',')}}`
}

export function safeName(name: string) {
  return name.replace(/[\u0000-\u001f\u007f/\\:*?"<>|]/g, '_').replace(/^\.+/, '_') || 'original'
}
