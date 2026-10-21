import type { ImportMapping, TargetEffect } from '../../modules/import-kit/src/d1/index'
import type { Data } from '../core'
import { mapping } from './plan'
import { spreadsheets } from './spreadsheet'
import { idsFor, type Parsed } from './source'

/** Stable native ids, imported identity aliases, and exact before revisions are
 * reviewed together. The kit preserves the predecessor for an undo of updates. */
export function spreadsheetMapping(r: Parsed, preparedBy: string): ImportMapping {
  const base = mapping(spreadsheets, r, preparedBy), resolve = (id: string) => r.nativeIds?.[id] ?? id
  return { version: base.version, map(rec) {
    const x = rec.payload as Data
    if (x.refused) return { effects: [], rejection: x.refused }
    if (rec.kind === 'trial-balance') return { effects: [], unmapped: [{ reason: 'This row is included in the draft opening entry.' }] }
    let effects: TargetEffect[]
    if (rec.kind === 'item') effects = [{ targetKind: 'item', targetId: x._target, value: { name: x.name, kind: x.kind, sku: x.sku, description: x.description, rate_cents: x.rate, income_account_id: resolveAccount(r, x.account), tax_category: x.taxDecision, tax_code: x.taxCode, active: 1, created_at: r.cutoverDate } }]
    else effects = base.map(rec).effects
    // Account ids come from the shared mapper's source naming and may already
    // exist under an external id (or have been created through the normal UI).
    for (const effect of effects) {
      effect.targetId = resolve(effect.targetId)
      const v = effect.value as Data
      if (v.created_at && r.nativeValues?.[`${effect.targetKind}:${effect.targetId}`]?.created_at) v.created_at = r.nativeValues[`${effect.targetKind}:${effect.targetId}`].created_at
      if (rec.kind === 'item') v.income_account_id = resolveAccount(r, x.account)
      if (effect.targetKind === 'counterparty') { v.terms_days = x.termsDays ?? 30; v.external_ref = x._external || 'Spreadsheet' }
      if (effect.targetKind === 'invoice') v.customer_id = resolve(v.customer_id)
      if (effect.targetKind === 'bill') v.vendor_id = resolve(v.vendor_id)
      if (effect.targetKind === 'bank') v.account_id = resolve(v.account_id)
      if (effect.targetKind === 'cutover') for (const line of v.lines) line.account_id = resolve(line.account_id)
    }
    if (x._target) effects.push({ targetKind: 'spreadsheet-key', targetId: x._target, value: { dataset: x._dataset, external_id: x._externalHash, name: x._matchName } })
    for (const effect of effects) {
      const revision = r.snapshots?.[`${effect.targetKind}:${effect.targetId}`]
      if (revision) effect.expectedRevision = revision
    }
    effects = effects.filter(effect => !sameValue(r.nativeValues?.[`${effect.targetKind}:${effect.targetId}`], effect.value))
    return effects.length ? { effects } : { effects: [], unmapped: [{ reason: 'The native record already matches these spreadsheet values.' }] }
  } }
}
function resolveAccount(r: Parsed, name: string) { const id = idsFor('sheet').account(name); return r.nativeIds?.[id] ?? id }

/** Compare only fields this import owns; ordinary native fields outside its
 * mapping remain untouched. Arrays (the opening lines) must match exactly. */
function sameValue(current: unknown, expected: unknown): boolean {
  if (Array.isArray(expected)) return Array.isArray(current) && current.length === expected.length && expected.every((value, i) => sameValue(current[i], value))
  if (expected && typeof expected === 'object') return !!current && typeof current === 'object' && Object.entries(expected).every(([key, value]) => sameValue((current as Data)[key], value))
  return (current ?? null) === (expected ?? null)
}
