import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

/** AGENT-003's own screens. The parent calls this inside its browser journey
 * and inspects the four screenshots before landing. */
export async function effectsJourney(t) {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(); t.after(() => owner.close())
  const { origin } = app, evidence = process.env.PANTRY_EVIDENCE_DIR || '/tmp/pantry-effects'
  await mkdir(evidence, { recursive: true })
  assert.equal((await owner.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
  await owner.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => { const r = await owner.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, `${op}: ${await r.text()}`); return r.json() }
  const view = async path => { const r = await owner.request.get(`${origin}/api/pantry/${path}`); assert.equal(r.status(), 200, await r.text()); return r.json() }
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-01-01' })
  await command('chart.start', {})
  const acct = Object.fromEntries((await view('state')).accounts.map(a => [a.code, a.id]))
  const office = await command('account.save', { code: '6301', name: 'Office', type: 'expense' })
  const document = await command('document.upload', { name: 'synthetic-pantry-1.txt', mediaType: 'text/plain', base64: Buffer.from('Equipment $3,000, originally booked to Office in September.').toString('base64') })
  let original = await command('journal.save-draft', { date: '2026-09-15', memo: 'synthetic-pantry-2', documentId: document.id, lines: [{ accountId: office.id, debit: '3000.00' }, { accountId: acct['3000'], credit: '3000.00' }] })
  original = await command('journal.post', { id: original.id, revision: original.revision })
  const tasks = await command('close.tasks', { period: '2026-09' })
  for (const task of tasks.tasks) await command('close.task', { id: task.id, revision: task.revision, done: true })
  await command('period.lock', { period: '2026-09' })
  await view('package/2026-09?basis=accrual')
  const agent = await command('agent.create', { name: 'synthetic-pantry-3' })
  const filed = await owner.request.post(`${origin}/api/pantry/agent/proposals`, { headers: { origin, authorization: `Bearer ${agent.token}` }, data: { kind: 'journal', summary: 'Reclassify $3,000 from Office to Equipment', payload: { date: '2026-09-15', memo: 'Equipment correction', correctsEntryId: original.id, documentId: document.id, passages: ['Equipment $3,000, originally booked to Office'], lines: [{ accountId: acct['1500'], debit: '3000.00' }, { accountId: office.id, credit: '3000.00' }] } } })
  assert.equal(filed.status(), 200, await filed.text()); const p = await filed.json()
  const signedIn = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } }); t.after(() => context.close())
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/app/agents`)
    const effects = page.getByRole('region', { name: 'Effects before approval' })
    await expect(effects).toBeVisible()
    await expect(effects).toContainText('September 2026 is locked')
    await expect(effects).toContainText('Net income before −$3,000.00 → after $0.00')
    await expect(effects).toContainText('Equipment')
    await expect(effects.getByRole('button', { name: 'Request reopening of September 2026' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Approve and post', exact: true })).toBeDisabled()
    const issuance = (await command('proposal.preview', { id: p.id, revision: p.revision })).effects.issued
    assert.ok(issuance.length > 0)
    await expect(effects).toContainText(issuance[0].name)
    await page.screenshot({ path: `${evidence}/effects-september-${width}.png`, fullPage: true })
    await page.getByLabel('Correction date', { exact: true }).fill('2026-10-01')
    await expect(effects).toContainText('Net income before $0.00 → after $3,000.00')
    await expect(effects).toContainText('No locked period changes')
    await expect(effects).toContainText('No issued report or package changes')
    for (const title of ['Trial balance', 'Profit and loss', 'Balance sheet', 'Cash flow (indirect, accrual)', 'Sales tax liability', '2026 1099 totals', 'Next opening balances · 2026-11-01']) await expect(effects.locator('summary').filter({ hasText: title })).toBeVisible()
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/effects-october-${width}.png`, fullPage: true })
    if (width === 390) {
      await page.getByRole('button', { name: 'Approve and post', exact: true }).click()
      await expect(page.getByText('Approved', { exact: true })).toBeVisible()
      const decided = (await view('proposals')).proposals.find(row => row.id === p.id)
      const result = (await view('journal')).entries.find(row => row.id === decided.result_id)
      assert.equal(result.entry_date, '2026-10-01'); assert.equal(result.source_id, original.id)
      assert.equal((await view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=accrual')).netIncome, 300000)
      assert.equal((await view('close/2026-09')).status, 'locked')
    }
    assert.deepEqual(errors, [])
  }
  // The other two approval screens use real, distinct statement lines. Each
  // viewport approves its own answer and its own proposed bank-income match.
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'Synthetic bank', accountId: acct['1000'], numberLast4: '1234', openingDate: '2026-10-01', openingBalance: '0.00' })
  const settings = (await view('questions')).agent.settings
  await command('books-agent.save', { ...settings, fileDays: 0, depositDays: 0 })
  for (const [index, width] of [1440, 390].entries()) {
    const start = index === 0 ? '2026-10-01' : '2026-10-08', end = index === 0 ? '2026-10-07' : '2026-10-14'
    const depositDay = index === 0 ? '2026-10-04' : '2026-10-11', feeDay = index === 0 ? '2026-10-05' : '2026-10-12'
    const approvalDay = index === 0 ? '2026-10-07' : '2026-10-14'
    const opening = (113 * index).toFixed(2), closing = (113 * (index + 1)).toFixed(2)
    const imported = await command('statement.import', { bankAccountId: bank.id, fileName: `synthetic-pantry-${width}.csv`, content: `Date,Description,Amount\n${depositDay},synthetic-pantry-match-${width},125.00\n${feeDay},synthetic-pantry-question-${width},-12.00\n`, opening, closing, start, end, confirmLast4: '1234' })
    await command('books-agent.run', {})
    const lines = (await view('bank/lines')).lines
    const fee = lines.find(row => row.description === `synthetic-pantry-question-${width}`), deposit = lines.find(row => row.description === `synthetic-pantry-match-${width}`)
    assert.ok(fee && deposit)
    const q = (await view('questions')).open.find(row => row.subject_id === fee.id)
    assert.ok(q)
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } }); t.after(() => context.close())
    const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message))
    await page.goto(`${origin}/app/questions?q=${q.id}`)
    await page.getByLabel('Something else: file it to', { exact: true }).selectOption(office.id)
    let effects = page.getByRole('region', { name: 'Effects before approval' })
    await expect(effects).toBeVisible()
    await page.getByLabel('Correction date', { exact: true }).fill(approvalDay)
    await expect(effects).toContainText(`correction dated ${approvalDay}`)
    const questionPreview = (await command('question.preview', { id: q.id, accountId: office.id, date: approvalDay })).effects
    assert.equal(questionPreview.netIncome.after - questionPreview.netIncome.before, -1200)
    await expect(effects).toContainText('Office')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/effects-question-${width}.png`, fullPage: true })
    await page.getByRole('button', { name: 'File it', exact: true }).click()
    await expect(page.getByText('Filed', { exact: true }).first()).toBeVisible()
    const feeEntry = (await view('journal')).entries.find(row => row.memo === fee.description)
    assert.equal(feeEntry.entry_date, approvalDay)
    assert.equal((await view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=accrual')).netIncome, questionPreview.netIncome.after)
    const matchFiled = await owner.request.post(`${origin}/api/pantry/agent/proposals`, { headers: { origin, authorization: `Bearer ${agent.token}` }, data: { kind: 'match', summary: `Record statement income ${width}`, payload: { bankLineIds: [deposit.id], create: [{ type: 'income', accountId: acct['4000'], amount: '125.00', memo: deposit.description }] } } })
    assert.equal(matchFiled.status(), 200, await matchFiled.text()); const match = await matchFiled.json()
    await page.goto(`${origin}/app/bank?statement=${imported.statement.id}`)
    const panel = page.locator('section.match-panel').filter({ hasText: match.summary })
    effects = panel.getByRole('region', { name: 'Effects before approval' })
    await expect(effects).toBeVisible()
    await panel.getByLabel('Correction date', { exact: true }).fill(approvalDay)
    await expect(effects).toContainText(`correction dated ${approvalDay}`)
    const matchPreview = (await command('proposal.preview', { id: match.id, revision: match.revision, date: approvalDay })).effects
    assert.equal(matchPreview.netIncome.after - matchPreview.netIncome.before, 12500)
    await expect(effects).toContainText('Service revenue')
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    await page.screenshot({ path: `${evidence}/effects-match-${width}.png`, fullPage: true })
    await panel.getByRole('button', { name: 'Approve match', exact: true }).click()
    await expect(panel).toHaveCount(0)
    const decided = (await view('proposals')).proposals.find(row => row.id === match.id)
    const depositEntry = (await view('journal')).entries.find(row => row.memo === deposit.description)
    assert.equal(decided.status, 'approved'); assert.equal(depositEntry.entry_date, approvalDay)
    assert.equal((await view('bank/lines')).lines.find(row => row.id === deposit.id).match_id, decided.result_id)
    assert.equal((await view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=accrual')).netIncome, matchPreview.netIncome.after)
    assert.deepEqual(errors, [])
  }
}
