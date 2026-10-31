import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'
import { fakePlaid } from '../api/plaid.mjs'
import { providerWorker } from './provider-worker.mjs'
import { books } from './books.mjs'
import { TOKEN } from './worker.mjs'

test('REPORT-008 dashboard shows calculated balances and every waiting-work link opens its work at 1440 and 390; locking advances the date', async t => {
  const plaid = await fakePlaid()
  const app = await providerWorker({ bindings: plaid.bindings, outbound: plaid.outbound }); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  await books(owner.request, app.origin)
  const command = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const vendor = state.contacts.find(c => c.name === 'Acme Contractors'), customer = state.contacts.find(c => c.name === 'Cedar Studio')
  await command('capture-approval-rule.save', { minimum: '2500.00' })
  await command('bill.save', { vendorId: vendor.id, reference: 'ANNUAL-APPROVAL', billDate: '2026-10-01', lines: [{ description: 'Annual support', accountId: acct['6200'], amount: '3100.00' }] })
  await command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-01', lines: [{ description: 'Review draft', quantity: '1', rate: '300.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  const connection = await command('feed.connect', { publicToken: 'synthetic-pantry-2', institution: { name: 'First Platypus Bank' } })
  await command('feed.map', { itemId: connection.id, accounts: [{ id: connection.accounts.find(a => a.mask === '0000').id, bankAccountId: state.bankAccounts[0].id }] })
  await command('books-agent.run', {})
  plaid.state.loginRequired = true; await command('feed.sync', { itemId: connection.id })
  const data = await (await owner.request.get(`${app.origin}/api/pantry/dashboard?to=2026-10-31`)).json()
  assert.ok(data.work.missingReceipts && data.work.billsToApprove && data.work.brokenConnections)
  const signedIn = await owner.storageState(), money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 900 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    const home = async () => { await page.goto(`${app.origin}/app/`); await page.getByRole('heading', { name: 'Needs attention', exact: true }).waitFor() }
    const group = name => page.getByRole('region', { name, exact: true })
    await home()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    // The figures line shows the books' calculated cash, and the first question is answerable in the first screen.
    await page.locator('.figures > div').filter({ hasText: 'Cash' }).getByText(data.cash.observed ? money.format(data.cash.total / 100) : 'No feed balance yet', { exact: true }).waitFor()
    await expect(group('Questions from Pantry').locator('.attention-first').locator('button, label, textarea, select').filter({ visible: true }).first()).toBeInViewport()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-report008-dashboard-${width}.png`, fullPage: true })
    const destinations = [
      [() => group('Bank').getByRole('link', { name: /unmatched statement lines?$/ }), 'Transactions'],
      [() => group('Questions from Pantry').getByRole('link').first(), 'Questions from Pantry'],
      [() => group('Sales & bills').getByRole('link', { name: /bills? to approve$/ }), 'Bills'],
      [() => group('Bank').getByRole('link', { name: /needs you to sign in again/ }), 'Transactions'],
      [() => page.getByRole('link', { name: /Overdue receivables/ }), 'Receivables aging'],
      [() => page.getByRole('link', { name: /Overdue payables/ }), 'Payables aging'],
      [() => group('Close').getByRole('link', { name: /^Sep 2026 · \d+ missing source document/ }), 'Receipts'],
      [() => group('Sales & bills').getByRole('link', { name: /Draft$/ }).first(), 'Invoices'],
    ]
    for (const [link, heading] of destinations) {
      await home(); await link().click()
      await page.getByRole('heading', { name: new RegExp('^' + heading) }).waitFor()
    }
    await home()
    const through = page.locator('.figures > div').filter({ hasText: /^Books (up to date|locked) through/ })
    if (width === 1440) {
      await through.getByText('Not yet', { exact: true }).waitFor()
      let close = await command('close.tasks', { period: '2026-08' })
      for (const task of close.tasks) close = await command('close.task', { id: task.id, revision: task.revision, done: true })
      await page.goto(`${app.origin}/app/close?period=2026-08`)
      await page.getByRole('button', { name: 'Lock August 2026', exact: true }).click()
      await page.getByText(/Locked by/).waitFor()
      await home()
    }
    await through.filter({ hasText: 'Books locked through' }).getByText('Aug 31, 2026', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-report008-locked-${width}.png`, fullPage: true })
    assert.deepEqual(errors, []); await context.close()
  }
})
