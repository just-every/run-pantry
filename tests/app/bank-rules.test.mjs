// The real built bank-rule editor and filing states, on both supported widths.
import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { books } from './books.mjs'
import { worker, TOKEN } from './worker.mjs'

test('RULE-002 ordered suggest and automatic rules preview six charges and retain filed revisions at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  let cookies
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } })
    const origin = app.origin, page = await context.newPage()
    if (width === 1440) {
      assert.equal((await context.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
      await context.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
      await books(context.request, origin)
    } else await context.addCookies(cookies)
    const cmd = async (op, data) => { const r = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
    const view = async path => (await context.request.get(`${origin}/api/pantry/${path}`)).json()
    const state = await view('state'), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id])), bank = state.bankAccounts[0], month = width === 1440 ? '10' : '11', description = `ADOBE ${width}`
    await cmd('statement.import', { bankAccountId: bank.id, fileName: `adobe-six-${width}.csv`, content: 'Posting Date,Description,Amount\n' + [1,2,3,4,5,6].map(day => `${month}/${String(day).padStart(2, '0')}/2026,${description},-54.99`).join('\n') + '\n', opening: '8440.01', closing: '8110.07', start: `2026-${month}-01`, end: `2026-${month}-06`, confirmLast4: '4821' })
    await page.goto(`${origin}/app/bank?tab=rules`)
    await page.getByRole('button', { name: 'New rule', exact: true }).click()
    const editor = page.locator('.rule-editor')
    await editor.getByLabel('Payee', { exact: true }).fill('Adobe')
    await editor.getByLabel('Description match').selectOption('equals')
    await editor.getByLabel('Description text').fill(description)
    await editor.getByLabel('Priority').fill('10')
    await editor.getByLabel('Mode', { exact: true }).selectOption('suggest')
    await editor.getByLabel('Category', { exact: true }).selectOption(acct['6200'])
    await editor.getByLabel('Rule name').fill(`Adobe software ${width}`)
    await editor.getByRole('button', { name: 'Preview', exact: true }).click()
    await editor.getByText('This rule suggests 6 open lines for a person to file', { exact: true }).waitFor()
    const history = editor.getByText('Last six matching charges, including previously filed lines:', { exact: true }).locator('..').locator('ul').last()
    assert.equal(await history.getByRole('listitem').count(), 6)
    await page.screenshot({ path: `/tmp/sx-pantry-r7-rule-preview-${width}.png`, fullPage: true })
    await editor.getByRole('button', { name: 'Save rule', exact: true }).click()
    await editor.waitFor({ state: 'detached' })
    await page.getByRole('heading', { name: 'Suggested by your rules' }).waitFor()
    assert.ok((await view('bank/lines')).lines.filter(l => l.description === description).every(l => !l.match_id))
    await page.screenshot({ path: `/tmp/sx-pantry-r7-rule-suggest-${width}.png`, fullPage: true })
    const ruleRow = page.getByRole('row').filter({ hasText: `Adobe software ${width}` })
    await ruleRow.focus()
    await ruleRow.getByRole('button', { name: 'Edit', exact: true }).click()
    await editor.getByLabel('Mode', { exact: true }).selectOption('automatic')
    await editor.getByRole('button', { name: 'Preview', exact: true }).click()
    await editor.getByText('This rule would file 6 lines now', { exact: true }).waitFor()
    await editor.getByRole('button', { name: 'Save rule', exact: true }).click()
    await editor.waitFor({ state: 'detached' })
    const filed = (await view('bank/lines')).lines.filter(l => l.description === description)
    assert.equal(filed.length, 6); assert.ok(filed.every(l => l.rule_revision && l.rule_snapshot.name === `Adobe software ${width}`))
    await page.getByRole('tab', { name: 'Transactions', exact: true }).click()
    const transaction = page.getByRole('row').filter({ hasText: description }).first()
    await transaction.getByText(`Filed by rule · Adobe software ${width}`, { exact: true }).waitFor()
    await transaction.getByText(/Revision/).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r7-rule-filed-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (width === 1440) cookies = await context.cookies()
    await context.close()
  }
})


test('RULE-003 history suggestions prefill human filing, follow a changed sixth category and show rates at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  let cookies
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ viewport: { width, height: 900 } }), page = await context.newPage(), origin = app.origin
    if (width === 1440) {
      assert.equal((await context.request.post(`${origin}/auth/bootstrap`, { headers: { origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
      await context.request.post(`${origin}/setup`, { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
      await books(context.request, origin)
    } else await context.addCookies(cookies)
    const cmd = async (op, data) => { const r = await context.request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
    const view = async path => (await context.request.get(`${origin}/api/pantry/${path}`)).json()
    const state = await view('state'), acct = Object.fromEntries(state.accounts.map(a => [a.code, a.id])), bank = state.bankAccounts[0], month = width === 1440 ? '10' : '11', merchant = width === 1440 ? 'FIGMA' : 'NOTION'
    await cmd('statement.import', { bankAccountId: bank.id, fileName: `${merchant}-history.csv`, content: 'Posting Date,Description,Amount\n' + [1,2,3,4,5,6,7].map(day => `${month}/0${day}/2026,${merchant} 0${day},-20.00`).join('\n') + '\n', opening: '8440.01', closing: '8300.01', start: `2026-${month}-01`, end: `2026-${month}-07`, confirmLast4: '4821' })
    const all = (await view('bank/lines')).lines.filter(l => l.description.startsWith(merchant)).sort((a,b) => a.posted_date.localeCompare(b.posted_date))
    for (const line of all.slice(0,5)) await cmd('match.approve', { bankLineIds: [line.id], create: [{ type: 'fee', direction: 'out', amount: '20.00', accountId: acct['6200'] }] })
    await page.goto(`${origin}/app/bank`)
    const sixth = page.getByRole('row').filter({ hasText: `${merchant} 06` })
    await sixth.getByText('Suggested: Software and subscriptions', { exact: true }).waitFor()
    await page.screenshot({ path: `/tmp/sx-pantry-r7-learned-queue-${width}.png`, fullPage: true })
    await sixth.getByRole('button', { name: 'File it', exact: true }).click()
    const panel = page.locator('.match-panel')
    await panel.getByRole('heading', { name: 'Match review' }).waitFor()
    assert.equal(await panel.getByLabel('Account', { exact: true }).inputValue(), acct['6200'])
    await panel.getByLabel('Account', { exact: true }).selectOption(acct['6300'])
    await panel.screenshot({ path: `/tmp/sx-pantry-r7-learned-review-${width}.png` })
    await panel.getByRole('button', { name: 'Approve match', exact: true }).click()
    await panel.waitFor({ state: 'detached' })
    const seventh = page.getByRole('row').filter({ hasText: `${merchant} 07` })
    await seventh.getByText('Suggested: Office supplies', { exact: true }).waitFor()
    const q = await view('bank/lines'), rate = q.suggestionRates.find(r => r.source === 'history')
    assert.equal(q.suggestions[all[6].id].accountId, acct['6300'])
    assert.ok(rate.changed > 0)
    const rateRow = page.getByRole('table', { name: 'Suggestion acceptance by source' }).getByRole('row').filter({ hasText: 'Your filing history' })
    assert.ok((await rateRow.textContent()).includes(`${rate.changed} (${rate.changeRate}%)`))
    await page.screenshot({ path: `/tmp/sx-pantry-r7-learned-changed-${width}.png`, fullPage: true })
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    if (width === 1440) cookies = await context.cookies()
    await context.close()
  }
})

import {queueBrowser} from './queue-journey.mjs'
test('RULE-001 fifty-line review, split coding, card payment, personal exclusion, bulk acceptance and undo at 1440 and 390',queueBrowser)
