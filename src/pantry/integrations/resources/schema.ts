import type { Resource } from './model'

/** Split a registry SELECT at top-level commas so JSON subqueries retain their aliases. */
export function projectionFields(select: string) {
  const parts: string[] = []; let depth = 0, quoted = false, start = 0
  for (let i = 0; i < select.length; i++) {
    if (select[i] === "'") { if (quoted && select[i + 1] === "'") i++; else quoted = !quoted }
    if (quoted) continue
    if (select[i] === '(') depth++
    if (select[i] === ')') depth--
    if (select[i] === ',' && depth === 0) { parts.push(select.slice(start, i)); start = i + 1 }
  }
  parts.push(select.slice(start))
  return parts.map(part => (/\bAS\s+(\w+)\s*$/i.exec(part)?.[1] ?? part.trim().replace(/^\w+\./, '')))
}
const integers = new Set('active suspense rate_milli_percent number every months runs minutes terms_days priority position automatic created_entry duplicate_count line_count late off_cycle charges refunds complete sequence reached_bp transactions fiscal_year_start'.split(' '))
const nested: Record<string, string> = {
  bank_lines: 'bank_line_id,active', postings: 'journal_line_id,active', voided: 'id,statement_id,end_date,sequence',
  cells: 'account_id,month,amount_cents',dimension_cells:'account_id,month,amount_cents,class_name,location_name', messages: 'id,at,via,body',
  plan: 'id,date,amount_cents,label,phase,milestone,origin_id',
  splits: 'accountId,share,amountCents',
}
function fieldSchema(key: string): Record<string, unknown> {
  if (key === 'milestone') return { type: 'boolean' }
  if (key === 'states' || key === 'selected_account_ids') return { type: ['array', 'null'], items: { type: 'string' } }
  if (nested[key]) return { type: ['array', 'null'], items: objectSchema(nested[key].split(',')) }
  if(['dimension_conditions','dimension_actions'].includes(key))return objectSchema(['className','locationName','projectName'])
  if (key === 'definition') return { type: 'object', description: 'Explicit report or management package definition fields; no role sharing or calculated snapshots.' }
  if (key === 'lines') return { type: 'array', items: { type: 'object', description: 'Projected native accounting line fields; no execution snapshots.' } }
  if (key.endsWith('_cents') || integers.has(key) || ['share', 'amountCents'].includes(key)) return { type: ['integer', 'null'] }
  return { type: ['string', 'null'] }
}
function objectSchema(keys: string[]): Record<string, unknown> {
  return { type: 'object', additionalProperties: false, properties: Object.fromEntries(keys.map(key => [key, fieldSchema(key)])) }
}
export const resourceSchema = (spec: Resource) => objectSchema(projectionFields(spec.fields))
