import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

test('PAY-004 payment-reference deposits clear, amount-only deposits confirm, and undo reopens the invoice at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => {
    const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data })
    assert.equal(r.status(), 200, await r.text()); return r.json()
  }
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue when invoiced.' })
  await command('chart.start', {})
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0' })
  const signedIn = await owner.storageState()
  for (const width of [1440, 390]) {
    const customer = await command('contact.save', { kind: 'customer', name: `Cedar Studio ${width}`, bankReference: `CEDAR DESIGN ${width}`, termsDays: 30 })
    const issue = async rate => {
      const draft = await command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-01', dueDate: '2026-10-31', lines: [{ description: 'Brand design services', quantity: '1', rate, accountId: acct['4000'], taxCode: 'exempt' }] })
      await command('invoice.approve', { id: draft.id, revision: draft.revision })
      return command('invoice.issue', { id: draft.id })
    }
    const automatic = await issue('1200.00'), wire = await issue(width === 1440 ? '500.00' : '501.00')
    await command('statement.import', { bankAccountId: bank.id, fileName: `october-${width}.csv`, content: `Posting Date,Description,Amount\n10/05/2026,ZELLE CEDAR DESIGN ${width},1200.00\n10/06/2026,WIRE ${width},${width === 1440 ? '500.00' : '501.00'}\n`, opening: '0', closing: width === 1440 ? '1700.00' : '1701.00', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/bank`)
    const refRow = page.getByRole('row', { name: new RegExp(`ZELLE CEDAR DESIGN ${width}`) })
    await refRow.getByText('Matched automatically', { exact: true }).waitFor()
    const wireRow = page.getByRole('row', { name: new RegExp(`WIRE ${width}`) })
    await wireRow.getByRole('button', { name: 'Confirm payment', exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-pay004-before-${width}.png`, fullPage: true })
    await wireRow.getByRole('button', { name: 'Confirm payment', exact: true }).click()
    await wireRow.getByText('Filed', { exact: true }).waitFor()
    await page.goto(`${app.origin}/app/sales`)
    for (const invoice of [automatic, wire]) await page.getByRole('row', { name: new RegExp(invoice.number) }).getByText('Paid', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-pay004-paid-${width}.png`, fullPage: true })
    await page.goto(`${app.origin}/app/bank`)
    await page.getByRole('row', { name: new RegExp(`ZELLE CEDAR DESIGN ${width}`) }).getByRole('button', { name: 'Undo', exact: true }).click()
    await page.getByRole('row', { name: new RegExp(`ZELLE CEDAR DESIGN ${width}`) }).getByRole('button', { name: 'Confirm payment', exact: true }).waitFor()
    await page.goto(`${app.origin}/app/sales`)
    await page.getByRole('row', { name: new RegExp(automatic.number) }).getByText('Issued', { exact: true }).waitFor()
    await page.getByRole('row', { name: new RegExp(wire.number) }).getByText('Paid', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r5-pay004-undone-${width}.png`, fullPage: true })
    await page.goto(`${app.origin}/app/sales?tab=contacts`)
    await page.getByRole('row', { name: new RegExp(`Cedar Studio ${width}`) }).click()
    await page.getByRole('button', { name: 'Edit contact details', exact: true }).click()
    await page.getByLabel('How their payments read on your bank statement (customers)', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r5-pay004-reference-${width}.png`, fullPage: true })
    assert.deepEqual(errors, [])
    await context.close()
  }
})
