// Plaid at the network edge: recorded responses (fixtures/plaid, in the shapes
// Plaid's API reference documents) served by endpoint and sync cursor, and
// webhooks signed with an ES256 key whose public half /webhook_verification_key/get returns.
import { createHash, webcrypto } from 'node:crypto'
import { fixture } from './harness.mjs'

const b64url = bytes => Buffer.from(bytes).toString('base64url')
const load = async name => JSON.parse(await fixture(`plaid/${name}.json`))

export async function fakePlaid() {
  const recorded = Object.fromEntries(await Promise.all(['link-token-create', 'item-public-token-exchange', 'accounts-get', 'transactions-sync-1', 'transactions-sync-2', 'transactions-sync-3', 'item-login-required'].map(async n => [n, await load(n)])))
  const pages = [recorded['transactions-sync-1'], recorded['transactions-sync-2'], recorded['transactions-sync-3']]
  const { publicKey, privateKey } = await webcrypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'])
  const kid = 'bfbd5111-8e33-4643-8ced-b2e642a72f3c'
  const state = { calls: [], updatesArrived: false, loginRequired: false }
  const answer = (value, status = 200) => Response.json(value, { status })

  async function outbound(request) {
    const url = new URL(request.url), body = await request.json()
    if (url.origin !== 'https://sandbox.plaid.com') throw new Error(`unexpected outbound ${request.method} ${request.url}`)
    if (body.client_id !== 'test-client-id' || body.secret !== 'test-sandbox-secret') return answer({ error_type: 'INVALID_INPUT', error_code: 'INVALID_API_KEYS', error_message: 'invalid client_id or secret provided', display_message: null }, 400)
    state.calls.push({ path: url.pathname, body })
    switch (url.pathname) {
      case '/link/token/create': return answer(recorded['link-token-create'])
      case '/item/public_token/exchange': return answer(recorded['item-public-token-exchange'])
      case '/accounts/get': return answer(recorded['accounts-get'])
      case '/item/remove': return answer({ request_id: 'gk2Xg' })
      case '/webhook_verification_key/get': return answer({ key: { ...(await webcrypto.subtle.exportKey('jwk', publicKey)), alg: 'ES256', kid, use: 'sig', created_at: 1760000000, expired_at: null }, request_id: 'Ki0Vb' })
      case '/transactions/sync': {
        if (state.loginRequired) return answer(recorded['item-login-required'], 400)
        const at = body.cursor ? pages.findIndex(p => p.next_cursor === body.cursor) + 1 : 0
        if (at === 2 && !state.updatesArrived || at >= pages.length) return answer({ accounts: [], added: [], modified: [], removed: [], has_more: false, next_cursor: body.cursor, request_id: 'quiet' })
        return answer(pages[at])
      }
    }
    throw new Error(`unrecorded Plaid call ${url.pathname}`)
  }

  /** A webhook body and its Plaid-Verification header. */
  async function webhook(payload, { tamper = false } = {}) {
    const body = JSON.stringify({ environment: 'sandbox', item_id: recorded['item-public-token-exchange'].item_id, ...payload })
    const head = b64url(JSON.stringify({ alg: 'ES256', kid, typ: 'JWT' }))
    const claims = b64url(JSON.stringify({ iat: Math.floor(Date.now() / 1000), request_body_sha256: createHash('sha256').update(body).digest('hex') }))
    const signature = b64url(new Uint8Array(await webcrypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, privateKey, Buffer.from(`${head}.${claims}`))))
    return { body: tamper ? body.replace('sandbox', 'production') : body, jwt: `${head}.${claims}.${signature}` }
  }

  return { outbound, webhook, state, recorded, bindings: { PLAID_CLIENT_ID: 'test-client-id', PLAID_SECRET: 'test-sandbox-secret', PLAID_ENV: 'sandbox' } }
}
