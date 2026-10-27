import type { Bindings } from '../auth.server'
import { runtimeBindings } from '../auth.server'
import { authority, who, type Person } from './access'
import { limitedBanks } from './access-policy/doors'
import type { Command, Context } from './context'
import { requireThat, sha256, text, uid } from './core'
import { all, audit, one, q, run } from './db'
import { seal, unseal } from './seal'

function accountant(actor: Context['actor']): asserts actor is Person {
  requireThat(actor.kind === 'person' && ['owner', 'accountant'].includes(actor.role), 'Accountant console access is required', 403)
}

function clientOrigins(env: Bindings): string[] {
  const values = String(env.PANTRY_ACCOUNTANT_CLIENTS ?? '').split(',').map(s => s.trim()).filter(Boolean)
  requireThat(values.length <= 25, 'Too many accountant client origins', 503)
  return values.map(value => {
    const url = new URL(value)
    requireThat(url.origin === value && !url.username && !url.password && (url.protocol === 'https:' || env.AUTH_LOCAL === 'true' && url.protocol === 'http:' && ['127.0.0.1','localhost','[::1]'].includes(url.hostname)), 'Accountant client origins must be exact trusted HTTPS origins', 503)
    return value
  })
}

/** No account numbers, record text, money or credentials cross this door. */
async function summary(db: D1Database, actor: Person) {
  const entity = await one(db, 'SELECT legal_name FROM pt_entity WHERE id=1')
  const grants = { post: actor.grants.post, lock: actor.grants.lock, reopen: actor.grants.reopen }
  if (limitedBanks(actor)) return { name: entity?.legal_name ?? 'Unconfigured business', role: actor.role, grants, restricted: true, currentThrough: null, reviewQueue: null, openQuestions: null, closeStatus: null }
  const row = await one(db, `SELECT
    (SELECT MAX(end_date) FROM pt_periods WHERE status='locked') AS locked,
    (SELECT COUNT(*) FROM pt_journal_entries WHERE status='draft') +
    (SELECT COUNT(*) FROM pt_proposals WHERE status='proposed') +
    (SELECT COUNT(*) FROM pt_receipts WHERE status='review') AS reviewQueue,
    (SELECT COUNT(*) FROM pt_questions WHERE status IN ('open','confirm')) AS openQuestions`)
  return { name: entity?.legal_name ?? 'Unconfigured business', role: actor.role, grants, restricted: false,
    currentThrough: row?.locked ?? null, reviewQueue: Number(row?.reviewQueue ?? 0), openQuestions: Number(row?.openQuestions ?? 0), closeStatus: row?.locked ? `Locked through ${row.locked}` : 'No locked periods' }
}

export const accountantCommands: Record<string, Command> = {
  'accountant.status-share': { need: 'owner', async run(c, b) {
    const email = text(b.email, 'Accountant email').toLowerCase()
    const member = await one(c.db, "SELECT * FROM pt_members WHERE email=? AND active=1 AND role='accountant'", email)
    requireThat(member, 'Invite an active accountant first', 409)
    requireThat(b.consent === 'SHARE STATUS', 'Confirm sharing client status with this accountant', 400)
    const token = uid() + uid(), expiresAt = Date.now() + 86400000
    await run(c.db, [authority(c.actor, 'owner'),
      q('INSERT INTO pt_accountant_status_grants(email,token_hash,member_revision,expires_at) VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET token_hash=excluded.token_hash,member_revision=excluded.member_revision,expires_at=excluded.expires_at', email, await sha256(token), member.revision, expiresAt),
      audit(who(c.actor), 'accountant.status-share', 'accountant-status', email, { expiresAt })])
    return { token, expiresAt }
  } },
  'accountant.status-revoke': { need: 'owner', async run(c, b) {
    const email = text(b.email, 'Accountant email').toLowerCase()
    await run(c.db, [authority(c.actor, 'owner'), q('DELETE FROM pt_accountant_status_grants WHERE email=?', email), audit(who(c.actor), 'accountant.status-revoke', 'accountant-status', email)])
    return { revoked: true }
  } },
  'accountant.client-save': { need: 'read', async run(c, b) {
    accountant(c.actor)
    const origin = text(b.origin, 'Client origin')
    requireThat(clientOrigins(c.env).includes(origin), 'The installation owner has not trusted this client origin', 403)
    const token = text(b.token, 'Client status key', 256)
    requireThat(/^[a-zA-Z0-9_-]{40,256}$/.test(token), 'Enter the client status key')
    // Test the key and the recipient before keeping it. Redirects are never followed.
    await remote(c, origin, token)
    await run(c.db, [authority(c.actor, 'read'), q('INSERT INTO pt_accountant_clients(person_id,origin,token_sealed) VALUES(?,?,?) ON CONFLICT(person_id,origin) DO UPDATE SET token_sealed=excluded.token_sealed', c.actor.id, origin, await seal(c.env.SESSION_SECRET, `accountant-client:${c.actor.id}:${origin}`, token)), audit(who(c.actor), 'accountant.client-save', 'accountant-client', origin)])
    return { connected: true }
  } },
  'accountant.client-remove': { need: 'read', async run(c, b) {
    accountant(c.actor)
    const origin = text(b.origin, 'Client origin')
    await run(c.db, [authority(c.actor, 'read'), q('DELETE FROM pt_accountant_clients WHERE person_id=? AND origin=?', c.actor.id, origin), audit(who(c.actor), 'accountant.client-remove', 'accountant-client', origin)])
    return { removed: true }
  } },
}

async function remote(c: Context, origin: string, token: string) {
  const response = await fetch(origin + '/accountant-status', { redirect: 'manual', signal: AbortSignal.timeout(5000), headers: { authorization: `Bearer ${token}` } })
  requireThat(response.ok, 'Client status permission is no longer available', response.status === 401 || response.status === 403 ? 403 : 502)
  requireThat(Number(response.headers.get('content-length') ?? 0) <= 8192, 'Client status response is too large', 502)
  const body = await response.text()
  requireThat(body.length <= 8192, 'Client status response is too large', 502)
  const value = JSON.parse(body)
  requireThat(value.email === c.actor.email && value.role === 'accountant', 'Client status belongs to another accountant', 403)
  // Explicit projection: a remote installation cannot smuggle data or links into this console.
  requireThat(typeof value.name === 'string' && (typeof value.closeStatus === 'string' || value.restricted === true), 'Invalid client status', 502)
  return { origin, name: String(value.name).slice(0,200), role: 'accountant', grants: {post:value.grants?.post === true,lock:value.grants?.lock === true,reopen:value.grants?.reopen === true}, restricted:value.restricted === true,
    currentThrough: /^\d{4}-\d{2}-\d{2}$/.test(value.currentThrough) ? value.currentThrough : null,
    reviewQueue: Number.isSafeInteger(value.reviewQueue) && value.reviewQueue >= 0 ? value.reviewQueue : null,
    openQuestions: Number.isSafeInteger(value.openQuestions) && value.openQuestions >= 0 ? value.openQuestions : null,
    closeStatus: value.restricted ? null : String(value.closeStatus).slice(0,100) }
}

export async function accountantConsole(c: Context) {
  accountant(c.actor)
  const trusted = clientOrigins(c.env)
  const connections = await all(c.db, 'SELECT origin,token_sealed FROM pt_accountant_clients WHERE person_id=? ORDER BY origin', c.actor.id)
  const clients = [], unavailable = []
  for (const connection of connections) {
    if (!trusted.includes(connection.origin)) continue
    const token = await unseal(c.env.SESSION_SECRET, `accountant-client:${c.actor.id}:${connection.origin}`, connection.token_sealed)
    if (!token) { unavailable.push(connection.origin); continue }
    try { clients.push(await remote(c, connection.origin, token)) }
    catch (error) {
      // No stale status is displayed after a refusal. Network outages stay explicit.
      if (!(error instanceof Error && 'status' in error && error.status === 403)) unavailable.push(connection.origin)
    }
  }
  await run(c.db, [authority(c.actor, 'read')])
  return { clients, unavailable, trustedOrigins: trusted }
}

/** A key can read this summary only. It is never a native session or a posting credential. */
export async function accountantStatus(request: Request, original: Bindings) {
  const env = runtimeBindings(original)
  requireThat(new URL(request.url).origin === env.AUTH_ORIGIN, 'Invalid host', 403)
  const token = /^Bearer ([a-zA-Z0-9_-]{40,256})$/.exec(request.headers.get('authorization') ?? '')?.[1]
  requireThat(token, 'Client status key required', 401)
  const hash = await sha256(token)
  const member = await one(env.DB, `SELECT m.* FROM pt_accountant_status_grants g JOIN pt_members m ON m.email=g.email AND m.revision=g.member_revision
    WHERE g.token_hash=? AND g.expires_at>? AND m.active=1 AND m.role='accountant'`, hash, Date.now())
  requireThat(member, 'Client status permission removed or expired', 403)
  const actor = {kind:'person',id:'',session:'',email:member.email,name:member.name,role:'accountant',grants:{post:!!member.can_post,lock:!!member.can_lock,reopen:!!member.can_reopen},policy:{bankAccounts:member.bank_accounts === null ? null : JSON.parse(member.bank_accounts)}} as Person
  const value = await summary(env.DB, actor)
  // Recheck the grant after all reads, so a concurrent owner removal refuses the response.
  requireThat(await one(env.DB, `SELECT 1 FROM pt_accountant_status_grants g JOIN pt_members m ON m.email=g.email AND m.revision=g.member_revision WHERE g.token_hash=? AND g.expires_at>? AND m.active=1 AND m.role='accountant'`, hash, Date.now()), 'Client status permission removed or expired', 403)
  return { ...value, email: member.email }
}
