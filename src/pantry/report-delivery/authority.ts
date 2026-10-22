// A server-owned object identity grants only a standing read. No session or browser
// credential is manufactured, and copying fields cannot reproduce this capability.
import type { Actor, Need, Person } from '../access'
import { one } from '../db'
import type { Schedule } from './types'
type Condition = { sql: string; params: unknown[] }
const standing = new WeakMap<Actor, Condition>()
export function standingReadCondition(actor: Actor, need: Need): Condition | undefined {
  const condition = standing.get(actor)
  return condition ? need === 'read' ? condition : { sql: '0', params: [] } : undefined
}
export function scheduleCondition(s: Schedule): Condition {
  return { sql: `EXISTS(SELECT 1 FROM pt_report_schedules s JOIN oa_operators o ON o.id=s.creator_id
    WHERE s.id=? AND s.revision=? AND s.active=1 AND s.consent=1
    AND o.id=? AND lower(o.email)=? AND o.version=? AND o.status='active' AND o.role='owner')`,
  params: [s.id,s.revision,s.creator_id,s.creator_email,s.creator_version] }
}
export async function standingOwner(db: D1Database, s: Schedule): Promise<Person | null> {
  const condition = scheduleCondition(s)
  if (!await one(db, `SELECT 1 WHERE ${condition.sql}`, ...condition.params)) return null
  const actor: Person = { kind:'person', id:s.creator_id, email:s.creator_email, name:s.creator_email, session:'', role:'owner', grants:{post:false,lock:false,reopen:false} }
  standing.set(actor, condition)
  return actor
}
