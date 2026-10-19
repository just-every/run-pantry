import test from 'node:test'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { checkJourney } from './check-journey.mjs'

test('CHECK-001 write, align, print and void checks with bank CSV and cleared status at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(), origin = app.origin
  await owner.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  await checkJourney({ browser, owner, origin })
  await owner.close()
})
