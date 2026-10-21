// CLOSE-004 rules that read what a connected provider reports: a processor
// clearing account that differs from the provider's balance, and payrolls the
// books could not tie to the provider's totals.
import { daysBetween, longDay, usd } from '../core'
import { all, q, run } from '../db'
import { clearingState } from '../stripe-clearing'
import type { CheckSettings } from './settings'
import type { Finding } from './types'

/**
 * The Stripe clearing account has differed from Stripe's balance in transit (PROC-003) for more than `clearingDays`.
 * The first day a run saw the difference is kept, and forgotten the day the difference is gone.
 */
export async function clearingDifference(db: D1Database, today: string, s: CheckSettings): Promise<Finding[]> {
  const state = await clearingState(db)
  const differing = state && state.differenceCents !== null && state.differenceCents !== 0
  if (!differing) { await run(db, [q("DELETE FROM pt_check_watch WHERE key LIKE 'clearing:%'")]); return [] }
  const key = `clearing:${state.account.id}`
  await run(db, [q('INSERT OR IGNORE INTO pt_check_watch (key, since) VALUES (?, ?)', key, today)])
  const since = (await all(db, 'SELECT since FROM pt_check_watch WHERE key = ?', key))[0]?.since as string
  if (daysBetween(since, today) <= s.clearingDays) return []
  const items = state.items.filter((i: Record<string, any>) => !['posted', 'adopted', 'legacy-covered', 'covered'].includes(i.status))
  return [{ rule: 'clearing', subject: state.account.id, title: `${state.account.name} differs from Stripe`,
    detail: `Ledger ${usd(state.ledgerCents)}, Stripe ${usd(state.providerCents)}: a difference of ${usd(state.differenceCents)} seen since ${longDay(since)}, more than ${s.clearingDays} ${s.clearingDays === 1 ? 'day' : 'days'}. ${state.reason || ''}`.trim(),
    ruleText: 'A processor clearing account that has differed from the provider\'s balance in transit for more than the set number of days.', setting: { clearingDays: s.clearingDays },
    lines: [{ kind: 'account', id: state.account.id, label: state.account.name, amountCents: state.differenceCents }, ...items.slice(0, 25).map((i: Record<string, any>) => ({ kind: 'clearing-item' as const, id: i.id, label: `${i.id} · ${i.type} · ${i.reason}`, date: i.date, amountCents: i.netCents }))],
    extra: { difference: state.differenceCents } }]
}

/** A payroll read from the connected provider whose entry the books could not balance to its totals (held for a person). */
export async function payrollMismatch(db: D1Database): Promise<Finding[]> {
  const rows = await all(db, "SELECT uuid, check_date, gross_cents, debit_cents, reason FROM pt_gusto_payrolls WHERE status = 'held' ORDER BY check_date, uuid")
  return rows.map(p => ({ rule: 'payroll', subject: p.uuid, title: `Payroll paid ${longDay(p.check_date)} does not add up`,
    detail: `The payroll checked ${longDay(p.check_date)} (gross ${usd(p.gross_cents)}, tax debit ${usd(p.debit_cents)}) is held and not booked: ${p.reason}`,
    ruleText: 'A payroll difference between the connected provider\'s totals and the entry the books can post (PAYROLL-001).', setting: {},
    lines: [{ kind: 'payroll' as const, id: p.uuid, label: `Payroll ${p.check_date}`, date: p.check_date, amountCents: p.gross_cents }], extra: { reason: p.reason } }))
}
