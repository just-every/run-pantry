// Plaid webhooks, verified as Plaid documents: the Plaid-Verification header is
// an ES256 JWT signed by a key fetched from /webhook_verification_key/get, issued
// within five minutes, carrying the SHA-256 of the exact body. A verified
// webhook only marks work due or records what the bank said; the sync itself
// still pulls from Plaid with this installation's own token.
import type { Bindings } from '../../auth.server'
import { Fault, now, sha256, uid } from '../core'
import { one, q, run } from '../db'
import { plaid, relinkMessage, RELINK_CODES } from './plaid'

const keys = new Map<string, CryptoKey>()
const unb64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0))
const json = (s: string) => JSON.parse(new TextDecoder().decode(unb64url(s)))

export async function verify(env: Bindings, jwt: string | null, body: string) {
  const parts = (jwt ?? '').split('.')
  if (parts.length !== 3) throw new Fault(401, 'Webhook is not signed')
  const header = json(parts[0])
  if (header.alg !== 'ES256' || typeof header.kid !== 'string') throw new Fault(401, 'Webhook signature uses an unexpected algorithm')
  let key = keys.get(header.kid)
  if (!key) {
    const { key: jwk } = await plaid(env).verificationKey(header.kid)
    if (jwk.expired_at) throw new Fault(401, 'Webhook signed with an expired key')
    key = await crypto.subtle.importKey('jwk', { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y }, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify'])
    keys.set(header.kid, key)
  }
  const ok = await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, key, unb64url(parts[2]), new TextEncoder().encode(`${parts[0]}.${parts[1]}`))
  if (!ok) throw new Fault(401, 'Webhook signature does not verify')
  const claims = json(parts[1])
  if (typeof claims.iat !== 'number' || Math.abs(Date.now() / 1000 - claims.iat) > 300) throw new Fault(401, 'Webhook is too old')
  if (claims.request_body_sha256 !== await sha256(body)) throw new Fault(401, 'Webhook body does not match its signature')
}

/** Act on a verified webhook. Returns the connection to sync now, if any. */
export async function receive(env: Bindings, body: { webhook_type?: string; webhook_code?: string; item_id?: string; error?: { error_code?: string; error_message?: string; display_message?: string } | null }) {
  const item = body.item_id ? await one(env.DB, 'SELECT id, status FROM pt_feed_items WHERE item_id = ?', body.item_id) : null
  if (!item) return null
  const type = body.webhook_type, code = body.webhook_code
  if (type === 'TRANSACTIONS' && item.status === 'active') {
    await run(env.DB, [q('UPDATE pt_feed_items SET sync_due_at = ? WHERE id = ?', now(), item.id)])
    return item.id as string
  }
  if (type === 'ITEM') {
    const errorCode = code === 'ERROR' ? body.error?.error_code ?? '' : code ?? ''
    if (RELINK_CODES.has(errorCode)) {
      const message = relinkMessage(errorCode, body.error?.display_message)
      await run(env.DB, [q("UPDATE pt_feed_items SET status = 'relink', error_code = ?, error_message = ?, revision = ? WHERE id = ? AND status <> 'disconnected'", errorCode, message, uid(), item.id)])
      return null
    }
    if (code === 'LOGIN_REPAIRED') {
      await run(env.DB, [q("UPDATE pt_feed_items SET status = 'active', error_code = '', error_message = '', sync_due_at = ?, revision = ? WHERE id = ? AND status = 'relink'", now(), uid(), item.id)])
      return item.id as string
    }
  }
  return null
}
