// Who is acting and what they may do. Every handler resolves the actor, checks
// the capability it needs, and puts the same check into its write batch as a
// guard, so a role removed or a session revoked mid-request still stops the write.
import { operatorAuth, runtimeBindings, type Bindings } from '../auth.server'
import { Fault, requireThat, sha256 } from './core'
import { guard, one, type AuditActor, type Sql } from './db'

export type Need = 'read' | 'record' | 'post' | 'lock' | 'reopen' | 'owner'
export type Role = 'owner' | 'bookkeeper' | 'accountant' | 'viewer'

export type Person = {
  kind: 'person'; id: string; email: string; name: string; session: string; role: Role
  grants: { post: boolean; lock: boolean; reopen: boolean }
}
export type Agent = { kind: 'agent'; id: string; email: string; name: string; tokenHash: string }
export type Integration = { kind: 'integration'; id: string; email: string; name: string; tokenHash: string; scope: string }
export type Actor = Person | Agent | Integration

export async function person(request: Request, original: Bindings): Promise<Person> {
  const env = runtimeBindings(original)
  requireThat(new URL(request.url).origin === env.AUTH_ORIGIN, 'Invalid host', 403)
  if (!['GET', 'HEAD'].includes(request.method))
    requireThat(request.headers.get('origin') === env.AUTH_ORIGIN && request.headers.get('sec-fetch-site') !== 'cross-site', 'Invalid origin', 403)
  const session = await operatorAuth(env).getSession(request)
  requireThat(session, 'Sign in required', 401)
  const base = { kind: 'person' as const, id: session.operator.id, email: session.operator.email.toLowerCase(), name: session.operator.displayName, session: session.id }
  if (session.operator.role === 'owner') return { ...base, role: 'owner', grants: { post: true, lock: true, reopen: true } }
  const member = await one<{ name: string; role: Role; can_post: number; can_lock: number; can_reopen: number }>(env.DB, 'SELECT * FROM pt_members WHERE email = ? AND active = 1', base.email)
  requireThat(member, env.AUTH_LOCAL === 'true' && base.email.endsWith('@dev.localhost')
    ? `${base.email} has no role in these books yet. Sign out, sign in as the owner, and add ${base.email} under People & settings › People with the role to try.`
    : 'You have no role in these books; ask the owner to add you', 403)
  return { ...base, name: member.name, role: member.role, grants: { post: !!member.can_post && member.role !== 'viewer', lock: !!member.can_lock && member.role !== 'viewer', reopen: !!member.can_reopen && member.role !== 'viewer' } }
}

export async function agent(request: Request, env: Bindings): Promise<Agent> {
  requireThat(new URL(request.url).origin === runtimeBindings(env).AUTH_ORIGIN, 'Invalid host', 403)
  const header = request.headers.get('authorization') ?? ''
  const token = /^Bearer (pantry_agent_[A-Za-z0-9_-]{32,})$/.exec(header)?.[1]
  requireThat(token, 'Agent token required', 401)
  const tokenHash = await sha256(token)
  const row = await one<{ id: string; name: string }>(env.DB, 'SELECT id, name FROM pt_agents WHERE token_hash = ? AND active = 1', tokenHash)
  requireThat(row, 'Agent token is not active', 401)
  return { kind: 'agent', id: row.id, name: row.name, email: `agent:${row.name}`, tokenHash }
}

export function allowed(actor: Person, need: Need) {
  if (actor.role === 'owner') return true
  if (need === 'read') return true
  if (need === 'owner') return false
  if (actor.role === 'viewer') return false
  if (need === 'record') return true
  return actor.grants[need]
}

export function must(actor: Actor, need: Need) {
  if (actor.kind === 'integration') throw new Fault(403, 'Integration credentials use only the integration API')
  if (actor.kind === 'agent') throw new Fault(403, 'Agents prepare proposals; a person approves them')
  if (!allowed(actor, need)) throw new Fault(403, ({ read: 'Viewing', record: 'Recording', post: 'Posting', lock: 'Locking periods', reopen: 'Approving reopening', owner: 'Owner access' } as const)[need] + ' is not part of your role')
}

const sessionLive = "EXISTS (SELECT 1 FROM oa_sessions se JOIN oa_operators o ON o.id = se.operator_id WHERE se.id = ? AND o.id = ? AND o.version = se.operator_version AND o.status = 'active' AND se.revoked_at IS NULL AND se.expires_at > unixepoch() * 1000"

/** The capability check as a scalar SQL condition, for guards and the import kit's fences. */
export function authorityCondition(actor: Actor, need: Need): { sql: string; params: unknown[] } {
  if (actor.kind === 'integration') return {
    sql: `EXISTS (SELECT 1 FROM pt_integrations i WHERE i.id = ? AND i.token_hash = ? AND i.revoked_at IS NULL AND EXISTS (SELECT 1 FROM json_each(i.scopes) WHERE value = ?)${need === 'post' ? " AND EXISTS (SELECT 1 FROM json_each(i.scopes) WHERE value = 'post')" : ''})`,
    params: [actor.id, actor.tokenHash, actor.scope],
  }
  if (actor.kind === 'agent') return { sql: 'EXISTS (SELECT 1 FROM pt_agents WHERE id = ? AND token_hash = ? AND active = 1)', params: [actor.id, actor.tokenHash] }
  if (actor.role === 'owner') return { sql: `${sessionLive} AND o.role = 'owner')`, params: [actor.session, actor.id] }
  const grant = need === 'post' ? 'AND m.can_post = 1' : need === 'lock' ? 'AND m.can_lock = 1' : need === 'reopen' ? 'AND m.can_reopen = 1' : ''
  const role = need === 'read' ? '' : "AND m.role <> 'viewer'"
  return { sql: `${sessionLive}) AND EXISTS (SELECT 1 FROM pt_members m WHERE m.email = ? AND m.active = 1 ${role} ${grant})`, params: [actor.session, actor.id, actor.email] }
}

/** The capability check evaluated inside the write batch. */
export function authority(actor: Actor, need: Need): Sql {
  const c = authorityCondition(actor, need)
  return guard(c.sql, ...c.params)
}

export const who = (actor: Actor | AuditActor): AuditActor => ({ email: actor.email, kind: actor.kind })

/** Pantry itself, acting in due work or on a provider's confirmation; `role` names the job. */
export const pantry = (role: 'reminders' | 'recurring' | 'auto-match' | 'stripe' | 'gusto' | 'customer'): AuditActor => ({ email: `pantry:${role}`, kind: 'system' })

/** Who the owner is now: the active owner operator, else the install's configured owner email. */
export async function ownerEmail(db: D1Database, env: Bindings) {
  const row = await one<{ email: string }>(db, "SELECT lower(email) AS email FROM oa_operators WHERE role = 'owner' AND status = 'active' ORDER BY created_at LIMIT 1")
  return (row?.email ?? String(runtimeBindings(env).OWNER_EMAIL ?? '')).trim().toLowerCase()
}
