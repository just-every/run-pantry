import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

async function icons(page) {
  for (const control of await page.locator('button:visible,a:visible').all()) {
    if ((await control.innerText()).trim()) continue
    const label = await control.getAttribute('aria-label')
    assert.ok(label, 'An icon control needs an accessible label')
    await control.focus()
    await page.getByRole('tooltip', { name: label, exact: true }).waitFor()
  }
}

/** A first statement with first-day spending must still let its owner close. */
export async function closeOpeningJourney() {
  const proof = process.env.PANTRY_PROOF_DIR
  if (proof) await mkdir(proof, { recursive: true })
  for (const width of [1440, 390]) {
    const app = await worker()
    let browser
    try {
      browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
      const context = await browser.newContext({ viewport: { width, height: 1000 } }), page = await context.newPage(), errors = []
      page.on('pageerror', e => errors.push(String(e)))
      const origin = app.origin
      assert.equal((await context.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Dana Whitfield' }, maxRedirects: 0 })).status(), 303)
      await context.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
      const command = async (op, data) => {
        const response = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data })
        assert.equal(response.status(), 200, `${op}: ${await response.text()}`); return response.json()
      }
      const view = async path => (await context.request.get(`${origin}/api/pantry/${path}`)).json()
      const capture = async name => {
        await icons(page)
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name)
        if (proof) await page.screenshot({ path: `${proof}/${name}-${width}.png`, fullPage: true })
      }
      await command('entity.save', { legalName: 'Brightline Plumbing & Heating LLC', entityType: 'single-member-llc', state: 'OR', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-09-01', policies: 'Opening balances agree to the prior statement.' })
      await command('chart.start', {})
      const acct = Object.fromEntries((await view('state')).accounts.map(a => [a.code, a.id]))
      await page.goto(`${origin}/app`)
      const openingLink = page.getByRole('link', { name: 'Open journal entries', exact: true })
      await openingLink.waitFor()
      await capture('setup-opening')
      await openingLink.click()
      await page.getByRole('button', { name: 'New journal entry', exact: true }).click()
      await page.getByLabel('Entry date', { exact: true }).fill('2026-08-31')
      await page.getByRole('status').filter({ hasText: 'before books start' }).waitFor()
      await page.getByLabel('Description', { exact: true }).fill('Opening balances')
      await page.getByLabel('Line 1 account', { exact: true }).selectOption(acct['1000'])
      await page.getByLabel('Line 1 debit', { exact: true }).fill('18250')
      await page.getByLabel('Line 2 account', { exact: true }).selectOption(acct['3000'])
      await page.getByLabel('Line 2 credit', { exact: true }).fill('18250')
      await capture('books-opening-draft')
      await page.getByRole('button', { name: 'Save draft', exact: true }).click()
      await page.getByRole('button', { name: 'Post entry', exact: true }).click()
      await page.getByText('Posted — reverse to correct', { exact: true }).waitFor()
      await capture('books-opening-posted')
      const journal = async (date, memo, lines) => {
        const draft = await command('journal.save-draft', { date, memo, lines })
        return command('journal.post', { id: draft.id, revision: draft.revision })
      }
      await journal('2026-09-01', 'September rent', [{ accountId: acct['6100'], debit: '1400' }, { accountId: acct['1000'], credit: '1400' }])
      await journal('2026-09-12', 'Customer deposit', [{ accountId: acct['1000'], debit: '4690' }, { accountId: acct['4000'], credit: '4690' }])
      const bank = await command('bank-account.save', { name: 'Brightline Operating', institution: 'Cascade Community Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-09-01', openingBalance: '18250' })
      const imported = await command('statement.import', { bankAccountId: bank.id, fileName: 'brightline-september.csv', content: 'Posting Date,Description,Amount\n09/01/2026,September rent,-1400.00\n09/12/2026,Customer deposit,4690.00\n', opening: '18250', closing: '21540', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
      const reconciliation = await view(`reconciliation/${imported.statement.id}`)
      for (const line of reconciliation.lines) await command('match.approve', { bankLineIds: [line.id], journalLineIds: [reconciliation.postings.find(p => Number(p.amount) === line.amount_cents).id] })
      await page.goto(`${origin}/app/bank?statement=${imported.statement.id}`)
      const finish = page.getByRole('button', { name: 'Finish reconciliation', exact: true })
      await finish.waitFor(); assert.equal(await finish.isDisabled(), true)
      await page.getByRole('button', { name: 'Correct opening balance', exact: true }).click()
      await page.getByLabel('Opening balance as of', { exact: true }).fill('2026-08-31')
      await page.getByLabel('Reason for correction', { exact: true }).fill('The opening balance is before September 1 rent')
      await capture('bank-opening-correction')
      await page.getByRole('button', { name: 'Correct opening balance', exact: true }).click()
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Finish reconciliation' && !b.disabled))
      await finish.click()
      await page.getByText('Reconciled', { exact: true }).first().waitFor()
      await capture('bank-reconciled')
      assert.equal((await view(`reconciliation/${imported.statement.id}`)).completed.closing_cents, 2154000)
      await page.goto(`${origin}/app/bank?tab=statements`)
      await page.getByRole('heading', { name: 'Bank and card accounts', exact: true }).waitFor()
      await capture('bank-statements')
      await page.goto(`${origin}/app/bank`)
      const deposit = page.getByRole('row').filter({ hasText: 'Customer deposit' })
      await deposit.getByRole('button', { name: 'Ask a person', exact: true }).click()
      await deposit.getByLabel('Mention a person', { exact: true }).selectOption('@owner@example.test')
      await deposit.getByLabel('Your question', { exact: true }).fill('Which customer paid this deposit?')
      await capture('bank-deposit-question')
      await deposit.getByRole('button', { name: 'Send question', exact: true }).click()
      await deposit.getByText('Question saved with this record.', { exact: true }).waitFor()
      const question = (await view('questions')).open.find(q => q.subject_kind === 'bank-line')
      assert.equal(question.assignee, 'owner@example.test')
      await page.goto(`${origin}/app/questions?q=${question.id}`)
      await page.getByLabel('Your answer', { exact: true }).fill('Cedar Studio paid its September invoice.')
      await capture('owner-question')
      await page.getByRole('button', { name: 'Save answer', exact: true }).click()
      await page.getByText('Answered: “Cedar Studio paid its September invoice.”', { exact: true }).waitFor()
      const record = await view(`questions/record?kind=bank-line&id=${question.subject_id}`)
      assert.equal(record.questions[0].answer, 'Cedar Studio paid its September invoice.')
      await command('continuous-check.run', {})
      await page.goto(`${origin}/app/close?period=2026-09`)
      const checks = page.getByRole('heading', { name: 'Continuous checks', exact: true }).locator('..').locator('..')
      await checks.locator('time').first().waitFor()
      assert.ok(!(await checks.innerText()).includes('[object Object]'))
      assert.equal((await view('close-board?year=2026')).months.find(m => m.id === '2026-09').waiting, 0)
      const tasks = page.getByRole('heading', { name: 'Review tasks', exact: true }).locator('..').locator('..')
      for (const [title, due] of [['Confirm opening balances', '2026-10-05'], ['Review the first statement', '2026-10-06']]) {
        await tasks.getByLabel('New review task', { exact: true }).fill(title)
        await tasks.getByLabel('Assign to', { exact: true }).selectOption('owner@example.test')
        await tasks.getByLabel('Due date', { exact: true }).fill(due)
        await tasks.getByRole('button', { name: 'Add task', exact: true }).click()
        await tasks.getByRole('row').filter({ hasText: title }).getByRole('button', { name: 'Mark done', exact: true }).waitFor()
      }
      await capture('close-ready')
      for (const title of ['Confirm opening balances', 'Review the first statement']) {
        const task = tasks.getByRole('row').filter({ hasText: title })
        await task.getByRole('button', { name: 'Mark done', exact: true }).click()
        await task.getByText('Done', { exact: true }).waitFor()
      }
      const lock = page.getByRole('button', { name: 'Lock September 2026', exact: true })
      await page.waitForFunction(() => [...document.querySelectorAll('button')].some(b => b.textContent === 'Lock September 2026' && !b.disabled))
      await lock.click()
      const board = page.getByRole('heading', { name: 'Monthly close board', exact: true }).locator('..').locator('..')
      await board.locator('summary').click()
      const september = board.getByRole('row').filter({ has: page.getByRole('link', { name: 'September 2026', exact: true }) })
      await september.getByText('Locked', { exact: true }).waitFor()
      assert.equal(await september.getByText('2 of 2 done', { exact: true }).count(), 1)
      assert.equal((await view('close/2026-09')).status, 'locked')
      await capture('close-locked')
      await page.goto(`${origin}/app/activity`)
      await page.getByRole('heading', { name: 'Approvals', exact: true }).waitFor()
      const visible = await page.locator('body').innerText()
      assert.ok(!/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i.test(visible))
      assert.ok(!visible.includes('journal.post'))
      assert.ok(!visible.includes('Dana Whitfieldperson'))
      await capture('activity-readable')
      assert.deepEqual(errors, [])
      await context.close()
    } finally { await browser?.close(); await app.close() }
  }
}
