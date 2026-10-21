import type { Data } from '../core'

/** A record a flag cites: its kind, id and a label a person recognises. */
export type CitedLine = { kind: 'bill' | 'payment' | 'entry' | 'statement' | 'bank-line' | 'account' | 'clearing-item' | 'payroll'; id: string; label: string; date?: string | null; amountCents?: number | null }

/** What one rule found today, before it is matched to the flag already raised for it. */
export type Finding = {
  rule: string
  /** Stable identity of the thing flagged, so a later run updates the same flag. */
  subject: string
  title: string
  detail: string
  /** The rule in words and the settings that raised this flag. */
  ruleText: string
  setting: Data
  lines: CitedLine[]
  /** Extra facts that make the flag a different one when they change (a balance). */
  extra?: Data
}

export const RULES = [
  { rule: 'unreconciled', title: 'Unreconciled account' },
  { rule: 'stale-queue', title: 'Stale review queue' },
  { rule: 'wrong-side', title: 'Wrong-side balance' },
  { rule: 'duplicate', title: 'Likely duplicate payment' },
  { rule: 'unusual-amount', title: 'Amount unusual for a vendor' },
  { rule: 'suspense', title: 'Suspense' },
  { rule: 'clearing', title: 'Clearing difference' },
  { rule: 'payroll', title: 'Payroll mismatch' },
] as const
