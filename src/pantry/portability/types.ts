import type { Data } from '../core'

export type Destination = 'qbo' | 'xero'
export type ExportOptions = { destination: Destination; year?: number; asOf?: string }
export type Blocker = { source: string; reason: string }
/** A reference is resolved from an actual create and read response, never a Pantry ID. */
export type Reference = { $ref: string }
export const ref = (key: string): Reference => ({ $ref: key })
export type Operation = {
  key: string; method: 'POST'; path: string; payload: Data
  responseId: string; journalIds: string[]; source: string
}
export type Plan = { operations: Operation[]; blockers: Blocker[]; mappings: { key: string; reason: string }[] }
export type Snapshot = {
  entity: Data; year: number; start: string; end: string; periods: Data[]
  accounts: Data[]; contacts: Data[]; items: Data[]; entries: Data[]; lines: Data[]
  invoices: Data[]; invoiceLines: Data[]; bills: Data[]; billLines: Data[]
  payments: Data[]; vendorCredits: Data[]; allocations: Data[]; banks: Data[]
  documents: Data[]; entryDocuments: Record<string, Data[]>; receivables: Data; payables: Data
  opening: Data; closing: Data
}

export function operation(plan: Plan, resource: string, id: string, path: string, payload: Data, responseId: string, journalIds: string[] = []) {
  const key = `${resource}:${id}`
  plan.operations.push({ key, method: 'POST', path, payload, responseId, journalIds, source: key })
  return key
}
export const emptyPlan = (): Plan => ({ operations: [], blockers: [], mappings: [] })
export function block(plan: Plan, source: string, reason: string) { plan.blockers.push({ source, reason }) }
export function mapping(plan: Plan, key: string, reason: string) {
  if (!plan.mappings.some(m => m.key === key)) plan.mappings.push({ key, reason })
  return ref(key)
}
