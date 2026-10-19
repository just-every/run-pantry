import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { budgetJourney } from './budget-journey.mjs'

test('BUDGET-001 copy last year plus 5%, edit a month, inspect quarterly variances and import CSV/Easel plans at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const storageState = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 1000 } })
    await budgetJourney(context, app.origin, width)
    await context.close()
  }
})
