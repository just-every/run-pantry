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
  const connection = await command('feed.connect', { publicToken: 'synthetic-pantry-3', institution: { name: 'First Platypus Bank' } })
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

test('BANK-005 typed and Plaid PDF reconciliation preserve matched feed lines and show dated balance blockers at 1440 and 390', async t => {
  const { statementProvider } = await import('../api/statement-provider.mjs')
  const { mkdir } = await import('node:fs/promises')
  const evidence = process.env.PANTRY_EVIDENCE_DIR || '/tmp/sx-pantry-r16'
  await mkdir(evidence, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  for (const width of [1440, 390]) {
    const provider = await statementProvider(), app = await providerWorker({ bindings: provider.bindings, outbound: provider.outbound })
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } })
    try {
      await context.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
      await context.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
      const command = async (op, data) => { const r = await context.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
      const view = async path => (await context.request.get(`${app.origin}/api/pantry/${path}`)).json()
      await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01' })
      await command('chart.start', {})
      const acct = Object.fromEntries((await view('state')).accounts.map(a => [a.code, a.id]))
      const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'First Platypus Bank', accountId: acct['1000'], numberLast4: '0000', openingDate: '2026-09-30', openingBalance: '0' })
      const connected = await command('feed.connect', { publicToken: 'synthetic-browser-statements-token' }), feed = connected.accounts.find(a => a.mask === '0000')
      await command('feed.map', { itemId: connected.id, accounts: [{ id: feed.id, bankAccountId: bank.id }] })
      for (const l of (await view('bank/lines')).lines) await command('match.approve', { bankLineIds: [l.id], create: [{ type: l.amount_cents > 0 ? 'income' : 'fee', amount: (Math.abs(l.amount_cents) / 100).toFixed(2), accountId: acct[l.amount_cents > 0 ? '4000' : '6200'] }] })
      const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
      const shot = async state => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: `${evidence}/bank005-${state}-${width}.png`, fullPage: true }) }
      await page.goto(`${app.origin}/app/bank`)
      await page.getByText(/bank shows \$120.00/).waitFor(); await shot('feed-context')
      await page.goto(`${app.origin}/app/bank?tab=statements`)
      const card = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Reconcile existing feed lines', exact: true }) })
      await card.getByLabel('Connected account', { exact: true }).selectOption(feed.id)
      const fill = async (start, end, opening, closing) => {
        await card.getByLabel('Statement start', { exact: true }).fill(start)
        await card.getByLabel('Statement end', { exact: true }).fill(end)
        await card.getByLabel('Printed opening balance', { exact: true }).fill(opening)
        await card.getByLabel('Printed closing balance', { exact: true }).fill(closing)
      }
      await fill('2026-10-01', '2026-10-31', '0', '80'); await shot('typed-form')
      await card.getByRole('button', { name: 'Start reconciliation', exact: true }).click()
      await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
      await page.getByRole('button', { name: 'Finish reconciliation', exact: true }).waitFor()
      await page.getByText(/Context only; does not replace/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Finish reconciliation', exact: true }).isEnabled(), true)
      await page.getByRole('button', { name: 'Finish reconciliation', exact: true }).click()
      await page.getByText('Reconciled', { exact: true }).waitFor(); await shot('typed-complete')
      await page.getByRole('button', { name: '← Bank', exact: true }).click()
      await card.getByLabel('Connected account', { exact: true }).selectOption(feed.id)
      await fill('2026-11-01', '2026-11-30', '80', '100')
      // Plaid Link is the provider's browser edge, while the app's command and return flow are real.
      await page.route('https://cdn.plaid.com/link/v2/stable/link-initialize.js', route => route.fulfill({ contentType: 'application/javascript', body: 'window.Plaid = { create(o) { return { open() { o.onSuccess("synthetic-update-success", {}); }, destroy() {} }; } };' }))
      await card.getByRole('button', { name: 'Enable statement PDFs through Plaid', exact: true }).click()
      await card.getByLabel('Statement evidence', { exact: true }).selectOption('statement-november')
      await fill('2026-11-01', '2026-11-30', '80', '100'); await shot('pdf-form')
      await card.getByRole('button', { name: 'Start reconciliation', exact: true }).click()
      await page.getByRole('button', { name: 'Reconcile', exact: true }).click()
      await page.getByText(/Bank balance \$120.00 as of/).waitFor()
      assert.equal(await page.getByRole('button', { name: 'Finish reconciliation', exact: true }).isDisabled(), true)
      const evidenceCard = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Statement evidence', exact: true }) })
      await evidenceCard.locator('summary').click()
      assert.ok((await evidenceCard.locator('dd').innerText()).match(/^[a-f0-9]{64}$/))
      await shot('pdf-blocked')
      const link = page.getByRole('link', { name: 'Open statement evidence', exact: true })
      const pdf = await context.request.get(new URL(await link.getAttribute('href'), app.origin).href)
      assert.equal(pdf.status(), 200); assert.deepEqual(await pdf.body(), provider.pdf)
      provider.state.balance = 100; await command('feed.sync', { itemId: connected.id }); await page.reload()
      await page.getByRole('button', { name: 'Finish reconciliation', exact: true }).click()
      await page.getByText('Reconciled', { exact: true }).waitFor(); await shot('pdf-complete')
      const final = await view('bank'); assert.equal(final.statements.length, 2); assert.ok(final.statements.every(s => s.reconciliation_id))
      assert.deepEqual(errors, [])
    } finally { await context.close(); await app.close() }
  }
})
