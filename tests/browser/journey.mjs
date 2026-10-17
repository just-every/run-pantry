// What people do in Pantry's screens: set up the business and its people, move
// in from QuickBooks Online, import statements, invoice, reconcile with an
// agent's help, close September and download the accountant package.
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { readDevKey, signInAs } from '../../src/modules/operator-auth/dev/sign-in-as.mjs'

/** Browser errors from every page; the run fails if any appear. */
export const errors = []
const FIX = name => join(process.cwd(), 'fixtures', name)
const QBO = { 'Account List': 'account-list.csv', 'Customer Contact List': 'customer-contact-list.csv', 'Vendor Contact List': 'vendor-contact-list.csv', 'Trial Balance': 'trial-balance.csv', 'Open Invoices': 'open-invoices.csv', 'Unpaid Bills': 'unpaid-bills.csv', 'General Ledger': 'general-ledger.csv' }

export async function session(browser, root, origin, as, width) {
  const key = await readDevKey(root), login = await signInAs({ origin, key, as, returnTo: '/app' })
  const context = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 1000 }, deviceScaleFactor: 1 })
  await context.addCookies(login.cookies.map(c => ({ ...c, url: origin })))
  const page = await context.newPage()
  page.on('pageerror', e => errors.push(`${as} at ${width}: ${e.message}`))
  // A refused request (4xx) is an expected answer the screen shows; anything else is a fault.
  page.on('console', m => { if (m.type() === 'error' && !/^Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`${as} at ${width} console: ${m.text()}`) })
  await page.goto(origin + '/app')
  if (page.url().endsWith('/setup')) {
    await page.getByRole('checkbox').check(); await page.getByRole('button', { name: 'Finish setup' }).click()
    await page.waitForURL(/\/app$/)
  }
  return { context, page, as }
}

/** The same call the screens make, for steps whose screen another step already proves. */
export async function api(s, origin, op, body) {
  const r = await s.context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data: body })
  const value = await r.json()
  assert.equal(r.status(), 200, `${op}: ${JSON.stringify(value)}`)
  return value
}
export const view = async (s, origin, path) => { const r = await s.context.request.get(`${origin}/api/pantry/${path}`); assert.equal(r.status(), 200, path); return r.json() }

const go = async (s, origin, path, heading) => { await s.page.goto(origin + path); await s.page.getByRole('heading', { level: 1, name: heading }).waitFor() }
const button = (page, name) => page.getByRole('button', { name, exact: true })
// Phones show what the person sees (the bottom bar stays at the bottom); desktops show the whole page.
const shot = (s, dir, name) => s.page.screenshot({ path: join(dir, `${s.page.viewportSize().width}-${name}.png`), fullPage: s.page.viewportSize().width > 600 })
/** Wait for the outcome, or fail at once with the refusal the screen shows. */
async function outcome(page, success) {
  const alert = page.getByRole('alert').first()
  const which = await Promise.race([success.waitFor().then(() => 'ok'), alert.waitFor().then(() => 'alert')])
  if (which === 'alert') throw new Error(`Screen refused: ${await alert.textContent()}`)
}
async function settle(page) { await page.waitForLoadState('networkidle'); await page.waitForTimeout(150) }

export async function desktop(browser, root, origin, dir) {
  const owner = await session(browser, root, origin, 'owner', 1440)
  // 1. The business and its people, through People & settings.
  await go(owner, origin, '/app/settings', 'People & settings')
  const p = owner.page
  await p.getByLabel('Legal name').fill('Juniper Lane Design LLC')
  await p.getByLabel('Entity type').selectOption('single-member-llc')
  await p.getByLabel('State of organization').selectOption('NY')
  await p.getByLabel('Books start').fill('2026-09-01')
  await p.getByLabel(/Tax accounting method/).selectOption('cash')
  await p.getByLabel('Book and report policies').fill('Accrual books in USD. Revenue recognized when invoiced. Capitalize equipment over $2,500. Accountant: Morgan Lee CPA.')
  await button(p, 'Set up the business').click(); await settle(p)
  for (const [name, email, role, grants] of [['Taylor Kim', 'bookkeeper@dev.localhost', 'bookkeeper', []], ['Morgan Lee', 'accountant@dev.localhost', 'accountant', ['Post and approve entries', 'Approve reopening']]]) {
    await p.getByLabel('Name', { exact: true }).fill(name); await p.getByLabel('Email', { exact: true }).fill(email); await p.getByLabel('Role').selectOption(role)
    for (const g of grants) await p.getByLabel(g).check()
    await button(p, 'Add person').click(); await p.getByRole('cell', { name: email }).waitFor()
  }
  await shot(owner, dir, 'settings')
  const books = await session(browser, root, origin, 'bookkeeper', 1440), acct = await session(browser, root, origin, 'accountant', 1440)

  // 2. Move in from QuickBooks Online: dry run, import, accountant sign-off.
  await go(books, origin, '/app/move-in', 'Move in from QuickBooks Online')
  for (const [label, file] of Object.entries(QBO)) await books.page.getByLabel(label, { exact: true }).setInputFiles(FIX(`quickbooks-online/${file}`))
  await books.page.getByLabel('QuickBooks account name').fill('Operating Checking'); await books.page.getByLabel('Bank').fill('Chase')
  await books.page.getByLabel('Last four digits').fill('4821'); await books.page.getByLabel('Reconciled statement balance').fill('24813.52')
  await button(books.page, 'Preview (dry run)').click()
  await books.page.getByText('All match').waitFor()
  await shot(books, dir, 'move-in')
  await button(books.page, 'Import as staged records').click()
  await books.page.getByText('Waiting for sign-off').waitFor()
  await go(acct, origin, '/app/move-in', 'Move in from QuickBooks Online')
  await button(acct.page, 'Accountant sign-off').click(); await acct.page.getByText('Signed off').first().waitFor()

  // 3. Bank accounts and statements.
  await go(books, origin, '/app/bank', 'Bank')
  const bp = books.page
  await bp.getByLabel('Name', { exact: true }).fill('Savings'); await bp.getByLabel('Bank', { exact: true }).fill('Chase')
  await bp.getByLabel('Ledger account').selectOption({ label: '1010 · Savings' }); await bp.getByLabel('Last four digits', { exact: true }).fill('7730')
  await bp.getByLabel('Routing number (optional)').fill('021000021'); await bp.getByLabel('Opening statement date').fill('2026-08-31'); await bp.getByLabel('Opening statement balance').fill('0.00')
  await button(bp, 'Add bank account').click(); await bp.getByRole('cell', { name: /Savings/ }).first().waitFor()
  const state = await view(books, origin, 'state')
  const checking = state.bankAccounts.find(b => b.name === 'Operating Checking'), savings = state.bankAccounts.find(b => b.name === 'Savings')
  for (const [bank, file, extra] of [[checking, 'bank/operating-checking-2026-09.csv', { 'Opening balance on the statement': '24813.52', 'Closing balance on the statement': '27797.02', 'Statement start': '2026-09-01', 'Statement end': '2026-09-30', 'Last four digits (CSV only)': '4821' }], [savings, 'bank/savings-2026-09.ofx', {}]]) {
    await bp.getByLabel('Bank account', { exact: true }).selectOption(bank.id); await bp.getByLabel('Statement file').setInputFiles(FIX(file))
    for (const field of ['Opening balance on the statement', 'Closing balance on the statement', 'Statement start', 'Statement end', 'Last four digits (CSV only)']) await bp.getByLabel(field).fill(extra[field] ?? '')
    await button(bp, 'Import statement').click(); await bp.getByText(/Imported \d+ line/).waitFor()
  }
  await shot(books, dir, 'bank')

  // 4. Sales tax, and an invoice that needs a tax decision before approval.
  await go(acct, origin, '/app/books', 'Books')
  await acct.page.getByRole('tab', { name: 'Sales tax' }).click()
  await acct.page.getByLabel('Name', { exact: true }).fill('New York City'); await acct.page.getByLabel('Rate (%)').fill('8.875'); await acct.page.getByLabel('Liability account').selectOption({ label: '2200 · Sales Tax Payable' })
  await button(acct.page, 'Add tax code').click(); await acct.page.getByRole('cell', { name: '8.875%' }).waitFor()
  await go(books, origin, '/app/sales', 'Sales & bills')
  await button(books.page, 'Create invoice').click()
  const ip = books.page
  await ip.getByLabel('Customer').selectOption({ label: 'Willow Services' }); await ip.getByLabel('Issue date').fill('2026-09-02')
  await ip.getByLabel('Line 1 description').fill('Brand workshop'); await ip.getByLabel('Line 1 quantity').fill('8'); await ip.getByLabel('Line 1 rate').fill('175.00'); await ip.getByLabel('Line 1 sales tax code').selectOption('exempt')
  await button(ip, 'Add line').click()
  await ip.getByLabel('Line 2 description').fill('Printed style guides'); await ip.getByLabel('Line 2 quantity').fill('2'); await ip.getByLabel('Line 2 rate').fill('200.00')
  await ip.getByText('Tax treatment needed before approval').waitFor()
  await shot(books, dir, 'invoice')
  await ip.getByLabel('Line 2 sales tax code').selectOption({ label: 'New York City (8.875%)' })
  await button(ip, 'Save draft').click(); await ip.getByRole('cell', { name: 'Willow Services' }).waitFor()
  await go(acct, origin, '/app/sales', 'Sales & bills')
  await acct.page.getByRole('cell', { name: 'Willow Services' }).click(); await button(acct.page, 'Approve').click(); await acct.page.getByText('Approved', { exact: true }).last().waitFor()
  await books.page.reload(); await books.page.getByRole('cell', { name: 'Willow Services' }).click(); await button(books.page, 'Issue').click()
  await books.page.getByText(/\$1,835\.50 open/).waitFor()
  // A second invoice and the payments recorded before the statement arrived (the same commands the screens send).
  const ids = await view(books, origin, 'sales'), cust = Object.fromEntries(state.contacts.map(c => [c.name, c.id])), accounts = Object.fromEntries(state.accounts.map(a => [a.code, a.id]))
  const cedar2 = await api(books, origin, 'invoice.save-draft', { customerId: cust['Cedar Studio'], issueDate: '2026-09-02', lines: [{ description: 'Social templates', quantity: '1', rate: '1200.00', accountId: accounts['4000'], taxCode: 'exempt' }] })
  await api(acct, origin, 'invoice.approve', { id: cedar2.id, revision: cedar2.revision }); await api(books, origin, 'invoice.issue', { id: cedar2.id })
  const willow = ids.invoices.find(i => i.customer_name === 'Willow Services'), open1041 = ids.invoices.find(i => i.number === '1041')
  const bill = ref => ids.bills.find(b => b.reference === ref)
  await api(books, origin, 'payment.record', { direction: 'received', contactId: cust['Cedar Studio'], date: '2026-09-03', amount: '2400.00', bankAccountId: checking.id, allocations: [{ targetId: open1041.id, amount: '2400.00' }] })
  await api(books, origin, 'payment.record', { direction: 'received', contactId: cust['Willow Services'], date: '2026-09-18', amount: '1835.50', bankAccountId: checking.id, allocations: [{ targetId: willow.id, amount: '1835.50' }] })
  await api(books, origin, 'payment.record', { direction: 'received', contactId: cust['Cedar Studio'], date: '2026-09-18', amount: '1200.00', bankAccountId: checking.id, allocations: [{ targetId: cedar2.id, amount: '1200.00' }] })
  await api(books, origin, 'payment.record', { direction: 'paid', contactId: cust['Harbor Office Rentals'], date: '2026-09-24', amount: '1300.00', bankAccountId: checking.id, allocations: [{ targetId: bill('R-0826').id, amount: '1300.00' }] })
  await go(books, origin, '/app/sales', 'Sales & bills'); await shot(books, dir, 'sales')

  // 5. Reconcile checking: by hand, with a new fee, and with the agent's proposal.
  await go(owner, origin, '/app/settings', 'People & settings')
  await owner.page.getByLabel('Agent name').fill('juniper-books'); await button(owner.page, 'Create agent token').click()
  const token = (await owner.page.locator('code.token').textContent()).trim()
  const agent = (...args) => promisify(execFile)(process.execPath, ['scripts/pantry-agent.mjs', ...args], { env: { ...process.env, PANTRY_URL: origin, PANTRY_AGENT_TOKEN: token } }).then(r => JSON.parse(r.stdout))
  const ctx = await agent('context', '--period', '2026-09')
  const line = text => ctx.unmatchedStatementLines.find(l => l.description.includes(text))
  const cheque = ctx.unmatchedBankPostings.find(x => x.credit_cents === 130000)
  const proposal = await agent('propose-match', '--summary', 'Check 2052 clears the Harbor Office Rentals payment of 24 September', '--bank-line', line('CHECK 2052').id, '--posting', cheque.id)
  assert.equal(proposal.status, 'proposed')
  await go(books, origin, '/app/bank', 'Bank')
  await books.page.getByRole('row', { name: /Operating Checking/ }).filter({ hasText: 'To reconcile' }).getByRole('button', { name: 'Reconcile' }).click()
  const rp = books.page
  await rp.getByRole('heading', { level: 1, name: /Reconcile Operating Checking/ }).waitFor()
  const review = rp.locator('.match-panel', { hasText: 'Match review' })
  await rp.getByLabel(/Select DEPOSIT CEDAR STUDIO/).check(); await rp.getByLabel(/Select Payment from Cedar Studio \$2,400\.00/).check()
  await review.getByRole('button', { name: 'Approve match' }).click(); await outcome(rp, rp.getByRole('row', { name: /DEPOSIT CEDAR STUDIO/ }).getByText('Matched', { exact: true }))
  await rp.getByLabel(/Select MONTHLY SERVICE FEE/).check(); await button(rp, '+ Fee').click()
  await rp.getByLabel('Account', { exact: true }).selectOption({ label: '6400 · Bank Fees' })
  await review.getByRole('button', { name: 'Approve match' }).click(); await outcome(rp, rp.getByRole('row', { name: /MONTHLY SERVICE FEE/ }).getByText('Matched', { exact: true }))
  await rp.getByText('Match proposed by juniper-books').waitFor()
  await shot(books, dir, 'reconcile')
  await rp.locator('.match-panel', { hasText: 'proposed by juniper-books' }).getByRole('button', { name: 'Approve match' }).click()
  await rp.getByRole('row', { name: /CHECK 2052/ }).getByText('Matched', { exact: true }).waitFor()
  const r = await view(books, origin, `reconciliation/${(await view(books, origin, 'bank')).statements.find(x => x.bank_account_id === checking.id).id}`)
  const id = text => r.lines.find(l => l.description.includes(text)).id, post = test => r.postings.filter(test).map(x => x.id)
  await api(books, origin, 'match.approve', { bankLineIds: [id('BRIGHTLINE')], create: [{ type: 'payment', amount: '640.00', contactId: cust['Brightline Software'], allocations: [{ targetId: bill('INV-88').id, amount: '640.00' }] }] })
  await api(books, origin, 'match.approve', { bankLineIds: [id('NORTHSTAR')], create: [{ type: 'receipt', amount: '1500.00', contactId: cust['Northstar Consulting'], allocations: [{ targetId: ids.invoices.find(i => i.number === '1039').id, amount: '1500.00' }] }] })
  await api(books, origin, 'match.approve', { bankLineIds: [id('TRANSFER')], create: [{ type: 'transfer', amount: '2000.00', otherBankAccountId: savings.id, direction: 'out' }] })
  await api(books, origin, 'match.approve', { bankLineIds: [id('SQUARE')], journalLineIds: post(x => x.entry_date === '2026-09-18') })
  await rp.reload(); await button(rp, 'Finish reconciliation').click(); await rp.getByText('Reconciled', { exact: true }).waitFor()
  await shot(books, dir, 'reconciled')
  const sv = await view(books, origin, `reconciliation/${(await view(books, origin, 'bank')).statements.find(x => x.bank_account_id === savings.id).id}`)
  await api(books, origin, 'match.approve', { bankLineIds: [sv.lines.find(l => l.description.includes('TRANSFER')).id], journalLineIds: [sv.postings[0].id] })
  await api(books, origin, 'match.approve', { bankLineIds: [sv.lines.find(l => l.description.includes('INTEREST')).id], create: [{ type: 'income', amount: '1.25', accountId: accounts['4900'], direction: 'in', memo: 'Interest' }] })
  await api(books, origin, 'reconciliation.complete', { statementId: sv.statement.id })

  // 6. A journal entry prepared by the bookkeeper, posted by the accountant, then reversed.
  await go(books, origin, '/app/books', 'Books'); await books.page.getByRole('tab', { name: 'Journal entries' }).click()
  await button(books.page, 'New journal entry').click()
  const jp = books.page
  await jp.getByLabel('Entry date').fill('2026-09-29'); await jp.getByLabel('Description').fill('Reclassify studio chair to equipment')
  await jp.getByLabel('Line 1 account').selectOption({ label: '1500 · Equipment' }); await jp.getByLabel('Line 1 debit').fill('420.00')
  await jp.getByLabel('Line 2 account').selectOption({ label: '6300 · Office Supplies' }); await jp.getByLabel('Line 2 credit').fill('420.00')
  await jp.getByText('Debits $420.00 = Credits $420.00').waitFor(); await button(jp, 'Save draft').click(); await jp.getByText('Waiting for someone with the posting grant').waitFor()
  await go(acct, origin, '/app/books', 'Books'); await acct.page.getByRole('tab', { name: 'Journal entries' }).click()
  await acct.page.getByRole('cell', { name: 'Reclassify studio chair to equipment' }).click(); await button(acct.page, 'Post entry').click()
  await acct.page.getByText('Posted — reverse to correct').waitFor()
  await shot(acct, dir, 'books')
  await button(acct.page, 'Reverse').click(); await acct.page.getByLabel('Reversal date').fill('2026-09-30'); await acct.page.getByLabel('Reason').fill('Chair is under the capitalization threshold')
  await button(acct.page, 'Post reversal').click(); await acct.page.getByText('Posted and reversed').waitFor()

  // 7. Evidence, review tasks and the lock.
  await go(books, origin, '/app/sales', 'Sales & bills'); await books.page.getByRole('tab', { name: 'Bills' }).click()
  await books.page.getByRole('cell', { name: 'INV-88' }).click(); await books.page.getByLabel('Document').setInputFiles({ name: 'brightline-inv-88.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4\n% Brightline Software invoice INV-88, $640.00\n') })
  await button(books.page, 'Attach source document').click(); await books.page.getByRole('link', { name: 'brightline-inv-88.pdf' }).waitFor()
  const harbor = (await view(acct, origin, 'sales')).bills.find(b => b.reference === 'R-0826')
  await api(acct, origin, 'bill.waive-evidence', { id: harbor.id, revision: harbor.revision, reason: 'Rent is billed under the signed lease; the landlord issues no monthly invoice' })
  await go(books, origin, '/app/close?period=2026-09', /Close — September 2026/)
  await button(books.page, 'Add the standard review tasks').click()
  for (let i = 0; i < 3; i++) { await books.page.getByRole('button', { name: 'Mark done' }).first().click(); await settle(books.page) }
  await go(owner, origin, '/app/close?period=2026-09', /Close — September 2026/)
  await owner.page.getByText('Ready to lock').waitFor()
  const ownerName = (await view(owner, origin, 'state')).actor.name
  await button(owner.page, 'Lock September 2026').click(); await owner.page.getByText(`Locked by ${ownerName} on`).waitFor()
  await shot(owner, dir, 'close')

  // 8. Reports and the accountant package.
  await go(acct, origin, '/app/reports', 'Reports')
  await acct.page.getByLabel('As of').fill('2026-09-30'); await acct.page.getByRole('row', { name: /Total/ }).waitFor()
  await shot(acct, dir, 'reports')
  const pkg = await (await acct.context.request.get(`${origin}/api/pantry/package/2026-09`)).json()
  assert.ok(pkg.trialBalance.balanced && pkg.balanceSheet.balanced && pkg.receivables.agrees && pkg.payables.agrees)
  assert.equal(pkg.close.status, 'locked'); assert.equal(pkg.reconciliations.length, 2)
  await go(owner, origin, '/app/agents', 'Agent work'); await shot(owner, dir, 'agents')
  await go(owner, origin, '/app', 'Juniper Lane Design LLC'); await shot(owner, dir, 'overview')
  for (const s of [owner, books, acct]) await s.context.close()
  return { package: { trialBalance: pkg.trialBalance.debit, reconciliations: pkg.reconciliations.map(x => [x.bank, x.closing_cents]) }, proposal: proposal.id }
}

/** Every main screen at phone width, and real work done there. */
export async function phone(browser, root, origin, dir) {
  const books = await session(browser, root, origin, 'bookkeeper', 390)
  await books.page.getByRole('navigation', { name: 'Work' }).waitFor()
  for (const [path, heading, name] of [['/app', 'Juniper Lane Design LLC', 'overview'], ['/app/sales', 'Sales & bills', 'sales'], ['/app/bank', 'Bank', 'bank'], ['/app/books', 'Books', 'books'], ['/app/close?period=2026-09', /Close — September 2026/, 'close'], ['/app/reports', 'Reports', 'reports'], ['/app/move-in', 'Move in from QuickBooks Online', 'move-in'], ['/app/agents', 'Agent work', 'agents']]) {
    await go(books, origin, path, heading); await settle(books.page); await shot(books, dir, name)
  }
  // The bottom bar carries all six: Reports directly, the rest through More.
  await go(books, origin, '/app', 'Juniper Lane Design LLC')
  const bar = books.page.getByRole('navigation', { name: 'Work' })
  await bar.getByRole('link', { name: 'Reports' }).click(); await books.page.getByRole('heading', { level: 1, name: 'Reports' }).waitFor()
  await bar.getByRole('button', { name: 'More' }).click(); await books.page.getByRole('menuitem', { name: 'Agent work' }).click()
  await books.page.getByRole('heading', { level: 1, name: 'Agent work' }).waitFor()
  // October is open: a customer and an invoice drafted on the phone.
  await go(books, origin, '/app/sales', 'Sales & bills'); await books.page.getByRole('tab', { name: 'Customers & vendors' }).click()
  await books.page.getByLabel('Kind').selectOption('customer'); await books.page.getByLabel('Name', { exact: true }).fill('Harbor Lights Cafe'); await button(books.page, 'Add').click()
  await books.page.getByRole('cell', { name: 'Harbor Lights Cafe' }).waitFor()
  await books.page.getByRole('tab', { name: 'Invoices' }).click(); await button(books.page, 'Create invoice').click()
  await books.page.getByLabel('Customer').selectOption({ label: 'Harbor Lights Cafe' }); await books.page.getByLabel('Issue date').fill('2026-10-05')
  await books.page.getByLabel('Line 1 description').fill('Menu redesign'); await books.page.getByLabel('Line 1 rate').fill('950.00'); await books.page.getByLabel('Line 1 sales tax code').selectOption('exempt')
  await shot(books, dir, 'invoice')
  await button(books.page, 'Save draft').click(); await books.page.getByRole('cell', { name: 'Harbor Lights Cafe' }).waitFor()
  // A locked September refuses the same person's late entry, in the screen.
  await go(books, origin, '/app/books', 'Books'); await books.page.getByRole('tab', { name: 'Journal entries' }).click(); await button(books.page, 'New journal entry').click()
  await books.page.getByLabel('Entry date').fill('2026-09-30'); await books.page.getByLabel('Description').fill('Late accrual')
  await books.page.getByLabel('Line 1 account').selectOption({ label: '6500 · Professional Fees' }); await books.page.getByLabel('Line 1 debit').fill('90.00')
  await books.page.getByLabel('Line 2 account').selectOption({ label: '2100 · Business Card' }); await books.page.getByLabel('Line 2 credit').fill('90.00')
  await button(books.page, 'Save draft').click(); await books.page.getByRole('alert').filter({ hasText: /locked/ }).waitFor()
  await books.context.close()
}

export async function snapshot(context, origin) {
  const get = async path => (await (await context.request.get(`${origin}/api/pantry/${path}`)).json())
  return {
    trialBalance: await get('reports/trial-balance?to=2026-09-30'),
    generalLedger: await get('reports/general-ledger?from=2026-09-01&to=2026-09-30'),
    receivables: await get('reports/receivables?to=2026-09-30'),
    bank: await get('bank'),
    close: (({ status, checks, tasks, approvals, period }) => ({ status, checks, tasks, approvals, period }))(await get('close/2026-09')),
    journal: await get('journal'),
    proposals: await get('proposals'),
    moveIn: await get('move-in'),
    documents: await get('documents'),
  }
}

export const readText = path => readFile(path, 'utf8')
