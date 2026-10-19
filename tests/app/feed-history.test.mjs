import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { fakePlaid } from '../api/plaid.mjs'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'

test('BANK-002 history choices, reference-only observations and duplicate decisions through the built Bank screens at 1440 and 390', async t => {
  const plaid = await fakePlaid(), provider = plaid.recorded['accounts-get'].accounts.find(a => a.mask === '0000').account_id
  const txn = (id, date, name, amount) => ({ transaction_id: id, account_id: provider, date, name, amount, pending: false })
  const delivered = [txn('pre-books', '2025-09-05', 'EARLY HARDWARE', 64.18), txn('locked', '2026-09-05', 'LOCKED SOFTWARE', 50), txn('doubt-1440', '2026-10-05', 'BANK STAPLES 1440', 10), txn('doubt-390', '2026-10-06', 'BANK STAPLES 390', 20)]
  let cursor = 0
  const app = await providerWorker({ bindings: plaid.bindings, outbound: request => new URL(request.url).pathname === '/transactions/sync'
    ? Response.json({ added: delivered, modified: [], removed: [], has_more: false, next_cursor: `history-${++cursor}` }) : plaid.outbound(request) }); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => {
    const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json()
  }
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue when invoiced.' })
  await command('chart.start', {})
  let close = await command('close.tasks', { period: '2026-09' })
  for (const task of close.tasks) close = await command('close.task', { id: task.id, revision: task.revision, done: true })
  await command('period.lock', { period: '2026-09' })
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'First Platypus Bank', accountId: acct['1000'], numberLast4: '0000', openingDate: '2025-08-31', openingBalance: '0' })
  const statement = await command('statement.import', { bankAccountId: bank.id, fileName: 'october.csv', content: 'Posting Date,Description,Amount\n10/05/2026,STATEMENT STAPLES 1440,-10.00\n10/06/2026,STATEMENT STAPLES 390,-20.00\n', opening: '0', closing: '-30', start: '2026-10-01', end: '2026-10-08', confirmLast4: '0000' })
  const lines = (await (await owner.request.get(`${app.origin}/api/pantry/bank/lines`)).json()).lines
  for (const l of lines) await command('match.approve', { bankLineIds: [l.id], create: [{ type: 'fee', amount: (Math.abs(l.amount_cents) / 100).toFixed(2), accountId: acct['6200'] }] })
  await command('reconciliation.complete', { statementId: statement.statement.id })
  const proof = (await (await owner.request.get(`${app.origin}/api/pantry/reconciliation/${statement.statement.id}`)).json()).completed
  const connection = await command('feed.connect', { publicToken: 'history-browser-public-token', institution: { name: 'First Platypus Bank' } })
  const signedIn = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/bank/connect?connection=${connection.id}`)
    const choice = page.locator('fieldset.connect-account').filter({ hasText: '••0000' })
    await choice.getByLabel('Brings transactions into', { exact: true }).selectOption(bank.id)
    await choice.getByLabel('Start feed history', { exact: true }).selectOption('explicit')
    await choice.getByLabel('History start date', { exact: true }).fill('2025-09-01')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r5-bank002-choose-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Bring transactions in', exact: true }).click()
    await page.getByRole('heading', { name: '3 · Transactions are coming in', exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-bank002-result-${width}.png`, fullPage: true })
    await page.getByRole('link', { name: 'See transactions', exact: true }).click()
    const doubtful = page.locator('.callout').filter({ hasText: `Possible duplicate · BANK STAPLES ${width}` })
    await doubtful.getByRole('button', { name: 'Same transaction', exact: true }).waitFor()
    await page.getByText(/Reference history ·/).click()
    await page.getByText('EARLY HARDWARE', { exact: true }).waitFor()
    await page.getByText('LOCKED SOFTWARE', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-bank002-held-${width}.png`, fullPage: true })
    await doubtful.getByRole('button', { name: 'Same transaction', exact: true }).click()
    await doubtful.waitFor({ state: 'detached' })
    await page.getByRole('button', { name: 'Change history start', exact: true }).click()
    await page.getByLabel('Start feed history', { exact: true }).selectOption(width === 1440 ? 'booksStart' : 'lastReconciled')
    await page.getByRole('button', { name: 'Save history start', exact: true }).click()
    await page.getByRole('button', { name: 'Change history start', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r5-bank002-decided-${width}.png`, fullPage: true })
    const feed = await (await owner.request.get(`${app.origin}/api/pantry/bank/feeds`)).json()
    assert.equal(feed.connections[0].accounts.find(a => a.bank_account_id === bank.id).history_start, width === 1440 ? '2026-01-01' : '2026-10-09')
    const reconciled = await (await owner.request.get(`${app.origin}/api/pantry/reconciliation/${statement.statement.id}`)).json()
    assert.deepEqual(reconciled.completed, proof); assert.deepEqual(reconciled.blockers, [])
    assert.deepEqual(errors, []); await context.close()
  }
})
