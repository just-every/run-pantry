import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

test('CLOSE-005 adjusting drafts, posted report, year-end review and locked end state work at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const cmd = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  await cmd('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2025-01-01' })
  await cmd('chart.start', {})
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const liability = await cmd('account.save', { code: '2500', name: 'Accrued expenses', type: 'liability' })
  await cmd('journal.save-draft', { date: '2025-12-31', memo: 'Year-end revenue adjustment', lines: [{ accountId: acct['1500'], debit: '1000.00' }, { accountId: acct['4000'], credit: '1000.00' }] })
  await cmd('journal.save-draft', { date: '2025-12-31', memo: 'Year-end software accrual', lines: [{ accountId: acct['6200'], debit: '200.00' }, { accountId: liability.id, credit: '200.00' }] })
  const signedIn = await owner.storageState()
  for (const [width, memo] of [[1440, 'Year-end revenue adjustment'], [390, 'Year-end software accrual']]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage()
    await page.goto(`${app.origin}/app/books`)
    await page.getByRole('tab', { name: 'Journal entries', exact: true }).click()
    await page.getByRole('row').filter({ hasText: memo }).click()
    await page.getByRole('button', { name: 'Edit', exact: true }).click()
    await page.getByLabel('Adjusting entry (fiscal year end)').check()
    await page.screenshot({ path: `/tmp/sx-pantry-r6-yearend-editor-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Save draft', exact: true }).click()
    await page.getByRole('button', { name: 'Post entry', exact: true }).click()
    await page.getByText('Posted — reverse to correct', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r6-yearend-posted-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await context.close()
  }
  const year = await (await owner.request.get(`${app.origin}/api/pantry/year-end/2025`)).json()
  for (const period of year.periods) {
    const close = await cmd('close.tasks', { period })
    for (const task of close.tasks) await cmd('close.task', { id: task.id, revision: task.revision, done: true })
  }
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/close?period=2025-12`)
    await page.getByText('Review and lock a fiscal year', { exact: true }).click()
    const card = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Fiscal year-end', exact: true }) })
    await card.getByText('Year-end revenue adjustment', { exact: false }).waitFor()
    await card.getByText('Year-end software accrual', { exact: false }).waitFor()
    assert.match(await card.innerText(), /Current earnings \$800.00/)
    assert.match(await card.innerText(), /Prior earnings \$800.00/)
    await card.getByLabel('Adjusting report basis').selectOption('cash')
    await card.getByRole('heading', { name: 'Adjusting entries Cash basis', exact: true }).waitFor()
    const pdf = await owner.request.get(`${app.origin}${await card.getByRole('link', { name: 'Download adjusting entries PDF' }).getAttribute('href')}`)
    assert.equal(pdf.status(), 200); assert.match((await pdf.body()).toString('latin1'), /Year-end software accrual/); assert.match((await pdf.body()).toString('latin1'), /Cash basis/)
    await card.screenshot({ path: `/tmp/sx-pantry-r6-yearend-${width}.png` })
    if (width === 1440) {
      await card.getByRole('button', { name: 'Lock fiscal year 2025', exact: true }).click()
      await card.getByText('Fiscal year 2025 locked.', { exact: true }).waitFor()
    } else await card.getByText('Fiscal year 2025 locked.', { exact: true }).waitFor()
    await card.screenshot({ path: `/tmp/sx-pantry-r6-yearend-locked-${width}.png` })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, []); await context.close()
  }
})
