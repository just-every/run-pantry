import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

test('SALESTAX-004 the owner sees New Jersey cross 80% then 100% of its nexus threshold in Books › Sales tax at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const cmd = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const cron = async () => assert.equal((await owner.request.get(`${app.origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/30 * * * *')}`)).status(), 200)
  const { today } = await (await owner.request.get(`${app.origin}/api/pantry/sales-tax/nexus`)).json(), last = Number(today.slice(0, 4)) - 1
  await cmd('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: `${last}-01-01` })
  await cmd('chart.start', {})
  const acct = Object.fromEntries((await (await owner.request.get(`${app.origin}/api/pantry/state`)).json()).accounts.map(a => [a.code, a.id]))
  const customer = await cmd('contact.save', { kind: 'customer', name: 'Hudson Rail Partners', termsDays: 30 })
  const issue = async (issueDate, rate) => {
    const d = await cmd('invoice.save-draft', { customerId: customer.id, destinationState: 'NJ', issueDate, lines: [{ description: 'Signal design', quantity: '1', rate, accountId: acct['4000'], taxCode: 'exempt' }] })
    return cmd('invoice.issue', { id: (await cmd('invoice.approve', { id: d.id, revision: d.revision })).id })
  }
  for (const [month, rate] of [['03', '42000.00'], ['09', '42000.00']]) await issue(`${last}-${month}-15`, rate)
  await cron()
  const signedIn = await owner.storageState()
  const look = async (width, step) => {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/books`)
    await page.getByRole('tab', { name: 'Sales tax', exact: true }).click()
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Economic nexus watch', exact: true }) })
    const row = card.getByRole('row').filter({ hasText: 'New Jersey Division of Taxation' })
    await row.waitFor()
    await card.screenshot({ path: `/tmp/sx-pantry-r8-nexus-${step}-${width}.png` })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    const text = { row: await row.innerText(), card: await card.innerText() }
    await context.close()
    return text
  }
  for (const width of [1440, 390]) {
    const { row, card } = await look(width, 'eighty')
    assert.match(row, /80% alert/); assert.match(row, /\$84,000\.00/); assert.match(row, /84\.0%/); assert.match(row, new RegExp(`Calendar year ${last}`))
    assert.match(card, /NJ reached 80%/); assert.match(card, /accountant’s decision; they record it here/)
  }
  await issue(`${last}-12-15`, '20000.00')
  await cron()
  for (const width of [1440, 390]) {
    const { row, card } = await look(width, 'hundred')
    assert.match(row, /100% alert/); assert.match(row, /\$104,000\.00/); assert.match(row, /104\.0%/)
    assert.match(card, /NJ reached 100%/); assert.match(card, /NJ reached 80%/)
  }
})
