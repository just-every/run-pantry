import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

test('ACCT-003 bulk reclassification, review notes and changes since review work in Books › Review at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const cmd = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const get = async path => (await owner.request.get(`${app.origin}/api/pantry/${path}`)).json()
  await cmd('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-01-01' })
  await cmd('chart.start', {})
  const acct = Object.fromEntries((await get('state')).accounts.map(a => [a.code, a.id]))
  for (let i = 0; i < 40; i++) {
    const d = await cmd('journal.save-draft', { date: `2026-09-${String(1 + (i % 28)).padStart(2, '0')}`, memo: `Design tool seat ${i + 1}`, lines: [{ accountId: acct['6300'], debit: `${10 + i}.00` }, { accountId: acct['3000'], credit: `${10 + i}.00` }] })
    await cmd('journal.post', { id: d.id, revision: d.revision })
  }
  const signedIn = await owner.storageState()
  const open = async width => {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await page.goto(`${app.origin}/app/books`)
    return { context, page, errors }
  }
  // 1440: reclassify all 40 Office supplies lines to Software, then mark the review.
  let { context, page, errors } = await open(1440)
  await page.getByRole('tab', { name: 'Review', exact: true }).click()
  await page.getByLabel('From account').selectOption({ label: '6300 · Office supplies' })
  await page.getByLabel('Select all lines').check()
  await page.getByLabel('To account').selectOption({ label: '6200 · Software and subscriptions' })
  await page.getByLabel('Reason').fill('Software seats booked to office supplies')
  await page.screenshot({ path: '/tmp/sx-pantry-r8-review-reclassify-1440.png', fullPage: true })
  await page.getByRole('button', { name: 'Reclassify 40 lines', exact: true }).click()
  const batches = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Reclassifications', exact: true }) })
  await batches.getByRole('row').filter({ hasText: '6200 · Software and subscriptions' }).waitFor()
  assert.match(await batches.innerText(), /40\s+6200 · Software and subscriptions\s+\$1,180\.00/)
  await page.getByRole('button', { name: 'Mark reviewed now', exact: true }).click()
  await page.getByText('Nothing has changed since your last review.', { exact: true }).waitFor()
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
  assert.deepEqual(errors, []); await context.close()
  const tb = Object.fromEntries((await get('reports/trial-balance?to=2026-09-30')).rows.map(x => [x.code, x.net]))
  assert.deepEqual([tb['6300'] ?? 0, tb['6200']], [0, 118000])
  // A change after the review appears with its author.
  const draft = await cmd('journal.save-draft', { date: '2026-09-30', memo: 'Accrued design contractor', lines: [{ accountId: acct['6000'], debit: '300.00' }, { accountId: acct['3000'], credit: '300.00' }] })
  await cmd('journal.save-draft', { id: draft.id, revision: draft.revision, date: '2026-09-30', memo: 'Accrued design contractor', lines: [{ accountId: acct['6000'], debit: '350.00' }, { accountId: acct['3000'], credit: '350.00' }] })
  for (const width of [1440, 390]) {
    ({ context, page, errors } = await open(width))
    await page.getByRole('tab', { name: 'Journal entries', exact: true }).click()
    await page.getByRole('row').filter({ hasText: 'Design tool seat 4' }).first().click()
    await page.getByText('reclassified', { exact: false }).first().waitFor()
    const note = `Confirm seat 4 was cancelled (${width})`
    await page.getByLabel('Review note').fill(note)
    await page.getByRole('button', { name: 'Add review note', exact: true }).click()
    await page.getByText(note).first().waitFor()
    await page.getByRole('tab', { name: 'Review', exact: true }).click()
    const changes = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Changed since your last review', exact: true }) })
    await changes.getByRole('row').filter({ hasText: 'Edited draft' }).waitFor()
    assert.match(await changes.innerText(), /owner@example\.test\s+Edited draft\s+Draft — Accrued design contractor/)
    assert.match(await changes.innerText(), /Left a review note/)
    assert.match(await page.locator('section').filter({ has: page.getByRole('heading', { name: 'Review notes', exact: true }) }).innerText(), new RegExp(note.replace(/[()]/g, '\\$&')))
    assert.doesNotMatch(await page.locator('main').innerText(), /\[object Object\]/)
    await page.screenshot({ path: `/tmp/sx-pantry-r8-review-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, []); await context.close()
  }
})
