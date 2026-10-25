import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { worker, TOKEN } from './worker.mjs'
async function icons(page) {
  for (const control of await page.locator('button:visible,a:visible').all()) {
    if ((await control.innerText()).trim()) continue
    const label = await control.getAttribute('aria-label')
    assert.ok(label)
    await control.focus()
    await page.getByRole('tooltip', { name: label }).waitFor()
  }
}
export async function w9Browser(t) {
  const app = await worker()
  t.after(() => app.close())
  const browser = await chromium.launch({
    headless: true,
    args: ['--use-mock-keychain', '--password-store=basic'],
  })
  t.after(() => browser.close())
  const owner = await browser.newContext()
  assert.equal(
    (
      await owner.request.post(app.origin + '/auth/bootstrap', {
        headers: { origin: app.origin },
        data: { token: TOKEN, displayName: 'Synthetic owner' },
        maxRedirects: 0,
      })
    ).status(),
    303,
  )
  await owner.request.post(app.origin + '/setup', {
    headers: { origin: app.origin },
    form: { confirm: 'yes' },
    maxRedirects: 0,
  })
  const command = async (op, data) => {
    const r = await owner.request.post(app.origin + '/api/pantry/command/' + op, {
      headers: { origin: app.origin },
      data,
    })
    assert.equal(r.status(), 200, op + ': ' + (await r.text()))
    return r.json()
  }
  await command('entity.save', {
    legalName: 'Synthetic studio',
    entityType: 'single-member-llc',
    state: 'NY',
    fiscalYearStart: 1,
    taxMethod: 'cash',
    booksStart: '2025-01-01',
    policies: '',
  })
  await command('chart.start', {})
  const state = await (await owner.request.get(app.origin + '/api/pantry/state')).json(),
    acct = Object.fromEntries(state.accounts.map((a) => [a.code, a.id])),
    year = new Date().getFullYear()
  const bank = await command('bank-account.save', {
    name: 'Synthetic checking',
    institution: 'Example',
    accountId: acct['1000'],
    numberLast4: '0123',
    openingDate: '2025-01-01',
    openingBalance: '0',
  })
  const evidence = process.env.PANTRY_EVIDENCE_DIR ?? join(tmpdir(), 'pantry-w9')
  await mkdir(evidence, { recursive: true })
  for (const width of [1440, 390]) {
    const v = await command('contact.save', {
      kind: 'vendor',
      name: 'Synthetic contractor ' + width,
      is1099: true,
    })
    await command('payment.record', {
      direction: 'paid',
      contactId: v.id,
      date: `${year}-01-15`,
      amount: '2400',
      bankAccountId: bank.id,
      method: 'ach',
    })
    const context = await browser.newContext({
        storageState: await owner.storageState(),
        viewport: { width, height: 1000 },
      }),
      page = await context.newPage(),
      errors = []
    page.on('pageerror', (e) => errors.push(String(e)))
    await page.goto(app.origin + '/app/agents')
    await page.getByRole('heading', { name: 'Tax readiness all year', exact: true }).waitFor()
    const row = page
      .getByRole('row')
      .filter({ has: page.getByText(`Request a W-9 from Synthetic contractor ${width}`, { exact: false }) })
    await row.getByRole('button', { name: 'Approve private request' }).click()
    const link = row.getByRole('link', { name: 'Open W-9 request' })
    await link.waitFor()
    const url = await link.getAttribute('href')
    await page.screenshot({ path: join(evidence, `readiness-${width}.png`), fullPage: true })
    await icons(page)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    const signedOut = await browser.newContext({ viewport: { width, height: 1000 } }),
      form = await signedOut.newPage()
    await form.goto(url)
    await form.getByRole('heading', { name: 'Form W-9', exact: true }).waitFor()
    for (const [name, value] of Object.entries({
      legalName: 'Synthetic contractor',
      tin: '000000123',
      address: '1 Synthetic Lane',
      city: 'Albany',
      state: 'NY',
      zip: '12207',
      signature: 'Synthetic contractor',
    }))
      await form.locator(`[name="${name}"]`).fill(value)
    await form.locator('[name="certify"]').check()
    assert.ok(await form.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    await form.screenshot({ path: join(evidence, `certification-${width}.png`), fullPage: true })
    const posted = form.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname.startsWith('/w9/'),
    )
    await form.getByRole('button', { name: 'Sign and submit W-9' }).click()
    const submitted = await posted
    assert.equal(submitted.status(), 200, await submitted.text())
    await form.getByRole('heading', { name: 'W-9 received' }).waitFor()
    await form.screenshot({ path: join(evidence, `received-${width}.png`), fullPage: true })
    assert.equal((await signedOut.request.get(url)).status(), 404)
    await signedOut.close()
    await page.goto(app.origin + '/app/sales?tab=contacts')
    await page.getByRole('button', { name: v.name, exact: true }).click()
    await page.getByText('W-9 complete', { exact: true }).waitFor()
    await page.screenshot({ path: join(evidence, `vendor-${width}.png`), fullPage: true })
    await icons(page)
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth))
    assert.ok(!(await page.locator('body').innerText()).includes('000000123'))
    assert.deepEqual(errors, [])
    await context.close()
  }
}
