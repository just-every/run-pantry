import type { Data } from '../core'
import { amount } from './format'
import { block, mapping, type Plan, type Snapshot } from './types'

export const ownLines = (s: Snapshot, entry: string) => s.lines.filter(l => l.entry_id === entry)
export const net = (line: Data): number => line.debit_cents - line.credit_cents
export const journalIds = (s: Snapshot, doc: Data) => doc.journal_id && s.entries.some(e => e.id === doc.journal_id) ? [doc.journal_id] : []
export function documentSupported(plan: Plan, s: Snapshot, doc: Data, kind: string) {
  const source = `${kind}:${doc.id}`
  if (!journalIds(s, doc).length) {
    block(plan, source, 'Opening subledger record has no independent posted journal; map the retained opening entry and conversion balances together before importing this document.')
    return false
  }
  if ((doc.void_date && doc.void_date <= s.end) || doc.status === 'void' || (doc.early_reversal_id && s.entries.some(e => e.id === doc.early_reversal_id))) {
    block(plan, source, 'This source document was voided or reversed. Its original and reversal are retained; destination lifecycle replay is required before importing it.')
    return false
  }
  return true
}

export function dimensionBlock(plan: Plan, source: string, lines: Data[]) {
  if (!lines.some(l => l.class_name || l.location_name || l.project_name)) return false
  block(plan, source, 'Class, location or project dimensions need explicit destination tracking mappings; original tags remain in source JSON and the journal archive.')
  return true
}

export function sourceMappings(plan: Plan, s: Snapshot, provider: 'qbo' | 'xero') {
  for (const a of s.accounts) if (['receivable', 'payable', 'retained', 'bank'].includes(a.subtype))
    mapping(plan, `Account:${a.id}`, `Map ${a.code} ${a.name} to the matching ${provider} ${a.subtype} account. Bank account numbers are deliberately not guessed from last four digits.`)
}

export function completeCoverage(plan: Plan, s: Snapshot) {
  const represented = new Set(plan.operations.flatMap(o => o.journalIds))
  for (const e of s.entries) if (!represented.has(e.id) && !plan.blockers.some(b => b.source === `Journal:${e.id}`))
    block(plan, `Journal:${e.id}`, 'This posted entry is not represented by an import operation. Resolve the related document or provider restriction before ingestion.')
  if (!s.receivables.agrees || !s.payables.agrees)
    block(plan, 'TrialBalance', 'Open receivables or payables do not agree with their posted control account. The manifest preserves both figures.')
}

export function xeroLines(plan: Plan, s: Snapshot, lines: Data[], sign = 1) {
  return lines.map(l => ({
    Description: l.description ?? l.memo ?? '', Quantity: 1,
    UnitAmount: amount((l.amount_cents ?? net(l)) * sign),
    LineAmount: amount((l.amount_cents ?? net(l)) * sign),
    AccountCode: mapping(plan, `AccountCode:${l.account_id}`, `Use the actual Xero code for Pantry account ${s.accounts.find(a => a.id === l.account_id)?.code}.`),
    TaxType: 'NONE',
  }))
}
