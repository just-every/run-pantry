import { estimatesJourney } from './estimates-journey.mjs'
import { access001Browser } from './access001-journey.mjs'
import { effectsJourney } from './effects-journey.mjs'
import { moveInJourney } from './move-in-journey.mjs'
import { captureJourney } from './capture-journey.mjs'
import { data001Browser } from './data001-journey.mjs'
// The built app in a browser, on the emitted Worker and its own migrated D1: the owner
// signs in with the setup token, the books are made through the public API, and then a
// person clicks through what a stranger did. Run after `pnpm run build`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { books } from './books.mjs'
import { worker, TOKEN } from './worker.mjs'
import { vendorCreditJourney } from './vendor-credit-journey.mjs'

test('INVOICE-006 estimates, customer acceptance, progress invoices and advance deposits at 1440 and 390', estimatesJourney)

test('MIGRATE-007 spreadsheet mapping, preview, undo, reimport and sign-off at 1440 and 390', moveInJourney)

test('AGENT-003 locked correction effects and exact approval at 1440 and 390', effectsJourney)

test('ACCESS-001 roles, restricted screens and hours on the next invoice at 1440 and 390', access001Browser)

test('DATA-001 owner inventories data, paths, prices and unavailable brokers, rotates Stripe and removes the model at 1440 and 390', data001Browser)

test('REPORT-001 statement column modes persist, reconcile and download on cash and accrual at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const command = async (op, data) => {
    const response = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data })
    assert.equal(response.status(), 200, `${op}: ${await response.text()}`); return response.json()
  }
  await command('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 4, taxMethod: 'cash', booksStart: '2025-01-01', policies: '' })
  await command('chart.start', {})
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', routing: '', openingDate: '2025-01-01', openingBalance: '0' })
  const cedar = await command('contact.save', { kind: 'customer', name: 'Cedar Studio', termsDays: 30 })
  const maple = await command('contact.save', { kind: 'customer', name: 'Maple Workshop', termsDays: 30 })
  for (const [date, amount, contactId] of [['2025-09-10', '40.00', cedar.id], ['2026-08-10', '80.00', cedar.id], ['2026-09-10', '120.00', cedar.id], ['2026-09-15', '60.00', maple.id]]) {
    const entry = await command('journal.save-draft', { date, memo: 'Design consultation received', lines: [{ accountId: acct['1000'], debit: amount }, { accountId: acct['4000'], credit: amount, contactId }] })
    await command('journal.post', { id: entry.id, revision: entry.revision })
  }
  const expense = await command('journal.save-draft', { date: '2026-09-20', memo: 'Studio subscription', lines: [{ accountId: acct['6200'], debit: '25.00' }, { accountId: acct['1000'], credit: '25.00' }] })
  await command('journal.post', { id: expense.id, revision: expense.revision })
  const invoice = await command('invoice.save-draft', { customerId: cedar.id, issueDate: '2026-09-12', lines: [{ description: 'Brand consultation', quantity: '1', rate: '150.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  await command('invoice.approve', { id: invoice.id, revision: invoice.revision }); await command('invoice.issue', { id: invoice.id })
  await command('payment.record', { direction: 'received', contactId: cedar.id, date: '2026-09-25', amount: '90.00', bankAccountId: bank.id, allocations: [{ targetId: invoice.id, amount: '90.00' }] })
  const storageState = await owner.storageState(), money = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }), number = new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 })
  const display = (value, unit) => value === null ? '—' : unit === 'percent' ? `${number.format(value)}%` : `${value < 0 ? '−' : ''}${money.format(Math.abs(value) / 100)}`
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/reports?report=profit-and-loss&from=2026-09-01&to=2026-09-30`)
    for (const [label, slug] of [['Profit and loss', 'profit-and-loss'], ['Balance sheet', 'balance-sheet']]) {
      if (width === 1440) await page.getByRole('tab', { name: label, exact: true }).click()
      else await page.getByLabel('Report', { exact: true }).selectOption(label)
      const picker = page.getByLabel('Columns', { exact: true })
      await picker.waitFor()
      assert.equal(await picker.locator('option[value="customer"]').count(), slug === 'profit-and-loss' ? 1 : 0)
      for (const basis of ['accrual', 'cash']) {
        await page.getByRole('radio', { name: basis === 'cash' ? 'Cash' : 'Accrual', exact: true }).click()
        for (const mode of ['single', 'prior-period', 'prior-year', 'months', 'quarters', 'ytd', ...(slug === 'profit-and-loss' ? ['customer'] : [])]) {
          await picker.selectOption(mode)
          const query = `from=2026-09-01&to=2026-09-30&basis=${basis}&columns=${mode}`
          const response = await context.request.get(`${app.origin}/api/pantry/reports/${slug}?${query}`)
          assert.equal(response.status(), 200, await response.text())
          const report = await response.json()
          if (mode === 'single') {
            await page.getByRole('link', { name: slug === 'profit-and-loss' ? 'Net income' : 'Liabilities and equity', exact: true }).first().waitFor()
            await page.getByRole('link', { name: slug === 'profit-and-loss' ? 'Net income' : 'Liabilities and equity', exact: true }).first().click()
            await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
            await page.getByRole('link', { name: label, exact: true }).click()
          } else {
            const table = page.getByRole('table', { name: `${label} · ${mode} · ${basis} basis`, exact: true })
            await table.waitFor()
            for (const total of report.totals) {
              const row = table.getByRole('row').filter({ has: page.getByRole('rowheader', { name: total.name, exact: true }) })
              await row.getByRole('rowheader', { name: total.name, exact: true }).waitFor()
              assert.deepEqual(await row.locator('td.fig').allTextContents(), total.values.map((value, i) => display(value, report.columns[i].unit)), `${slug}/${basis}/${mode} ${total.name} at ${width}`)
            }
            if (mode === 'customer') for (const name of ['Cedar Studio', 'Maple Workshop', 'Unassigned', 'Total']) assert.ok(report.columns.some(c => c.label === name))
            if (mode === 'prior-year') assert.ok(report.rows.some(row => row.values.at(-1) === null), 'zero prior percentages stay undefined')
          }
          assert.equal(new URL(page.url()).searchParams.get('columns'), mode)
          for (const format of ['csv', 'pdf']) {
            const link = page.getByRole('link', { name: `Download ${format.toUpperCase()} · ${basis}`, exact: true }), href = new URL(await link.getAttribute('href'), app.origin)
            assert.equal(href.searchParams.get('columns'), mode); assert.equal(href.searchParams.get('basis'), basis)
            const download = await context.request.get(href.href)
            assert.equal(download.status(), 200, await download.text())
            assert.match(download.headers()['content-type'], new RegExp(format === 'pdf' ? 'application/pdf' : 'text/csv'))
            const contents = (await download.body()).toString(format === 'pdf' ? 'latin1' : 'utf8')
            assert.match(contents, new RegExp(`${basis === 'cash' ? 'Cash' : 'Accrual'} basis`))
            if (format === 'csv' && mode !== 'single') {
              const rows = contents.trim().split(/\r?\n/).map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(match => match[1].replaceAll('""', '"')))
              for (const total of report.totals) assert.deepEqual(rows.find(row => row[0] === total.name)?.slice(4), total.values.map((value, i) => value === null ? 'Not comparable (prior is zero)' : report.columns[i].unit === 'percent' ? `${value}%` : (value / 100).toFixed(2)), `${slug}/${basis}/${mode} CSV ${total.name}`)
            }
            if (mode === 'prior-period') {
              const [file] = await Promise.all([page.waitForEvent('download'), link.click()])
              assert.equal(await file.failure(), null)
              assert.ok(file.suggestedFilename().endsWith(`.${format}`))
            }
          }
          if (basis === 'accrual') await page.screenshot({ path: `/tmp/sx-pantry-r9-report-${width}-${slug === 'balance-sheet' ? 'balance-sheet-' : ''}${mode}.png`, fullPage: true })
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${slug}/${mode} fits ${width}`)
        }
      }
    }
    await page.reload()
    await page.getByLabel('Columns', { exact: true }).waitFor()
    assert.equal(await page.getByLabel('Columns', { exact: true }).inputValue(), 'ytd', 'columns survive reload')
    assert.deepEqual(errors, [], `no page errors at ${width}`)
    await context.close()
  }
})

test('REPORT-002 every report opens by clicking it, at 1440 and 390, and a payment made from its bank line pays its bill', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const boot = await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  assert.equal(boot.status(), 303, await boot.text())
  const setup = await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  assert.equal(setup.status(), 303)
  await books(owner.request, app.origin)
  const cmd = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const cedar = state.contacts.find(c => c.name === 'Cedar Studio'), acme = state.contacts.find(c => c.name === 'Acme Contractors'), bank = state.bankAccounts[0]
  const tax = await cmd('tax-code.save', { name: 'New York City', rate: '8.875', accountId: acct['2200'], state: 'NY' })
  let inv = await cmd('invoice.save-draft', { customerId: cedar.id, issueDate: '2026-09-12', lines: [{ description: 'Paid brand consultation', quantity: '1', rate: '250.00', accountId: acct['4000'], taxCode: tax.id }] })
  await cmd('invoice.approve', { id: inv.id, revision: inv.revision }); inv = await cmd('invoice.issue', { id: inv.id })
  await cmd('payment.record', { direction: 'received', contactId: cedar.id, date: '2026-09-15', amount: '272.19', bankAccountId: bank.id, allocations: [{ targetId: inv.id, amount: '272.19' }] })
  const bill = await cmd('bill.save', { vendorId: acme.id, reference: 'SUPPORT-SEP', billDate: '2026-09-16', lines: [{ description: 'Software support', accountId: acct['6200'], amount: '100.00' }], post: true })
  await cmd('payment.record', { direction: 'paid', contactId: acme.id, date: '2026-09-20', amount: '100.00', bankAccountId: bank.id, allocations: [{ targetId: bill.id, amount: '100.00' }] })
  const signedIn = await owner.storageState()

  const reports = ['General ledger', 'Profit and loss', 'Balance sheet', 'Receivables aging', 'Payables aging', 'Sales tax by state', 'Sales by customer', 'Expenses by vendor', 'Cash flow', '1099 contractors', 'Trial balance']
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
      if (!['1099 contractors', 'Cash flow', 'Receivables aging', 'Payables aging'].includes(report)) {
        for (const basis of ['Accrual', 'Cash']) {
          await page.getByRole('radio', { name: basis, exact: true }).click()
          await page.getByRole('heading', { name: new RegExp(`^${report} ${basis} basis`) }).waitFor()
          const pdf = page.getByRole('link', { name: `Download PDF · ${basis.toLowerCase()}` })
          const response = await context.request.get(new URL(await pdf.getAttribute('href'), app.origin).href)
          assert.equal(response.status(), 200)
          assert.match((await response.body()).toString('latin1'), new RegExp(`${basis} basis`))
        }
      }
      if (report === 'Cash flow') await page.getByText('Ties to the balance sheet cash change', { exact: true }).waitFor()
      else if (['Receivables aging', 'Payables aging'].includes(report)) await page.getByText(new RegExp(`^${report.startsWith('Receivables') ? 'Receivables' : 'Payables'} \\$.*agree to`)).waitFor()
      await page.screenshot({ path: `/tmp/sx-pantry-r6-${report.replaceAll(' ', '-')}-${width}.png`, fullPage: true })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${report} fits ${width}`)

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


test('CAPTURE-004 phone and desktop receipt suggestions wait for their line, attach and create an approved cash expense', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  let savedCookies
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: width > 500 ? 900 : 844 } })
    const page = await context.newPage(), origin = app.origin
    if (width === 1440) {
      assert.equal((await context.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
      await context.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
      await books(context.request, origin)
    } else await context.addCookies(savedCookies)
    const cmd = async (op, data) => { const r = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
    const state = await (await context.request.get(`${origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
    await page.goto(`${origin}/app/receipts`)
    const name = `Home Depot ${width}.txt`
    await page.getByLabel('Upload a file', { exact: true }).setInputFiles({ name, mimeType: 'text/plain', buffer: Buffer.from(`Home Depot receipt $64.18 ${width}`) })
    const receipt = page.locator('.receipt-card').filter({ has: page.getByRole('heading', { name }) })
    await receipt.getByLabel('Vendor', { exact: true }).fill('Home Depot')
    await receipt.getByLabel('Date', { exact: true }).fill(width === 1440 ? '2026-10-01' : '2026-11-01')
    await receipt.getByLabel('Total', { exact: true }).fill('64.18')
    await receipt.getByText('No transaction with this total yet.', { exact: false }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r7-waiting-${width}.png`, fullPage: true })
    const month = width === 1440 ? '10' : '11'
    await cmd('statement.import', { bankAccountId: state.bankAccounts[0].id, fileName: `depot-${width}.csv`, content: `Posting Date,Description,Amount\n${month}/02/2026,HOME DEPOT,-64.18\n`, opening: '8440.01', closing: '8375.83', start: `2026-${month}-01`, end: `2026-${month}-30`, confirmLast4: '4821' })
    // Keep the typed facts: refresh the candidates with a field correction.
    await receipt.getByLabel('Vendor', { exact: true }).fill('The Home Depot')
    await receipt.getByText('HOME DEPOT', { exact: true }).waitFor()
    await receipt.getByLabel('Record to account', { exact: true }).selectOption(acct['6300'])
    await page.screenshot({ path: `/tmp/sx-pantry-r7-candidate-${width}.png`, fullPage: true })
    await receipt.getByRole('button', { name: 'Accept and attach', exact: true }).click()
    await receipt.waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: 'Attached', exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r7-attached-${width}.png`, fullPage: true })
    await page.getByLabel('Upload a file', { exact: true }).setInputFiles({ name: `Stationery ${width}.txt`, mimeType: 'text/plain', buffer: Buffer.from(`Stationery cash receipt ${width}`) })
    const cash = page.locator('.receipt-card').filter({ has: page.getByRole('heading', { name: `Stationery ${width}.txt` }) })
    await cash.getByLabel('Cash receipt vendor').fill(`Local Stationery ${width}`)
    await cash.getByLabel('Cash receipt date').fill(`2026-${month}-03`)
    await cash.getByLabel('Cash receipt total').fill('18.75')
    await cash.getByLabel('Cash expense account').selectOption(acct['6300'])
    await cash.getByLabel('Cash paid from').selectOption(acct['3000'])
    await page.screenshot({ path: `/tmp/sx-pantry-r7-cash-${width}.png`, fullPage: true })
    await cash.getByRole('button', { name: 'Save cash expense draft' }).click()
    await page.getByRole('heading', { name: 'Cash expense draft saved' }).waitFor()
    await page.getByRole('link', { name: 'Review in Books' , exact: false }).click()
    await page.getByRole('tab', { name: 'Journal entries' }).click()
    await page.getByRole('row', { name: new RegExp(`Local Stationery ${width}.*cash receipt`) }).click()
    await page.getByRole('button', { name: 'Post entry', exact: true }).click()
    await page.getByText('Posted — reverse to correct', { exact: true }).waitFor()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `/tmp/sx-pantry-r7-posted-${width}.png`, fullPage: true })
    if (width === 1440) savedCookies = await context.cookies()
    await context.close()
  }
})


test('API-001 financial-report and vendor-credit credentials are explained, created, used and revoked at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(); t.after(() => owner.close())
  assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const command = async (op, data) => {
    const response = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data })
    assert.equal(response.status(), 200, op + ': ' + await response.text()); return response.json()
  }
  await command('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: '' })
  await command('chart.start', {})
  const state = await (await owner.request.get(`${app.origin}/api/pantry/state`)).json()
  const acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const journal = await command('journal.save-draft', { date: '2026-10-12', memo: 'Design fee received', lines: [{ accountId: acct['1000'], debit: '125.00' }, { accountId: acct['4000'], credit: '125.00' }] })
  await command('journal.post', { id: journal.id, revision: journal.revision })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: await owner.storageState(), viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(String(error)))
    await page.goto(`${app.origin}/app/settings`)
    const scope = page.getByRole('checkbox', { name: /Reports reports:read/ })
    await scope.waitFor()
    await page.getByText('Read financial statements, ledgers, sales, tax, open items and financial report-library summaries.', { exact: true }).waitFor()
    const name = 'Financial reporting ' + width
    await page.getByLabel('Integration name', { exact: true }).fill(name)
    await scope.check()
    const create = page.waitForResponse(response => response.url().endsWith('/api/pantry/command/integration.create') && response.request().method() === 'POST')
    await page.getByRole('button', { name: 'Create integration credential', exact: true }).click()
    const response = await create; assert.equal(response.status(), 200)
    const credential = await response.json()
    assert.deepEqual(credential.scopes, ['reports:read'])
    await page.getByRole('button', { name: 'I saved it', exact: true }).click()
    // No credential value is retained in a screenshot or in test output.
    assert.equal(await page.locator('code.token').count(), 0)
    const headers = { authorization: `Bearer ${credential.token}` }
    const report = await context.request.get(`${app.origin}/api/pantry/integration/v1/reports/profit-and-loss?from=2026-10-01&to=2026-10-31`, { headers })
    assert.equal(report.status(), 200); assert.equal((await report.json()).netIncome, 12500)
    await page.getByRole('button', { name: 'Refresh integrations', exact: true }).click()
    const calls = page.getByRole('table', { name: 'Recent integration API calls', exact: true })
    await calls.getByText('GET /api/pantry/integration/v1/reports/profit-and-loss', { exact: true }).first().waitFor()
    const row = page.getByRole('table', { name: 'Integration credentials', exact: true }).getByRole('row').filter({ hasText: name })
    await row.getByText('Active', { exact: true }).waitFor()
    await scope.scrollIntoViewIfNeeded()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, 'settings fit ' + width)
    if (process.env.PANTRY_PROOF_DIR) await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/api001-settings-${width}.png`, fullPage: true })
    await row.getByRole('button', { name: 'Revoke', exact: true }).click()
    await row.getByText('Revoked', { exact: true }).waitFor()
    assert.equal((await context.request.get(`${app.origin}/api/pantry/integration/v1/reports/profit-and-loss?to=2026-10-31`, { headers })).status(), 401)
    if (process.env.PANTRY_PROOF_DIR) await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/api001-revoked-${width}.png`, fullPage: true })
    await vendorCreditJourney({ page, context, command, acct, width, origin: app.origin })
    assert.deepEqual(errors, [])
    await context.close()
  }
})

test('CLOSE-003 custom task assignment, due dates, revision review and month locking work at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(); t.after(() => owner.close())
  const origin = app.origin
  assert.equal((await owner.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
  await owner.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const cmd = async (op, data) => {
    const r = await owner.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data })
    assert.equal(r.status(), 200, `${op}: ${await r.text()}`); return r.json()
  }
  await cmd('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Revenue when invoiced.' })
  await cmd('chart.start', {})
  const state = await (await owner.request.get(`${origin}/api/pantry/state`)).json(), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const entry = await cmd('journal.save-draft', { date: '2026-08-15', memo: 'Design consultation received', lines: [{ accountId: acct['1000'], debit: '1200.00' }, { accountId: acct['4000'], credit: '1200.00' }] })
  await cmd('journal.post', { id: entry.id, revision: entry.revision })
  const signedIn = await owner.storageState()
  const proof = process.env.PANTRY_PROOF_DIR
  if (proof) await (await import('node:fs' + '/promises')).mkdir(proof, { recursive: true })
  for (const [width, period] of [[1440, '2026-09'], [390, '2026-10']]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: 1000 } }), page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    try {
      await page.goto(`${origin}/app/close?period=${period}`)
      const tasks = page.getByRole('heading', { name: 'Review tasks', exact: true }).locator('..').locator('..')
      await tasks.getByLabel('New review task', { exact: true }).fill('Confirm insurance renewal')
      await tasks.getByLabel('Assign to', { exact: true }).selectOption('owner@example.test')
      await tasks.getByLabel('Due date', { exact: true }).fill('2026-11-05')
      await tasks.getByRole('button', { name: 'Add task', exact: true }).click()
      const first = tasks.getByRole('row').filter({ hasText: 'Confirm insurance renewal' })
      await first.getByText('Olivia Owner', { exact: true }).waitFor()
      assert.equal(await first.locator('time[datetime="2026-11-05"]').count(), 1)
      await tasks.getByLabel('New review task', { exact: true }).fill('Review tax correspondence')
      await tasks.getByLabel('Due date', { exact: true }).fill('2026-11-06')
      await tasks.getByRole('button', { name: 'Add task', exact: true }).click()
      const second = tasks.getByRole('row').filter({ hasText: 'Review tax correspondence' })
      await second.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
      const board = page.getByRole('heading', { name: 'Monthly close board', exact: true }).locator('..').locator('..')
      await board.locator('summary').click()
      const month = board.getByRole('row').filter({ has: page.getByRole('link', { name: period.endsWith('09') ? 'September 2026' : 'October 2026', exact: true }) })
      await month.getByText('0 of 2 done', { exact: true }).waitFor()
      await first.getByRole('button', { name: 'Mark done', exact: true }).click()
      await first.getByText('Done', { exact: true }).waitFor()
      await first.getByRole('button', { name: 'Edit Confirm insurance renewal', exact: true }).click()
      await first.getByLabel('Task title', { exact: true }).fill('Confirm renewed insurance')
      await first.getByLabel('Task due date', { exact: true }).fill('2026-11-07')
      await first.getByRole('button', { name: 'Save review task', exact: true }).click()
      const revised = tasks.getByRole('row').filter({ hasText: 'Confirm renewed insurance' })
      await revised.getByRole('button', { name: 'Mark done', exact: true }).waitFor()
      assert.equal(await revised.locator('time[datetime="2026-11-07"]').count(), 1)
      if (proof) await tasks.screenshot({ path: `${proof}/close-tasks-${width}.png` })
      await revised.getByRole('button', { name: 'Mark done', exact: true }).click()
      await second.getByRole('button', { name: 'Mark done', exact: true }).click()
      await month.getByText('2 of 2 done', { exact: true }).waitFor()
      const monthName = period.endsWith('09') ? 'September 2026' : 'October 2026'
      await page.getByRole('button', { name: `Lock ${monthName}`, exact: true }).click()
      await month.getByText('Locked', { exact: true }).waitFor()
      assert.equal(await tasks.getByRole('button', { name: 'Add task', exact: true }).count(), 0)
      assert.equal(await tasks.getByRole('button', { name: 'Mark done', exact: true }).count(), 0)
      if (proof) {
        await board.screenshot({ path: `${proof}/close-board-${width}.png` })
        await page.evaluate(() => window.scrollTo(0, 0))
        await page.screenshot({ path: `${proof}/after-close-${width}.png`, fullPage: true })
      }
      const other = period.endsWith('09') ? 'October 2026' : 'September 2026'
      await board.getByRole('link', { name: other, exact: true }).click()
      await page.getByRole('heading', { level: 1 }).filter({ hasText: other }).waitFor()
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
})

test('ERASURE-001 owner preview, receipt, retention confirmation and Activity at 1440 and 390', async t => {
  const {erasureJourney}=await import('./erasure-journey.mjs')
  await erasureJourney(t)
})


test('API-001 owner webhook lifecycle, data declaration and delivery history at 1440 and 390', async t => {
  const {webhookJourney}=await import('./webhook-journey.mjs'); await webhookJourney(t)
})

test('CAPTURE-001 camera split, HEIC, multi-page PDF and multi-file drop keep original evidence at 1440 and 390', captureJourney)

test('DIM-001 required bill coding and dimension statements at 1440 and 390',async t=>{
 const {dimensionsBrowser}=await import('./dimensions-journey.mjs');await dimensionsBrowser(t)
})

import {dimensionCompletionBrowser} from './dimension-completion.mjs'
test('DIM-001 dimension splits, document recoding and generated coding through the built screens at 1440 and 390',dimensionCompletionBrowser)

import {reportDeliveryBrowser} from './report-delivery.mjs'
test('REPORT-007 dedicated exports and owner-consented lender delivery on month lock at 1440 and 390',reportDeliveryBrowser)

test('Capture review, quarantine, cardholder schedule and close waiver at 1440 and 390', async t => {
  const { harness, books: captureBooks } = await import('../api/harness.mjs')
  const { mkdir } = await import('node:fs' + '/promises')
  const evidence = process.env.PANTRY_CAPTURE_EVIDENCE ?? '/tmp/sx-pantry-c41'
  await mkdir(evidence, { recursive: true })
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  let signedIn
  for (const width of [1440, 390]) {
    // The built UI uses the real HTTP API harness; only the model and mail provider edges are fake.
    const h = await harness({ outbound: async request => {
      await request.json()
      return Response.json({ content: [{ type: 'text', text: JSON.stringify({ receipt: true, vendor: 'Cedar Stationery', date: '2026-09-08', total: '110.00', tax: '10.00', currency: 'USD', category: '6300', note: '', instructionLikeText: true, fieldEvidence: { vendor: { confidence: 'low', region: { page: 1, left: .1, top: .1, width: .4, height: .2 } } }, draft: { kind: 'bill', dueDate: '2026-10-08', termsDays: 30, lines: [{ description: 'Paper', amount: '90.00', accountCode: '6300' }] } }) }], stop_reason: 'end_turn' })
    } })
    const context = await browser.newContext({ ...(signedIn ? { storageState: signedIn } : {}), viewport: { width, height: width === 390 ? 844 : 1000 } })
    try {
      const { acct } = await captureBooks(h)
      await h.command('reader.save', { provider: 'anthropic', key: 'synthetic-pantry-46' })
      const inbox = await h.command('receipt-address.create', { mailbox: 'receipts@books.example.test' })
      const headers = { origin: app.origin }
      if (!signedIn) {
      assert.equal((await context.request.post(`${app.origin}/auth/bootstrap`, { headers, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
      assert.equal((await context.request.post(`${app.origin}/setup`, { headers, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
      signedIn = await context.storageState()
      }
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(String(error)))
      await page.route('**/api/pantry/**', async route => {
        const request = route.request(), upstreamHeaders = { ...request.headers(), cookie: h.owner, origin: h.origin }
        delete upstreamHeaders.host; delete upstreamHeaders['content-length']
        const response = await fetch(h.origin + new URL(request.url()).pathname + new URL(request.url()).search, { method: request.method(), headers: upstreamHeaders, ...(request.postDataBuffer() ? { body: request.postDataBuffer() } : {}) })
        const responseHeaders = Object.fromEntries(response.headers); delete responseHeaders['content-length']; delete responseHeaders['content-encoding']
        await route.fulfill({ status: response.status, headers: responseHeaders, body: Buffer.from(await response.arrayBuffer()) })
      })
      await page.goto(`${app.origin}/app/receipts`)
      await page.getByLabel('Upload a file', { exact: true }).setInputFiles({ name: `synthetic-pantry-${width}.pdf`, mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 synthetic receipt') })
      await page.getByText('Reading confidence and page regions', { exact: true }).click()
      await page.getByText(/Instruction-like text detected/).waitFor()
      assert.ok(await page.getByText('Low confidence · confirm', { exact: true }).count() >= 11)
      await page.getByText(/Page 1; left 10%/).waitFor()
      await page.getByText(/Line items differ from the total/).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'screen fits the viewport')
      await page.screenshot({ path: `${evidence}/reading-${width}.png`, fullPage: true })
      const raw = `From: stranger@example.test\r\nTo: ${inbox.address}\r\nSubject: Synthetic ride receipt\r\nMessage-ID: <synthetic-pantry-${width}@example.test>\r\nDate: Tue, 08 Sep 2026 10:00:00 +0000\r\nAuthentication-Results: mx.example.test; spf=pass; dkim=pass; dmarc=pass\r\nContent-Type: text/html\r\n\r\n<p>Ride receipt $20.00</p>`
      assert.equal((await h.email(raw, { from: 'stranger@example.test', to: inbox.address })).status, 200)
      await page.reload()
      await page.getByRole('heading', { name: 'Quarantined email', exact: true }).waitFor()
      await page.getByText(/SPF pass, DKIM pass, DMARC pass/).waitFor()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'screen fits the viewport')
      await page.screenshot({ path: `${evidence}/quarantine-${width}.png`, fullPage: true })
      await page.getByRole('button', { name: 'Accept message', exact: true }).click()
      await page.getByRole('heading', { name: 'Quarantined email', exact: true }).waitFor({ state: 'detached' })
      await page.goto(`${app.origin}/app/settings#receipt-address`)
      await page.getByLabel('Enable receipt request emails', { exact: true }).check()
      await page.getByLabel('Repeat every (days)', { exact: true }).fill('2')
      await page.getByLabel('Card last four', { exact: true }).fill('4821')
      await page.getByLabel('Cardholder email', { exact: true }).fill('owner@example.test')
      await page.getByLabel('I authorise these receipt emails to the mapped people on this schedule.', { exact: true }).check()
      await page.getByRole('button', { name: 'Save receipt requests', exact: true }).click()
      await page.getByText('4821: owner@example.test', { exact: false }).waitFor()
      await page.getByRole('heading', { name: 'Missing receipt requests', exact: true }).scrollIntoViewIfNeeded()
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'screen fits the viewport')
      await page.screenshot({ path: `${evidence}/settings-${width}.png`, fullPage: true })
      const draft = await h.command('journal.save-draft', { date: '2026-09-01', memo: 'Synthetic missing receipt charge', lines: [{ accountId: acct['6300'], debit: '125.00' }, { accountId: acct['1000'], credit: '125.00' }] })
      await h.command('journal.post', { id: draft.id, revision: draft.revision })
      await page.goto(`${app.origin}/app/close?period=2026-09`)
      await page.getByText(/Charges over your receipt threshold block close/).waitFor()
      await page.getByRole('button', { name: 'No receipt needed', exact: true }).click()
      await page.getByLabel('Why no receipt', { exact: true }).fill('Supplier cannot reproduce this receipt')
      await page.getByRole('button', { name: 'Save reason', exact: true }).click()
      await page.getByText(/No receipt needed: Synthetic missing receipt charge/).waitFor()
      assert.equal((await h.view('close/2026-09')).checks.find(check => check.key === 'receipts').ok, true)
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'screen fits the viewport')
      await page.screenshot({ path: `${evidence}/close-${width}.png`, fullPage: true })
      assert.deepEqual(errors, [])
    } finally { await context.close(); await h.close() }
  }
})
