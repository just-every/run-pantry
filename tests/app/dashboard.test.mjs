import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
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
  const signedIn = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    const home = async () => { await page.goto(`${app.origin}/app/`); await page.getByLabel('As of', { exact: true }).fill('2026-10-31'); await page.getByRole('heading', { name: 'Profit and loss trend', exact: true }).waitFor() }
    await home()
    await page.getByLabel('Dashboard basis', { exact: true }).selectOption('accrual')
    await page.getByText('Accrual basis · This month runs through', { exact: false }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r5-report008-dashboard-${width}.png`, fullPage: true })
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Balances and evidence waiting', exact: true }) }).screenshot({ path: `/tmp/sx-pantry-r5-report008-balances-${width}.png` })
    const destinations = [
      [/Unmatched statement lines/, 'Transactions'], [/Questions from Pantry/, 'Questions from Pantry'],
      [/Bills to approve/, 'Bills'], [/Connections needing attention/, 'Transactions'],
      [/Overdue receivables/, 'Receivables aging'], [/Overdue payables/, 'Payables aging'],
      [/Sep 2026 · \d+ missing source document/, 'Receipts'],
      [/Invoice drafts to review/, 'Invoices'],
    ]
    for (const [name, heading] of destinations) {
      await home(); await page.getByRole('link', { name }).click()
      await page.getByRole('heading', { name: new RegExp('^' + heading) }).waitFor()
    }
    await home(); await page.getByRole('link', { name: 'Oct 2026', exact: true }).click()
    await page.getByRole('heading', { name: /Profit and loss/ }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('to'), '2026-10-31')
    await home()
    if (width === 1440) {
      await page.getByText('No locked or fully reconciled date yet', { exact: true }).waitFor()
      let close = await command('close.tasks', { period: '2026-08' })
      for (const task of close.tasks) close = await command('close.task', { id: task.id, revision: task.revision, done: true })
      await page.goto(`${app.origin}/app/close?period=2026-08`)
      await page.getByRole('button', { name: 'Lock August 2026', exact: true }).click()
      await page.getByText(/Locked by/).waitFor()
      await home()
    }
    await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Books up to date through', exact: true }) }).getByText('Aug 31, 2026', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-report008-locked-${width}.png`, fullPage: true })
    assert.deepEqual(errors, []); await context.close()
  }
})
