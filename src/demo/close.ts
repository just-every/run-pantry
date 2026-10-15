// Closes a sample month the way a person would: match each statement line to the
// ledger line it clears, complete each statement's reconciliation, then lock the
// period. Pantry's own match, reconciliation and lock plans validate every step;
// the seed only dates the finished close in the following week.
import type { Person } from '../pantry/access'
import { lockPlan } from '../pantry/close'
import { one, q, run } from '../pantry/db'
import { matchPlan } from '../pantry/matching'
import { completion } from '../pantry/reconcile'

type Plan = { matches: [string, string][]; statements: string[]; note: string; reconciledAt: string; lockedAt: string }

export async function closeMonth(db: D1Database, owner: { id: string; email: string; name: string }, period: string, plan: Plan) {
  if (await one(db, "SELECT 1 FROM pt_periods WHERE id = ? AND status = 'locked'", period)) return
  const actor: Person = { kind: 'person', id: owner.id, email: owner.email.toLowerCase(), name: owner.name, session: '', role: 'owner', grants: { post: true, lock: true, reopen: true } }
  for (const [bankLineId, journalLineId] of plan.matches) {
    if (await one(db, 'SELECT 1 FROM pt_match_bank_lines WHERE bank_line_id = ? AND active = 1', bankLineId)) continue
    await run(db, (await matchPlan(db, actor, { bankLineIds: [bankLineId], journalLineIds: [journalLineId], create: [] })).statements)
  }
  for (const statementId of plan.statements)
    if (!await one(db, 'SELECT 1 FROM pt_reconciliations WHERE statement_id = ?', statementId)) await run(db, (await completion(db, actor, statementId)).statements)
  await run(db, await lockPlan(db, actor, period, plan.note))
  const statements = plan.statements.map(() => '?').join(',')
  await run(db, [
    q(`UPDATE pt_matches SET approved_at = ? WHERE reconciliation_id IN (SELECT id FROM pt_reconciliations WHERE statement_id IN (${statements}))`, plan.reconciledAt, ...plan.statements),
    q(`UPDATE pt_reconciliations SET completed_at = ? WHERE statement_id IN (${statements})`, plan.reconciledAt, ...plan.statements),
    q('UPDATE pt_periods SET locked_at = ? WHERE id = ?', plan.lockedAt, period),
    q("UPDATE pt_approvals SET at = ? WHERE subject_kind = 'period' AND subject_id = ? AND action = 'lock'", plan.lockedAt, period),
    q("UPDATE pt_audit SET at = ? WHERE action IN ('match.approve', 'reconciliation.complete')", plan.reconciledAt),
    q("UPDATE pt_audit SET at = ? WHERE action = 'period.lock' AND subject_id = ?", plan.lockedAt, period),
  ])
}
