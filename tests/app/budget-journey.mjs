import assert from 'node:assert/strict'

/** Public browser path shared by CI's built Worker and the owned local rer server. */
export async function budgetJourney(context, origin, width, screenshotDir = '/tmp') {
  const page = await context.newPage()
  const command = async (op, data) => { const r = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const state = await (await context.request.get(`${origin}/api/pantry/state`)).json()
  if (!state.settings?.entity) await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2025-01-01', policies: 'Service business with cash reporting.' })
  if (!state.accounts.length) await command('chart.start', {})
  const fresh = await (await context.request.get(`${origin}/api/pantry/state`)).json(), acct = Object.fromEntries(fresh.accounts.map(a => [a.code, a.id]))
  const marker = `Budget journey ${width}`
  const journal = async (date, memo, income, expense) => {
    const d = await command('journal.save-draft', { date, memo, lines: [{ accountId: acct['1000'], debit: income }, { accountId: acct['4000'], credit: income }, { accountId: acct['6200'], debit: expense }, { accountId: acct['1000'], credit: expense }] })
    return command('journal.post', { id: d.id, revision: d.revision })
  }
  // One realistic prior-year baseline per fresh installation, shared at both widths.
  if (width === 1440) {
    await journal('2025-01-17', marker + ' prior-year design and software', '1000.00', '300.00')
    await journal('2026-01-17', marker + ' current design and software', '1200.00', '450.00')
  }
  const route = `${origin}/app/reports?report=budget-actual&from=2026-01-01&to=2026-03-31`
  await page.goto(route)
  await page.getByRole('button', { name: 'New annual budget', exact: true }).click()
  await page.getByLabel('Budget name', { exact: true }).fill(`Studio annual ${width}`)
  await page.getByLabel('Annual start', { exact: true }).fill('2026-01')
  await page.getByLabel('Start from', { exact: true }).selectOption('actuals')
  await page.getByLabel('Percentage change', { exact: true }).fill('5')
  await page.screenshot({ path: `${screenshotDir}/pantry-r10-budget-copy-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await page.getByRole('button', { name: 'Edit budget', exact: true }).waitFor()
  const list = await (await context.request.get(`${origin}/api/pantry/budgets`)).json(), plan = list.budgets.find(b => b.name === `Studio annual ${width}`)
  assert.ok(plan)
  assert.equal(plan.basis, 'cash')
  await page.getByRole('button', { name: 'Edit budget', exact: true }).click()
  const saved = await (await context.request.get(`${origin}/api/pantry/budgets/${plan.id}`)).json(), expenseIndex = saved.cells.findIndex(c => c.account_id === acct['6200'])
  await page.getByLabel(`Budget line ${expenseIndex + 1} amount`, { exact: true }).fill('400.00')
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await page.getByRole('button', { name: 'Edit budget', exact: true }).waitFor()
  const r = await (await context.request.get(`${origin}/api/pantry/budgets/${plan.id}/report?from=2026-01-01&to=2026-03-31`)).json()
  assert.deepEqual(r.netIncome, { budget: 65000, actual: 75000, variance: 10000, percent: 15.38 })
  await page.getByText('$650.00', { exact: true }).waitFor()
  await page.getByRole('link', { name: 'Download budget CSV · cash', exact: true }).waitFor()
  await page.screenshot({ path: `${screenshotDir}/pantry-r10-budget-quarter-${width}.png`, fullPage: true })
  await page.getByRole('radio', { name: 'Accrual', exact: true }).click()
  await page.getByRole('link', { name: 'Download budget CSV · accrual', exact: true }).waitFor()
  await page.getByRole('radio', { name: 'Cash', exact: true }).click()
  await page.getByRole('button', { name: 'New annual budget', exact: true }).click()
  await page.getByLabel('Budget name', { exact: true }).fill(`CSV annual ${width}`)
  await page.getByLabel('Annual start', { exact: true }).fill('2026-01')
  await page.getByLabel('Start from', { exact: true }).selectOption('csv')
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'studio-plan.csv', mimeType: 'text/csv', buffer: Buffer.from('Account,Month,Amount\n4000,2026-01,2000.00\n6200,2026-01,500.00\n') })
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await page.getByRole('button', { name: 'Edit budget', exact: true }).waitFor()
  await page.getByText('$1,500.00', { exact: true }).waitFor()
  await page.getByRole('button', { name: 'New annual budget', exact: true }).click()
  await page.getByLabel('Budget name', { exact: true }).fill(`Easel annual ${width}`)
  await page.getByLabel('Annual start', { exact: true }).fill('2026-01')
  await page.getByLabel('Start from', { exact: true }).selectOption('easel')
  const easel = { scenario: { id: 'board-plan', name: 'Board plan' }, lines: [{ id: 'design', name: 'Design services', type: 'revenue' }, { id: 'software', name: 'Software', type: 'operating-expense' }], calculation: { currency: 'USD', cells: [{ line: 'design', department: 'studio', month: '2026-01', amount: 300000, basis: 'plan' }, { line: 'software', department: 'studio', month: '2026-01', amount: 50000, basis: 'plan' }] } }
  await page.getByLabel('Import file', { exact: true }).setInputFiles({ name: 'easel-board-plan.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(easel)) })
  await page.getByLabel('Account for Design services', { exact: true }).selectOption(acct['4000'])
  await page.getByLabel('Account for Software', { exact: true }).selectOption(acct['6200'])
  await page.screenshot({ path: `${screenshotDir}/pantry-r10-budget-easel-map-${width}.png`, fullPage: true })
  await page.getByRole('button', { name: 'Save budget', exact: true }).click()
  await page.getByRole('button', { name: 'Edit budget', exact: true }).waitFor()
  await page.getByText('$2,500.00', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  await page.screenshot({ path: `${screenshotDir}/pantry-r10-budget-easel-result-${width}.png`, fullPage: true })
  await page.close()
}
