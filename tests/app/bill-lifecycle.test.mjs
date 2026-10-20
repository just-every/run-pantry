import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { billLifecycleScenario } from '../api/bill-lifecycle-scenario.mjs'

test('BILL-001 use the bill list, next actor, payment plan and recurring drafts at 1440 and 390', async t => {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } })
    const boot = await context.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
    assert.equal(boot.status(), 303)
    await context.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
    const h = {
      command: async (op, data) => { const r = await context.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, `${op}: ${await r.text()}`); return r.json() },
      view: async path => { const r = await context.request.get(`${app.origin}/api/pantry/${path}`); assert.equal(r.status(), 200, await r.text()); return r.json() },
      capture: async form => {
        const file = form.get('file')
        const r = await context.request.post(`${app.origin}/api/pantry/receipts/capture`, { headers: { origin: app.origin }, multipart: { source: 'upload', file: { name: file.name, mimeType: file.type, buffer: Buffer.from(await file.arrayBuffer()) } } })
        assert.equal(r.status(), 200, await r.text()); return r.json()
      },
    }
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    await billLifecycleScenario(h, {
      async step(stage, { bill }) {
        for (const viewport of [1440, 390]) {
          await page.setViewportSize({ width: viewport, height: viewport === 390 ? 844 : 1100 })
          await page.goto(`${app.origin}/app/sales?tab=bills${bill ? `&bill=${bill.id}` : ''}`)
          if (stage === 'Captured') await page.getByRole('heading', { name: 'Captured documents awaiting bill preparation', exact: true }).waitFor()
          else {
            const row = page.getByRole('row').filter({ has: page.getByText('HARBOR-SEPT', { exact: true }) })
            await row.getByText(stage === 'Approved draft' ? 'Approved' : stage === 'Recurring drafts' ? 'Reconciled' : stage, { exact: true }).waitFor()
            await row.click(); await page.getByText(`Next: ${bill.lifecycle.nextActor}`, { exact: false }).first().waitFor()
            await page.screenshot({ path: `/tmp/sx-pantry-r15-bill-${stage.replaceAll(' ', '-')}-${viewport}.png`, fullPage: true })
            if (stage === 'Draft' && viewport === 390) await page.getByRole('button', { name: 'Submit bill for approval', exact: true }).click()
            if (stage === 'Approved' && viewport === 390) {
              await page.getByLabel('Planned payment date', { exact: true }).fill('2026-09-12')
              await page.getByLabel('Payment plan note', { exact: true }).fill('Pay by bank transfer outside Pantry')
              await page.getByRole('button', { name: 'Save payment plan', exact: true }).click()
              await row.getByText('Scheduled', { exact: true }).waitFor()
            }
          }
          if (stage !== 'Captured' && viewport === 1440) assert.equal(await page.getByRole('table', { name: 'Bill inbox', exact: true }).evaluate(el => el.scrollWidth <= el.parentElement.clientWidth), true, 'state and next actor fit the bill inbox')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${stage} fits ${viewport}`)
          if (stage === 'Captured') await page.screenshot({ path: `/tmp/sx-pantry-r15-bill-${stage.replaceAll(' ', '-')}-${viewport}.png`, fullPage: true })
        }
      },
      async recurring(f) {
        await page.getByLabel('Bill template name', { exact: true }).fill(f.name)
        await page.getByLabel('Recurring bill vendor', { exact: true }).selectOption(f.vendorId)
        await page.getByLabel('Recurring bill description', { exact: true }).fill(f.lines[0].description)
        await page.getByLabel('Recurring bill account', { exact: true }).selectOption(f.lines[0].accountId)
        await page.getByLabel('Recurring bill amount', { exact: true }).fill(f.lines[0].amount)
        await page.getByLabel('First bill date', { exact: true }).fill(f.startDate)
        await page.getByLabel('Last bill date', { exact: true }).fill(f.endDate)
        await page.getByLabel('Recurring bill terms (days)', { exact: true }).fill(String(f.termsDays))
        await page.getByRole('button', { name: 'Create recurring bill template', exact: true }).click()
        await page.getByRole('button', { name: 'Generate due bills', exact: true }).click()
        await page.getByText('Monthly studio rent · Harbor Studio Rentals', { exact: true }).waitFor()
      },
    })
    assert.deepEqual(errors, []); await context.close()
  }
})
