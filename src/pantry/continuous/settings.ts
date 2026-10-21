// CLOSE-004 rule settings: the defaults the contract names, which the owner may change.
import { authority, who } from '../access'
import { cents, now, requireThat, uid, type Data } from '../core'
import { audit, changed, one, q, run } from '../db'
import type { Command } from '../context'

export type CheckSettings = {
  unreconciledDays: number; staleQueueDays: number; duplicateDays: number; unusualMinPostings: number
  unusualRatio: number; unusualMinDifferenceCents: number; suspenseDays: number; clearingDays: number; lookbackDays: number
}

export const DEFAULTS: CheckSettings = { unreconciledDays: 45, staleQueueDays: 7, duplicateDays: 7, unusualMinPostings: 4, unusualRatio: 3, unusualMinDifferenceCents: 10000, suspenseDays: 7, clearingDays: 3, lookbackDays: 60 }

const INTEGER_RANGES: Record<string, [number, number, string]> = {
  unreconciledDays: [1, 365, 'Days after a statement date before an unreconciled account is flagged'],
  staleQueueDays: [1, 365, 'Days a line may wait in the review queue'],
  duplicateDays: [0, 60, 'Days apart for a likely duplicate payment'],
  unusualMinPostings: [2, 100, 'Postings a vendor needs before amounts are judged'],
  suspenseDays: [1, 365, 'Days a suspense balance may stand'],
  clearingDays: [1, 60, 'Days a clearing difference may stand'],
  lookbackDays: [1, 3650, 'Days of recent activity the duplicate and unusual-amount checks judge'],
}

export async function checkSettings(db: D1Database): Promise<{ values: CheckSettings; revision: string; updatedBy: string | null; updatedAt: string | null; lastRunOn: string | null; lastRunAt: string | null }> {
  const row = (await one(db, 'SELECT * FROM pt_check_settings WHERE id = 1'))!
  return { values: { ...DEFAULTS, ...JSON.parse(row.settings) }, revision: row.revision, updatedBy: row.updated_by, updatedAt: row.updated_at, lastRunOn: row.last_run_on, lastRunAt: row.last_run_at }
}

function parse(b: Data): CheckSettings {
  const next: Data = { ...DEFAULTS }
  for (const [key, [min, max, label]] of Object.entries(INTEGER_RANGES)) {
    if (b[key] === undefined || b[key] === '') continue
    const n = Number(b[key])
    requireThat(Number.isInteger(n) && n >= min && n <= max, `${label}: a whole number from ${min} to ${max}`)
    next[key] = n
  }
  if (b.unusualRatio !== undefined && b.unusualRatio !== '') {
    const n = Number(b.unusualRatio)
    requireThat(Number.isFinite(n) && n >= 1.5 && n <= 100, 'Multiple of the median that is unusual: a number from 1.5 to 100')
    next.unusualRatio = n
  }
  if (b.unusualMinDifference !== undefined && b.unusualMinDifference !== '') next.unusualMinDifferenceCents = cents(b.unusualMinDifference, 'Least difference from the median', { zero: true })
  else if (b.unusualMinDifferenceCents !== undefined) next.unusualMinDifferenceCents = b.unusualMinDifferenceCents
  return next as CheckSettings
}

/** The owner changes a rule's default; only the values sent change, the rest stay as they are. */
const save: Command = { need: 'owner', async run(c, b) {
  const before = await checkSettings(c.db)
  requireThat(before.revision === b.revision, 'The check settings changed; reload', 409)
  const next = parse({ ...before.values, ...b }), revision = uid()
  const changes = Object.fromEntries((Object.keys(next) as (keyof CheckSettings)[]).filter(k => next[k] !== before.values[k]).map(k => [k, { from: before.values[k], to: next[k] }]))
  await run(c.db, [authority(c.actor, 'owner'),
    q('UPDATE pt_check_settings SET settings = ?, revision = ?, updated_by = ?, updated_at = ? WHERE id = 1 AND revision = ?', JSON.stringify(next), revision, c.actor.email, now(), before.revision), changed(),
    audit(who(c.actor), 'continuous-check.settings', 'check-settings', '1', { changes })])
  return checkSettings(c.db)
} }

export const checkSettingsCommands: Record<string, Command> = { 'continuous-check.settings': save }
