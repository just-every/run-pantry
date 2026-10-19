import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

test('CLOSE-001 create and approve recurring journals, inspect dated daily, fortnightly and monthly postings and edit back to approval at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue when invoiced.' })
  await command('chart.start', {})
  const expense = await command('account.save', { code: '6910', name: 'Owner-loan interest', type: 'expense' }), loan = await command('account.save', { code: '2510', name: 'Owner loan', type: 'liability' })
  const state = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: state, viewport: { width, height: width === 390 ? 844 : 1000 } }), page = await context.newPage()
    for (const schedule of [
      { cadence: 'month', every: '1', dates: ['2026-07-01', '2026-08-01', '2026-09-01'] },
      { cadence: 'day', every: '1', dates: ['2026-07-01', '2026-07-02', '2026-07-03'] },
      { cadence: 'week', every: '2', dates: ['2026-07-01', '2026-07-15', '2026-07-29'] },
    ]) {
      const name = `Owner-loan interest ${schedule.cadence} ${width}`
      const proof = schedule.cadence === 'month' ? `${width}` : `${schedule.cadence}-${width}`
      await page.goto(`${app.origin}/app/close?period=2026-09`)
      await page.getByRole('button', { name: 'New recurring journal', exact: true }).click()
      await page.getByLabel('Template name', { exact: true }).fill(name)
      await page.getByLabel('Entry description', { exact: true }).fill('Accrue owner-loan interest')
      await page.getByLabel('Cadence', { exact: true }).selectOption(schedule.cadence)
      await page.getByLabel('Every', { exact: true }).fill(schedule.every)
      await page.getByLabel('First entry date', { exact: true }).fill(schedule.dates[0])
      await page.getByLabel('Last entry date (optional)', { exact: true }).fill(schedule.dates.at(-1))
      await page.getByLabel('Each occurrence', { exact: true }).selectOption('post')
      await page.getByLabel('Line 1 account', { exact: true }).selectOption(expense.id)
      await page.getByLabel('Line 1 debit', { exact: true }).fill('500.00')
      await page.getByLabel('Line 2 account', { exact: true }).selectOption(loan.id)
      await page.getByLabel('Line 2 credit', { exact: true }).fill('500.00')
      await page.screenshot({ path: `/tmp/sx-pantry-r4-recurring-editor-${proof}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Save journal template', exact: true }).click()
      await page.getByRole('button', { name, exact: true }).first().click()
      await page.getByRole('button', { name: 'Approve this template revision', exact: true }).waitFor()
      await page.screenshot({ path: `/tmp/sx-pantry-r4-recurring-approval-${proof}.png`, fullPage: true })
      const approved = page.waitForResponse(r => r.url().endsWith('/command/recurring-journal.approve') && r.request().method() === 'POST')
      await page.getByRole('button', { name: 'Approve this template revision', exact: true }).click()
      assert.equal((await approved).status(), 200)
      const cron = await owner.request.get(`${app.origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/30 * * * *')}`)
      assert.equal(cron.status(), 200, await cron.text())
      await page.reload(); await page.getByRole('button', { name, exact: true }).first().click()
      const templates = await (await owner.request.get(`${app.origin}/api/pantry/recurring-journals`)).json(), current = templates.templates.find(t => t.name === name)
      assert.deepEqual(current.runs_list.map(r => r.occurrence).sort(), schedule.dates)
      assert.ok(current.runs_list.every(r => r.status === 'posted' && r.journal_id))
      assert.equal(current.cadence, schedule.cadence)
      assert.equal(current.every, Number(schedule.every))
      await page.getByRole('heading', { name, exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: `/tmp/sx-pantry-r4-recurring-posted-${proof}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Edit template', exact: true }).click()
      assert.equal(await page.getByLabel('Cadence', { exact: true }).isDisabled(), true)
      assert.equal(await page.getByLabel('Every', { exact: true }).getAttribute('readonly'), '')
      if (schedule.cadence !== 'month') {
        await page.getByRole('button', { name: 'Cancel', exact: true }).click()
        continue
      }
      await page.getByLabel('Last entry date (optional)', { exact: true }).fill('2026-10-01')
      await page.getByLabel('Line 1 debit', { exact: true }).fill('600.00')
      await page.getByLabel('Line 2 credit', { exact: true }).fill('600.00')
      await page.getByRole('button', { name: 'Save journal template', exact: true }).click()
      await page.getByRole('button', { name: 'Approve this template revision', exact: true }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      await page.screenshot({ path: `/tmp/sx-pantry-r4-recurring-edited-${width}.png`, fullPage: true })
    }
    await context.close()
  }
  const tasks = await command('close.tasks', { period: '2026-01' })
  for (const task of tasks.tasks) await command('close.task', { id: task.id, revision: task.revision, done: true })
  await command('period.lock', { period: '2026-01' })
  const values = { name: 'Locked January interest', memo: 'Accrue owner-loan interest', startDate: '2026-01-01', endDate: '2026-01-01', every: 1, mode: 'post', lines: [{ accountId: expense.id, debit: '500.00' }, { accountId: loan.id, credit: '500.00' }] }
  const locked = await command('recurring-journal.save', values)
  await command('recurring-journal.approve', { id: locked.id, revision: locked.revision })
  let inactive = await command('account.save', { code: '6920', name: 'Closed adjustment category', type: 'expense' })
  const failed = await command('recurring-journal.save', { ...values, name: 'Inactive coding adjustment', startDate: '2026-06-01', endDate: '2026-06-01', mode: 'draft', lines: [{ accountId: inactive.id, debit: '25.00' }, { accountId: loan.id, credit: '25.00' }] })
  await command('recurring-journal.status', { id: failed.id, revision: failed.revision, status: 'paused' })
  await command('account.save', { ...inactive, active: false })
  await command('recurring-journal.status', { id: failed.id, revision: failed.revision, status: 'active' })
  assert.equal((await owner.request.get(`${app.origin}/cdn-cgi/local/scheduled?cron=${encodeURIComponent('*/30 * * * *')}`)).status(), 200)
  const exceptions = (await (await owner.request.get(`${app.origin}/api/pantry/recurring-journals`)).json()).exceptions
  assert.equal(exceptions.find(r => r.recurring_id === locked.id).status, 'blocked')
  assert.equal(exceptions.find(r => r.recurring_id === failed.id).status, 'failed')
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: state, viewport: { width, height: width === 390 ? 844 : 1000 } }), page = await context.newPage()
    await page.goto(`${app.origin}/app/close?period=2026-01`)
    await page.getByRole('heading', { name: 'Missed and failed journal runs', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Locked January interest', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Locked January interest', exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r4-recurring-exceptions-${width}.png`, fullPage: true })
    await context.close()
  }
})
