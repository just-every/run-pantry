// The common shape of a figure opened to its sources: the figure as the report
// shows it, the rows behind it and whether they add up to it.
import { Fault, type Data } from '../core'
import type { Basis } from '../basis'

export type FigureBase = { report: string; line: string; label: string; basis: Basis | 'payment'; basisLabel?: string; from: string | null; to: string; figure: number; rows: Data[]; scopeNote?: string; context?: Data }
export function figureResult(base: FigureBase) {
  const total = base.rows.reduce((n, r) => n + r.amount, 0)
  return { ...base, total, ties: total === base.figure }
}

/** A derived percentage: its operands open as figures of their own and the stated rule recomputes it. */
export type Operand = { label: string; value: number; line: string; column?: string }
export function percentResult(base: Omit<FigureBase, 'figure' | 'rows'> & { figure: number | null; expression: string; operands: Operand[]; recomputed: number | null }) {
  const { recomputed, ...rest } = base
  return { ...rest, unit: 'percent' as const, rows: [], total: null, ties: recomputed === base.figure }
}

/** Rows of a second figure subtracted from a first (change, variance): keys stay distinct. */
export const less = (rows: Data[], prefix: string) => rows.map(r => ({ ...r, key: `${prefix}:${r.key}`, amount: -r.amount, debit: r.credit, credit: r.debit }))
export const tagged = (rows: Data[], prefix: string) => rows.map(r => ({ ...r, key: `${prefix}:${r.key}` }))

export function parseLine(line: string, size: [number, number], message: string): string[] {
  let selected: unknown
  try { selected = JSON.parse(line) } catch { selected = null }
  if (!Array.isArray(selected) || selected.length < size[0] || selected.length > size[1] || !selected.every(v => typeof v === 'string')) throw new Fault(404, message)
  return selected as string[]
}
