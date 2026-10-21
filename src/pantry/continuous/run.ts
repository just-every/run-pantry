// CLOSE-004: the daily run, the flags it keeps and dismissing them. A run finds
// today's conditions, then settles each against the flag already kept for it: a
// new condition opens a flag; a flag dismissed on the same lines stays dismissed;
// a dismissed flag whose lines changed opens again; a condition that has gone
// clears its open flag.
import { authority, pantry, who } from '../access'
import { now, optionalText, requireThat, sha256, text, uid, type Data } from '../core'
import { all, audit, changed, one, q, run, type Sql } from '../db'
import type { Command } from '../context'
import { businessDay, sendingSettings } from '../delivery'
import { payrollMismatch, clearingDifference } from './provider-rules'
import { duplicates, unusualAmounts } from './payable-rules'
import { staleQueue, suspense, unreconciled, wrongSide } from './ledger-rules'
import { checkSettings, checkSettingsCommands } from './settings'
import { RULES, type Finding } from './types'

const signature = (f: Finding) => sha256(JSON.stringify([f.rule, f.subject, f.lines.map(l => [l.kind, l.id, l.amountCents ?? null, l.date ?? null]), f.extra?.ids ?? null, f.extra?.balance ?? null, f.extra?.median2 ?? null, f.extra?.difference ?? null, f.extra?.reason ?? null, f.extra?.total ?? null]))

/** Today's findings from every rule. */
export async function findings(db: D1Database, today: string): Promise<Finding[]> {
  const s = (await checkSettings(db)).values
  return [...await unreconciled(db, today, s), ...await staleQueue(db, today, s), ...await wrongSide(db, today, s), ...await duplicates(db, today, s),
    ...await unusualAmounts(db, today, s), ...await suspense(db, today, s), ...await clearingDifference(db, today, s), ...await payrollMismatch(db)]
}

/** The daily run: raise, keep, reopen and clear flags. Idempotent within a day. */
export async function runContinuousChecks(db: D1Database, today: string) {
  const found = await findings(db, today)
  const kept = new Map((await all(db, 'SELECT * FROM pt_check_flags')).map(r => [`${r.rule}\u0000${r.subject}`, r]))
  const statements: Sql[] = [], seen = new Set<string>(), system = pantry('checks')
  for (const f of found) {
    const key = `${f.rule}\u0000${f.subject}`, sig = await signature(f), row = kept.get(key)
    seen.add(key)
    const body = [f.title, f.detail, JSON.stringify(f.setting), JSON.stringify(f.lines)]
    if (!row) {
      const id = uid()
      statements.push(q("INSERT OR IGNORE INTO pt_check_flags (id, rule, subject, status, signature, title, detail, setting, lines, first_flagged_on, last_seen_on, revision) VALUES (?, ?, ?, 'open', ?, ?, ?, ?, ?, ?, ?, ?)", id, f.rule, f.subject, sig, ...body, today, today, uid()),
        audit(system, 'continuous-check.flag', 'check-flag', id, { rule: f.rule, subject: f.subject, setting: f.setting, lines: f.lines.map(l => `${l.kind}:${l.id}`) }))
      continue
    }
    const stillDismissed = row.status === 'dismissed' && row.dismissed_signature === sig
    const reopened = row.status === 'cleared' || (row.status === 'dismissed' && !stillDismissed)
    statements.push(q(`UPDATE pt_check_flags SET status = ?, signature = ?, title = ?, detail = ?, setting = ?, lines = ?, last_seen_on = ?, cleared_on = NULL,
      first_flagged_on = CASE WHEN ? THEN ? ELSE first_flagged_on END${reopened ? ', dismissed_by = NULL, dismissed_at = NULL, dismissed_reason = NULL, dismissed_signature = NULL' : ''}, revision = CASE WHEN signature = ? AND status = ? THEN revision ELSE ? END WHERE id = ?`,
      stillDismissed ? 'dismissed' : 'open', sig, ...body, today, reopened ? 1 : 0, today, sig, stillDismissed ? 'dismissed' : 'open', uid(), row.id))
    if (reopened) statements.push(audit(system, 'continuous-check.reopen', 'check-flag', row.id, { rule: f.rule, subject: f.subject, reason: row.status === 'cleared' ? 'The condition came back.' : 'The cited lines changed after the dismissal.' }))
  }
  for (const [key, row] of kept) if (!seen.has(key) && row.status === 'open') statements.push(q("UPDATE pt_check_flags SET status = 'cleared', cleared_on = ?, revision = ? WHERE id = ?", today, uid(), row.id), audit(system, 'continuous-check.clear', 'check-flag', row.id, { rule: row.rule, subject: row.subject }))
  statements.push(q('UPDATE pt_check_settings SET last_run_on = ?, last_run_at = ? WHERE id = 1', today, now()))
  for (let i = 0; i < statements.length; i += 80) await run(db, statements.slice(i, i + 80))
}

/** Open and dismissed flags (a cleared flag is history, kept in the audit log), with the rules and settings. */
export async function continuousChecksView(db: D1Database): Promise<Data> {
  const flags = (await all(db, "SELECT * FROM pt_check_flags WHERE status IN ('open', 'dismissed') ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, rule, first_flagged_on, id"))
    .map(r => ({ id: r.id, rule: r.rule, subject: r.subject, status: r.status, title: r.title, detail: r.detail, setting: JSON.parse(r.setting), lines: JSON.parse(r.lines), firstFlaggedOn: r.first_flagged_on, lastSeenOn: r.last_seen_on,
      dismissedBy: r.dismissed_by, dismissedAt: r.dismissed_at, dismissedReason: r.dismissed_reason, revision: r.revision }))
  const settings = await checkSettings(db)
  const withRuleText = flags.map(f => ({ ...f, ruleTitle: RULES.find(r => r.rule === f.rule)?.title ?? f.rule }))
  return { rules: RULES, settings, flags: withRuleText, open: flags.filter(f => f.status === 'open').length }
}

const dismiss: Command = { need: 'record', async run(c, b) {
  const flag = await one(c.db, 'SELECT * FROM pt_check_flags WHERE id = ?', text(b.id, 'Flag'))
  requireThat(flag, 'Flag not found', 404)
  requireThat(flag.status === 'open' && flag.revision === b.revision, 'This flag changed; reload', 409)
  const reason = text(b.reason, 'Reason for dismissing', 500), revision = uid()
  await run(c.db, [authority(c.actor, 'record'),
    q("UPDATE pt_check_flags SET status = 'dismissed', dismissed_by = ?, dismissed_at = ?, dismissed_reason = ?, dismissed_signature = signature, revision = ? WHERE id = ? AND status = 'open' AND revision = ?", c.actor.email, now(), reason, revision, flag.id, flag.revision), changed(),
    audit(who(c.actor), 'continuous-check.dismiss', 'check-flag', flag.id, { rule: flag.rule, subject: flag.subject, reason, lines: JSON.parse(flag.lines).map((l: Data) => `${l.kind}:${l.id}`) })])
  return continuousChecksView(c.db)
} }

/** A person asks for the run now instead of waiting for tomorrow's; it is the same run. */
const runNow: Command = { need: 'record', async run(c) {
  await runContinuousChecks(c.db, businessDay((await sendingSettings(c.db)).time_zone))
  return continuousChecksView(c.db)
} }

export const continuousCheckCommands: Record<string, Command> = { ...checkSettingsCommands, 'continuous-check.dismiss': dismiss, 'continuous-check.run': runNow }
