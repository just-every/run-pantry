import assert from 'node:assert/strict'
import { randomBytes } from 'node:crypto'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'
import { ownerSigninDigest } from '../../src/modules/operator-auth/owner-signin-grant.mjs'

// A deploy with MAIL_PROVIDER=none (rer's mail-off route): no sign-in mail is offered or sent, and the owner
// still gets in with the one-time link `rer signin` writes into the auth database.
export async function mailOffJourney(t) {
  const app = await providerWorker({ bindings: { MAIL_PROVIDER: 'none', MAIL_FROM: '' }, outbound: () => assert.fail('Mail off must not reach a transport') }); t.after(() => app.close())
  const { origin, db } = app
  const post = (path, init = {}) => fetch(origin + path, { method: 'POST', redirect: 'manual', ...init, headers: { origin, 'content-type': 'application/json', ...init.headers } })
  const bootstrap = await post('/auth/bootstrap', { body: JSON.stringify({ token: TOKEN, displayName: 'Olivia Owner' }) })
  assert.equal(bootstrap.status, 303)

  // The sign-in page offers no email link, and asking for one is refused.
  const page = await (await fetch(`${origin}/signin`)).text()
  assert.doesNotMatch(page, /Email a sign-in link/)
  const refused = await post('/auth/magic-link', { body: JSON.stringify({ email: 'owner@example.test' }) })
  assert.equal(refused.status, 503)
  assert.equal((await refused.json()).error, 'mail_unavailable')

  // `rer signin`: a grant row for the active owner, then the link opens once.
  const token = randomBytes(32).toString('base64url')
  const now = Date.now()
  const written = await db.prepare(`INSERT INTO oa_owner_signins(id,token_hash,operator_id,operator_version,created_at,expires_at)
    SELECT ?,?,o.id,o.version,?,? FROM oa_operators o WHERE o.role='owner' AND o.status='active' LIMIT 1`)
    .bind(crypto.randomUUID(), await ownerSigninDigest(token), now, now + 600_000).run()
  assert.equal(written.meta.changes, 1)
  assert.equal((await fetch(`${origin}/auth/owner-signin?token=${token}`)).status, 200)
  const entered = await post('/auth/owner-signin', { body: JSON.stringify({ token }) })
  assert.equal(entered.status, 303)
  const cookie = entered.headers.getSetCookie().map(value => value.split(';')[0]).join('; ')
  const session = await fetch(`${origin}/auth/session`, { headers: { cookie } })
  assert.equal(session.status, 200)
  assert.match(JSON.stringify(await session.json()), /owner@example\.test/)
  const again = await post('/auth/owner-signin', { body: JSON.stringify({ token }) })
  assert.notEqual(again.status, 303)
}
