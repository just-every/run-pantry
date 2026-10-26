import { requireThat, type Data } from '../core'
import { transportJson } from './format'
import type { Operation } from './types'

/** Resolve only from read or create receipts. Callers supply credentials at the network edge. */
export function resolveOperation(op: Operation, ids: Record<string, string>, company?: { realmId: string }) {
  const required = (key: string) => {
    requireThat(typeof ids[key] === 'string' && ids[key].length > 0, `Destination mapping required: ${key}`, 409)
    return ids[key]
  }
  const resolve = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(resolve)
    if (!v || typeof v !== 'object') return v
    const obj = v as Data
    if (Object.keys(obj).length === 1 && typeof obj.$ref === 'string') return required(obj.$ref)
    return Object.fromEntries(Object.entries(obj).map(([key,value]) => [key, resolve(value)]))
  }
  let path = op.path.replace(/\{ref:([^}]+)\}/g, (_, key) => encodeURIComponent(required(key)))
  if (path.includes('{realmId}')) {
    requireThat(company?.realmId && /^\d+$/.test(company.realmId), 'Select the actual QBO company realm ID', 409)
    path = path.replace('{realmId}', company.realmId)
  }
  return { method: op.method, path, body: transportJson(resolve(op.payload)), headers: { 'content-type': 'application/json', accept: 'application/json' } }
}

export function requiredReferences(op: Operation) {
  const found = new Set<string>()
  const visit = (v: unknown) => {
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v)) { v.forEach(visit); return }
    const obj = v as Data
    if (typeof obj.$ref === 'string') found.add(obj.$ref)
    else Object.values(obj).forEach(visit)
  }
  visit(op.payload)
  for (const match of op.path.matchAll(/\{ref:([^}]+)\}/g)) found.add(match[1])
  return [...found].sort()
}

export const transportSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema', title: 'Pantry destination transport plan',
  type: 'object', required: ['format', 'destination', 'operations', 'mappings', 'blockers'],
  properties: {
    format: { const: 'pantry-destination-transport/1' }, destination: { enum: ['qbo','xero'] },
    operations: { type: 'array', items: { type: 'object', required: ['key','method','path','payload','responseId','journalIds','source'], properties: { key: { type: 'string' }, method: { const: 'POST' }, path: { type: 'string' }, payload: { type: 'object' }, responseId: { type: 'string' }, journalIds: { type: 'array', items: { type: 'string' } }, source: { type: 'string' }, dependsOn: { type: 'array', items: { type: 'string' } } } } },
    mappings: { type: 'array', items: { type: 'object', required: ['key','reason'], properties: { key: { type: 'string' }, reason: { type: 'string' } } } },
    blockers: { type: 'array', items: { type: 'object', required: ['source','reason'], properties: { source: { type: 'string' }, reason: { type: 'string' } } } },
  },
  $defs: {
    reference: { type: 'object', required: ['$ref'], additionalProperties: false, properties: { $ref: { type: 'string', description: 'Actual destination ID or code obtained from a provider receipt, keyed by operation key or mapping key.' } } },
    decimal: { type: 'object', required: ['$decimal'], additionalProperties: false, properties: { $decimal: { type: 'string', pattern: '^-?\\d+\\.\\d{2}$', description: 'Serialize as an unquoted JSON decimal token using transportJson; never round through float arithmetic.' } } },
  },
}
