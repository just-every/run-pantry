// Document facts stay proposals until a person saves the bill or expense draft.
import { amountCents, type Category } from './reader'
import { date, type Data } from '../core'
export type DraftReading = { kind: 'bill' | 'expense' | null; dueDate: string | null; termsDays: number | null; lines: { description: string; amount: number; accountCode: string | null }[] }
const nullableString = { anyOf: [{ type: 'string' }, { type: 'null' }] }
export const DRAFT_SCHEMA = { anyOf: [{ type: 'null' }, { type: 'object', additionalProperties: false,
  required: ['kind', 'dueDate', 'termsDays', 'lines'], properties: {
    kind: { enum: ['bill', 'expense', null] }, dueDate: nullableString, termsDays: { anyOf: [{ type: 'integer', minimum: 0, maximum: 365 }, { type: 'null' }] },
    lines: { type: 'array', maxItems: 100, items: { type: 'object', additionalProperties: false, required: ['description', 'amount', 'accountCode'], properties: { description: { type: 'string' }, amount: { type: 'string' }, accountCode: nullableString } } },
  } }] }
export const DRAFT_INSTRUCTIONS = '\n- draft: kind bill for an unpaid vendor invoice, expense for a paid receipt, else null; dueDate as printed YYYY-MM-DD, termsDays only when stated, lines with description, pretax amount and accountCode from expense accounts. Lines exclude separately stated tax. Never invent missing terms or line items.'
export function normaliseDraft(value: unknown, categories: Category[]): DraftReading | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const v = value as Data
  let dueDate = null; try { if (v.dueDate) dueDate = date(v.dueDate, 'Due date') } catch {}
  const lines = (Array.isArray(v.lines) ? v.lines : []).slice(0, 100).flatMap((l: Data) => {
    const amount = amountCents(l?.amount), description = typeof l?.description === 'string' ? l.description.trim().slice(0, 500) : ''
    return amount && description ? [{ description, amount, accountCode: categories.some(c => c.code === l.accountCode) ? l.accountCode : null }] : []
  })
  return { kind: ['bill', 'expense'].includes(v.kind) ? v.kind : null, dueDate, termsDays: Number.isInteger(v.termsDays) && v.termsDays >= 0 && v.termsDays <= 365 ? v.termsDays : null, lines }
}
