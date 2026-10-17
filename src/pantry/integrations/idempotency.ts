import type { Context } from '../context'
import { authority, type Integration } from '../access'
import { type Data, Fault, now, requireThat, sha256, text } from '../core'
import { one, q, run, type Sql } from '../db'

// Object key order is immaterial; array order remains part of the request.
function canonical(value: unknown): string {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => JSON.stringify(k) + ':' + canonical(v)).join(',') + '}'
  return JSON.stringify(value)
}
export type Prepared = { id: string; kind: string; statements: Sql[] }

/** The identity claim and posting commit together; there is no pending claim to strand. */
export async function idempotent(c: Context & { actor: Integration }, operation: string, body: Data,
  prepare: () => Promise<Prepared>, read: (id: string) => Promise<Data>) {
  const key = text(c.request.headers.get('idempotency-key'), 'Idempotency-Key header', 200)
  const hash = await sha256(canonical(body))
  const previous = async () => {
    const old = await one(c.db, 'SELECT * FROM pt_integration_requests WHERE credential_id = ? AND request_key = ?', c.actor.id, key)
    if (!old) return null
    requireThat(old.operation === operation && old.request_hash === hash, 'This Idempotency-Key was used for a different request; use a new key for a new action', 409)
    await run(c.db, [authority(c.actor, 'read')])
    return read(old.target_id)
  }
  const found = await previous()
  if (found) return found
  let p: Prepared
  try {
    p = await prepare()
    await run(c.db, [authority(c.actor, 'record'),
      q('INSERT INTO pt_integration_requests (credential_id,request_key,operation,request_hash,target_kind,target_id,created_at) VALUES (?,?,?,?,?,?,?)', c.actor.id, key, operation, hash, p.kind, p.id, now()),
      ...p.statements])
  } catch (error) {
    // A winner may commit during preparation (closing the allocated invoice),
    // or during our atomic batch. Its identity also resolves that validation race.
    if (error instanceof Fault && (error.status === 400 || error.status === 409)) {
      const winner = await previous()
      if (winner) return winner
    }
    throw error
  }
  return read(p.id)
}
