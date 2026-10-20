// Connecting Xero on a local `rer dev` Pantry, as the owner does it: sign in with the
// RER_OPEN link, choose Connect Xero, and come back from Xero's own site. The callback
// must find the owner still signed in and keep the connection; a callback carrying a
// state this sign-in did not start, or none, is still refused.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { chromium } from '@playwright/test'
import { harness } from './harness.mjs'
import { fakeXero, xeroExports } from './xero.mjs'

const DEV_KEY = 'fixture-dev-key-0123456789abcdefghijklmnopqrstuvwxyz'

test('XERO-001 connecting Xero from local dev returns the owner signed in with Xero connected', async t => {
  const xero = await fakeXero()
  const h = await harness({ entry: 'tests/api/dev-worker.ts', bindings: { ...xero.bindings, RER_DEV_KEY: DEV_KEY }, outbound: xero.outbound }); t.after(() => h.close())
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-09-01' })
  const pkg = await xeroExports()
  await h.command('move-in.commit', { ...pkg, fingerprint: (await h.command('move-in.preview', pkg)).fingerprint })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const xeroSite = await providerSite(); t.after(() => xeroSite.close())
  const context = await browser.newContext(), page = await context.newPage()
  assert.equal((await h.send('/setup', undefined, { cookie: h.owner, raw: 'confirm=yes', headers: { 'content-type': 'application/x-www-form-urlencoded' } })).status, 303)
  await page.goto(`${h.origin}/__dev/key#rer-dev=${DEV_KEY}&as=owner`)
  await page.waitForURL(`${h.origin}/app`)
  const signedIn = async () => { const r = await context.request.get(`${h.origin}/auth/session`); return r.ok() ? (await r.json()).operator.email : r.status() }
  assert.equal(await signedIn(), 'owner@example.test')
  const { url } = await page.evaluate(async () => (await fetch('/api/pantry/command/move-in.xero.connect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })).json())
  const authorize = new URL(url), callback = authorize.searchParams.get('redirect_uri')
  assert.equal(callback, `${h.origin}/api/pantry/xero/callback`)
  const returnFromXero = async query => {
    const back = await xeroSite.allow(page, `${callback}?${new URLSearchParams(query)}`)
    assert.equal((await back.request().allHeaders())['sec-fetch-site'], 'cross-site', 'Xero sends the browser back from its own site')
    assert.equal(back.status(), 303, await back.text().catch(() => ''))
    return back.headers().location
  }
  assert.match(await returnFromXero({ code: 'recorded-authorization-code', state: 'forged' }), /^\/app\/move-in\?xero_error=/, 'a state this sign-in did not start is refused')
  assert.match(await returnFromXero({ code: 'recorded-authorization-code' }), /^\/app\/move-in\?xero_error=/, 'a missing state is refused')
  assert.equal(await returnFromXero({ code: 'recorded-authorization-code', state: authorize.searchParams.get('state') }), '/app/move-in?xero=connected')
  assert.equal(await signedIn(), 'owner@example.test', 'the owner is still signed in')
  const kept = await h.db.prepare('SELECT status, tenant_name, connected_by FROM pt_xero_connection').first()
  assert.deepEqual({ ...kept }, { status: 'connected', tenant_name: 'Juniper Lane Design LLC', connected_by: 'owner@example.test' })
})

// The provider's own site (localhost, while Pantry is on 127.0.0.1): an Allow link
// that 302s back to the callback, as Xero's consent page does.
async function providerSite() {
  const server = createServer((request, response) => {
    const url = new URL(request.url, 'http://localhost'), to = url.searchParams.get('to')
    if (url.pathname === '/allow') return response.writeHead(302, { location: to }).end()
    response.writeHead(200, { 'content-type': 'text/html' }).end(`<a href="/allow?to=${encodeURIComponent(to)}">Allow access</a>`)
  })
  await new Promise(resolve => server.listen(0, 'localhost', resolve))
  const origin = `http://localhost:${server.address().port}`
  return {
    async allow(page, to) {
      await page.goto(`${origin}/?to=${encodeURIComponent(to)}`)
      const [response] = await Promise.all([page.waitForResponse(r => r.url() === to), page.getByRole('link', { name: 'Allow access' }).click()])
      return response
    },
    close: () => new Promise(resolve => server.close(resolve)),
  }
}
