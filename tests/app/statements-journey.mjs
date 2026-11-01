import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { fold, openFold } from './folds.mjs'

export async function statementsBrowser({ page, context, customer, width, origin, history }) {
  const panel = await openFold(fold(page, 'Statements'))
  await panel.getByLabel('Statement type', { exact: true }).selectOption('open-items')
  await panel.getByLabel('Statement date', { exact: true }).fill('2026-10-20')
  await panel.getByLabel('Statement starts', { exact: true }).fill('2026-01-01')
  const response = page.waitForResponse(r => r.url().endsWith('/command/statement.send'))
  await panel.getByRole('button', { name: 'Email statement', exact: true }).click()
  const sent = await response
  assert.equal(sent.status(), 200, await sent.text())
  const statement = await sent.json()
  assert.equal(statement.closing_balance_cents, history.summary.open_balance_cents)
  assert.deepEqual(statement.deliveries.map(d => d.recipient).sort(), [`jordan-${width}@example.test`, `maya-${width}@example.test`])
  assert.ok(statement.deliveries.every(d => d.status === 'suppressed'))
  const row = panel.getByRole('row').filter({ has: page.getByRole('link', { name: 'Open items statement', exact: true }) })
  await row.getByText('Not sent: local run', { exact: true }).first().waitFor()
  const mail = await openFold(fold(page, 'Customer email history'))
  await mail.getByRole('link', { name: /statement/i }).first().waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  const proof = process.env.PANTRY_PROOF_DIR
  if (proof) {
    await mkdir(proof, { recursive: true })
    await panel.locator('summary').first().evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 100))
    await page.screenshot({ path: `${proof}/statements-history-${width}.png` })
    await row.getByRole('link', { name: 'Open items statement', exact: true }).evaluate(el => window.scrollBy(0, el.getBoundingClientRect().top - 120))
    await page.screenshot({ path: `${proof}/statements-panel-${width}.png` })
  }
  await row.getByRole('link', { name: 'Open items statement', exact: true }).click()
  await page.getByRole('heading', { name: /statement/i }).waitFor()
  assert.ok((await page.locator('body').innerText()).includes(customer.name))
  assert.ok(!(await page.locator('body').innerText()).includes(customer.internal_notes))
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  if (proof) await page.screenshot({ path: `${proof}/statement-original-${width}.png`, fullPage: true })
  const original = await context.request.get(origin + statement.document_href)
  assert.equal(await original.text(), statement.html)
  // The private original links to the customer's posted source records.
  const source = page.getByRole('link').filter({ hasText: /INV-/ }).first()
  await source.click()
  await page.getByRole('heading', { name: /INV-/ }).first().waitFor()
  await page.goto(`${origin}/app/sales?tab=contacts&customer=${customer.id}`)
  await openFold(panel)
  await panel.getByRole('link', { name: 'Open items statement', exact: true }).waitFor()
  for (const control of await panel.locator('button:visible,a:visible').all()) {
    if ((await control.innerText()).trim()) continue
    const label = await control.getAttribute('aria-label'); assert.ok(label)
    await control.focus(); await page.getByRole('tooltip', { name: label, exact: true }).waitFor()
  }
}
