// The declared personal fields; accounting names and posted free text are retained.
import type { Data } from '../core'
export const CONTACT_PERSONAL = ['email', 'phone', 'address', 'billing_address', 'service_address', 'internal_notes', 'bank_reference', 'external_ref'] as const
export const MARKER = '[erased]'
export function personalValues(row: Data, member = false): string[] {
  const values: string[] = []
  const collect = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && value !== MARKER) values.push(value)
    else if (Array.isArray(value)) value.forEach(collect)
    else if (value && typeof value === 'object') Object.entries(value).filter(([key]) => ['name','email','phone','address'].includes(key)).forEach(([,v]) => collect(v))
  }
  for (const key of member ? ['email','name'] : CONTACT_PERSONAL) collect(row[key])
  if (!member) collect(JSON.parse(row.contacts_json ?? '[]'))
  return [...new Set(values)].sort((a,b) => b.length-a.length)
}
export function scrub(value: unknown, values: string[], marker = MARKER): unknown {
  if (typeof value === 'string') return values.reduce((s, personal) => s.replaceAll(personal, marker), value)
  if (Array.isArray(value)) return value.map(v => scrub(v,values,marker))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,scrub(v,values,marker)]))
  return value
}
