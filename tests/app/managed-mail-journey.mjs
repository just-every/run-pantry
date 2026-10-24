import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'

export async function managedMailJourney(t) {
  const relayUrl = 'https://management.example.test/api/managed-mail/send'
  const sender = 'apps@example.test', apiKey = 'synthetic-pantry-125', mail = []
  const app = await providerWorker({ bindings: { AUTH_LOCAL: 'false', MAIL_PROVIDER: 'rer', MAIL_FROM: sender, MAIL_RELAY_URL: relayUrl, MAIL_API_KEY: apiKey }, outbound: async request => {
    assert.equal(request.url, relayUrl)
    assert.equal(request.method, 'POST')
    assert.equal(request.headers.get('authorization'), `Bearer ${apiKey}`)
    const message = await request.json()
    assert.equal(message.to, 'owner@example.test')
    // The relay assigns the sender from this installation's credential.
    assert.equal(Object.hasOwn(message, 'from'), false)
    mail.push(message)
    return Response.json({ messageId: '<synthetic-pantry-125@mail.example.test>' }, { status: 202 })
  } }); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const contextOptions = { extraHTTPHeaders: { 'CF-Connecting-IP': '192.0.2.125' } }
  const owner = await browser.newContext(contextOptions); t.after(() => owner.close())
  const { origin } = app
  assert.equal((await owner.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await owner.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const business = await owner.request.post(`${origin}/api/pantry/command/entity.save`, { headers: { origin }, data: { legalName: 'Redwood Builders LLC', entityType: 'single-member-llc', state: 'CA', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01' } })
  assert.equal(business.status(), 200)
  const evidence = process.env.PANTRY_EVIDENCE_DIR
  if (evidence) await mkdir(evidence, { recursive: true })
  for (const width of [1440, 390]) {
    const visitor = await browser.newContext({ ...contextOptions, viewport: { width, height: 1000 } }); t.after(() => visitor.close())
    const page = await visitor.newPage()
    await page.goto(`${origin}/signin`)
    await page.getByLabel('Email', { exact: true }).fill('owner@example.test')
    await page.getByRole('button', { name: 'Email a sign-in link', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Check your email')
    assert.equal(mail.length, width === 1440 ? 1 : 2)
    if (evidence) await page.screenshot({ path: `${evidence}/mail-sent-${width}.png`, fullPage: true })
    const link = mail.at(-1).text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]
    await page.goto(link)
    await page.getByRole('button', { name: 'Sign in', exact: true }).click()
    await expect(page.getByRole('heading', { name: 'Redwood Builders LLC', exact: true })).toBeVisible()
    if (evidence) await page.screenshot({ path: `${evidence}/mail-signed-in-${width}.png`, fullPage: true })
    await visitor.close()
  }
  const unconfigured = await providerWorker({ bindings: { AUTH_LOCAL: 'false', MAIL_PROVIDER: '', MAIL_FROM: sender }, outbound: () => { assert.fail('Unconfigured mail must not reach a transport') } }); t.after(() => unconfigured.close())
  const refused = await owner.request.post(`${unconfigured.origin}/auth/magic-link`, { headers: { origin: unconfigured.origin }, data: { email: 'owner@example.test' } })
  assert.equal(refused.status(), 503)
  assert.equal((await refused.json()).error, 'mail_unavailable')
}
