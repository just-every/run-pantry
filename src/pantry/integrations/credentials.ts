import { runtimeBindings, type Bindings } from '../../auth.server'
import { authority, type Integration, who } from '../access'
import type { Command, Context } from '../context'
import { list, now, requireThat, sha256, text, uid } from '../core'
import { all, audit, changed, one, q, run } from '../db'

export const SCOPES = [
  { id: 'contacts:write', label: 'Contacts', help: 'Read and upsert customers and vendors.' },
  { id: 'invoices:write', label: 'Invoices', help: 'Read and create invoices and credits.' },
  { id: 'bills:write', label: 'Bills', help: 'Read and create bills; mark received and ready to pay.' },
  { id: 'journals:write', label: 'Journals', help: 'Read and create balanced journal entries.' },
  { id: 'documents:write', label: 'Documents', help: 'Read and attach source documents.' },
  { id: 'payments:read', label: 'Payments readback', help: 'Read payments, allocations and reversals; cannot move money.' },
  { id: 'reports:read', label: 'Reports', help: 'Read the trial balance.' },
  { id: 'post', label: 'Post approved sibling records', help: 'Post bills and journals and issue invoices. Without this grant, they stay drafts.' },
]

const create: Command = { need: 'owner', async run(c, b) {
  const name = text(b.name, 'Integration name', 100)
  const scopes = [...new Set(list<string>(b.scopes, 'Scopes', SCOPES.length))]
  requireThat(scopes.length && scopes.every(s => SCOPES.some(v => v.id === s)), 'Choose at least one listed scope')
  requireThat(scopes.some(s => s !== 'post'), 'Choose a record scope as well as the posting grant')
  const id = uid(), token = 'pantry_integration_' + Array.from(crypto.getRandomValues(new Uint8Array(32)), n => n.toString(16).padStart(2, '0')).join('')
  await run(c.db, [authority(c.actor, 'owner'),
    q('INSERT INTO pt_integrations (id,name,token_hash,scopes,created_by,created_at) VALUES (?,?,?,?,?,?)', id, name, await sha256(token), JSON.stringify(scopes), c.actor.email, now()),
    audit(who(c.actor), 'integration.create', 'integration', id, { name, scopes })])
  return { id, name, token, scopes }
} }
const revoke: Command = { need: 'owner', async run(c, b) {
  const id = text(b.id, 'Credential')
  await run(c.db, [authority(c.actor, 'owner'), q('UPDATE pt_integrations SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL', now(), id), changed(), audit(who(c.actor), 'integration.revoke', 'integration', id)])
  return { id }
} }
export const integrationCommands = { 'integration.create': create, 'integration.revoke': revoke }

export async function integrationSettings(c: Context, cursor?: string) {
  const credentials = await all(c.db, 'SELECT id,name,scopes,created_by,created_at,revoked_at FROM pt_integrations ORDER BY created_at DESC,id')
  const before = cursor ? await one(c.db, 'SELECT at,id FROM pt_integration_calls WHERE id = ?', cursor) : null
  requireThat(!cursor || before, 'Audit cursor not found', 400)
  const calls = await all(c.db, `SELECT c.*,i.name FROM pt_integration_calls c JOIN pt_integrations i ON i.id = c.credential_id ${before ? 'WHERE (c.at,c.id) < (?,?)' : ''} ORDER BY c.at DESC,c.id DESC LIMIT 101`, ...(before ? [before.at, before.id] : []))
  const more = calls.length > 100
  if (more) calls.pop()
  return { credentials: credentials.map(r => ({ ...r, scopes: JSON.parse(r.scopes) })), scopes: SCOPES,
    calls, nextCursor: more ? calls.at(-1)!.id : null }
}

/** Also resolves a revoked credential, so its refused calls still have an audit identity. */
export async function identify(request: Request, env: Bindings): Promise<(Integration & { scopes: string[]; revoked: boolean }) | null> {
  requireThat(new URL(request.url).origin === runtimeBindings(env).AUTH_ORIGIN, 'Invalid host', 403)
  const token = /^Bearer (pantry_integration_[a-f0-9]{64})$/.exec(request.headers.get('authorization') ?? '')?.[1]
  if (!token) return null
  const tokenHash = await sha256(token)
  const row = await one(env.DB, 'SELECT id,name,scopes,revoked_at FROM pt_integrations WHERE token_hash = ?', tokenHash)
  if (!row) return null
  return { kind: 'integration', id: row.id, name: row.name, email: `integration:${row.id}:${row.name}`, tokenHash, scope: '', scopes: JSON.parse(row.scopes), revoked: !!row.revoked_at }
}
