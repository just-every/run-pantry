// The built app in a browser, on the emitted Worker and its own migrated D1: the owner
// signs in with the setup token, the books are made through the public API, and then a
// person clicks through what a stranger did. Run after `pnpm run build`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { books } from './books.mjs'
import { worker, TOKEN } from './worker.mjs'

test('every report opens by clicking it, at 1440 and 390, and a payment made from its bank line pays its bill', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const boot = await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  assert.equal(boot.status(), 303, await boot.text())
  const setup = await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  assert.equal(setup.status(), 303)
  await books(owner.request, app.origin)
  const signedIn = await owner.storageState()

  const reports = ['General ledger', 'Profit and loss', 'Balance sheet', 'Receivables aging', 'Payables aging', 'Sales tax by state', '1099 contractors', 'Trial balance']
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width > 500 ? 900 : 844 } })
    const page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/reports?from=2026-09-01&to=2026-09-30`)
    await page.getByRole('heading', { name: 'Trial balance' }).waitFor()
    for (const report of reports) {
      if (width > 500) await page.getByRole('tab', { name: report }).click()
      else await page.getByLabel('Report', { exact: true }).selectOption(report)
      await page.getByRole('heading', { name: new RegExp(`^${report}`) }).waitFor()
      assert.equal(await page.getByText('Something went wrong').count(), 0, `${report} at ${width}`)
    }
    assert.deepEqual(errors, [], `no page errors at ${width}`)
    await context.close()
  }

  // The stranger's way: the bank line, a vendor payment to Acme, approve. It pays A-778 without a second step.
  const page = await owner.newPage()
  await page.goto(`${app.origin}/app/bank`)
  await page.getByRole('row', { name: /ACH DEBIT ACME CONTRACTORS/ }).getByRole('button', { name: 'File it' }).click()
  await page.getByRole('button', { name: '+ Vendor payment' }).click()
  await page.getByLabel('Vendor', { exact: true }).selectOption({ label: 'Acme Contractors' })
  await assert.doesNotReject(page.getByLabel(/A-778/).and(page.locator('[value="1500.00"]')).waitFor(), 'the bill it names is filled in')
  await page.getByRole('button', { name: 'Approve match' }).click()
  await page.getByText('Filed', { exact: true }).first().waitFor()
  const sales = await (await owner.request.get(`${app.origin}/api/pantry/sales`)).json()
  assert.equal(sales.bills.find(b => b.reference === 'A-778').open_cents, 0)
  const pl = await (await owner.request.get(`${app.origin}/api/pantry/reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash`)).json()
  assert.equal(pl.expenses.find(e => e.code === '6000').amount, 150000, 'the cash basis counts the contractor cost in September')

  // Put Pantry online never offers the placeholder owner address: it asks for the owner's own email, then fills the deploy lines with it.
  await page.goto(`${app.origin}/app/settings`)
  const online = page.locator('#put-online')
  await online.getByText('Set up hosting').click()
  await online.getByLabel('Your own email').waitFor()
  assert.equal(await online.locator('pre').count(), 0, 'no deploy lines with the placeholder owner')
  await online.getByLabel('Your own email').fill('books@run-pantry.com')
  await online.getByText('OWNER_EMAIL=books@run-pantry.com').waitFor()
})

test('BILL-002 owner reviews coding, original documents and vendor history, approves from phone and reapproves changed lines', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  const boot = await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  assert.equal(boot.status(), 303)
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => {
    const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data })
    assert.equal(r.status(), 200, await r.text()); return r.json()
  }
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue when invoiced.' })
  await command('chart.start', {})
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), expense = state.accounts.find(a => a.code === '6200').id
  const vendor = await command('contact.save', { kind: 'vendor', name: 'Brightline Software', termsDays: 30 })
  await command('capture-approval-rule.save', { minimum: '2500.00' })
  const savedState = await owner.storageState()
  for (const width of [1440, 390]) {
    const bill = await command('bill.save', { vendorId: vendor.id, reference: `BL-${width}`, billDate: width === 1440 ? '2026-09-15' : '2026-09-16', className: 'Studio', lines: [{ description: 'Annual design software', accountId: expense, amount: '3100.00' }] })
    await command('document.upload', { name: `Brightline-${width}.pdf`, mediaType: 'application/pdf', base64: Buffer.from(`%PDF-1.4 Brightline Software annual invoice BL-${width} $3100`).toString('base64'), linkedKind: 'bill', linkedId: bill.id })
    const anonymous = await browser.newContext()
    const signIn = await anonymous.request.get(`${app.origin}/app/sales/bill/${bill.id}`, { maxRedirects: 0 })
    assert.equal(signIn.status(), 303)
    assert.equal(new URL(signIn.headers().location, app.origin).searchParams.get('returnTo'), `/app/sales/bill/${bill.id}`)
    await anonymous.close()
    const context = await browser.newContext({ storageState: savedState, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/sales/bill/${bill.id}`)
    await page.getByRole('heading', { name: `Brightline Software BL-${width}`, exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Brightline Software · vendor history' }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r4-bill-before-${width}.png`, fullPage: true })
    assert.ok(await page.getByRole('link', { name: `Brightline-${width}.pdf`, exact: true }).count() > 0, `source document visible at ${width}: ${JSON.stringify((await (await owner.request.get(`${app.origin}/api/pantry/sales`)).json()).bills.find(b => b.id === bill.id)?.documents)}`)
    await page.getByRole('button', { name: 'Approve bill revision', exact: true }).click()
    await page.getByText('This revision was approved by owner@example.test.').waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r4-bill-approved-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Edit bill', exact: true }).click()
    await page.getByLabel('Line 1 description', { exact: true }).fill('Annual design software, corrected')
    await page.getByRole('button', { name: 'Save bill revision', exact: true }).click()
    await page.getByText('Owner approval required before posting this revision.').waitFor()
    assert.equal(await page.getByRole('button', { name: 'Record bill', exact: true }).count(), 0)
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `no page overflow at ${width}`)
    await page.screenshot({ path: `/tmp/sx-pantry-r4-bill-edit-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'Approve bill revision', exact: true }).click()
    await page.getByRole('button', { name: 'Record bill', exact: true }).click()
    await page.getByText('This revision was approved by owner@example.test.').waitFor({ state: 'detached' })
    const sales = await (await owner.request.get(`${app.origin}/api/pantry/sales`)).json()
    assert.equal(sales.bills.find(b => b.id === bill.id).status, 'posted')
    const upload = await owner.request.post(`${app.origin}/api/pantry/receipts/capture`, { headers: { origin: app.origin }, multipart: { file: { name: `Brightline-capture-${width}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from(`%PDF-1.4 Quarterly Brightline invoice CAP-${width} $3100`) }, source: 'upload' } })
    assert.equal(upload.status(), 200, await upload.text()); const captured = await upload.json()
    const receipts = async () => (await (await owner.request.get(`${app.origin}/api/pantry/receipts`)).json()).review
    let r = (await receipts()).find(r => r.id === captured.id)
    await command('receipt.vendor-confirm', { id: r.id, revision: r.revision, vendorId: vendor.id, vendorRevision: vendor.revision, confirm: true })
    r = (await receipts()).find(r => r.id === captured.id)
    await command('receipt.draft-save', { id: r.id, revision: r.revision, kind: 'bill', date: width === 1440 ? '2026-09-20' : '2026-09-21', total: '3100.00', tax: '0', invoiceNumber: `CAP-${width}`, termsDays: 30, lines: [{ description: 'Quarterly team subscription', accountId: expense, amount: '3100.00' }] })
    await page.goto(`${app.origin}/app/receipts#receipt-${r.id}`)
    const document = page.locator(`[id="receipt-${r.id}"]`)
    await document.getByRole('heading', { name: 'Brightline Software · vendor history' }).waitFor()
    await document.getByRole('button', { name: 'Approve draft', exact: true }).click()
    await document.getByRole('button', { name: 'Post approved draft', exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r4-capture-approved-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [], `no browser errors at ${width}`)
    await context.close()
  }
})
