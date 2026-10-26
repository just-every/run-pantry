import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { destinationBooks } from '../api/portability-journey.mjs'

async function owner(context, origin) {
  assert.equal((await context.request.post(origin + '/auth/bootstrap', { headers: { origin }, data: { token: TOKEN, displayName: 'Migration owner' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await context.request.post(origin + '/setup', { headers: { origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const command = async (op, data) => { const r = await context.request.post(origin + '/api/pantry/command/' + op, { headers: { origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const view = async path => { const r = await context.request.get(origin + '/api/pantry/' + path); assert.equal(r.status(), 200, await r.text()); return r.json() }
  return { command, view }
}
async function screen(page, name, width) {
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, name)
  const missing = await page.locator('button').evaluateAll(buttons => buttons.filter(b => !b.textContent.trim() && !b.hasAttribute('aria-label')).length)
  assert.equal(missing, 0, 'Icon controls retain accessible labels')
  if (process.env.PANTRY_PROOF_DIR) await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/${name}-${width}.png`, fullPage: true })
}
export async function destinationExportsBrowser(t) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  if (process.env.PANTRY_PROOF_DIR) await mkdir(process.env.PANTRY_PROOF_DIR, { recursive: true })
  for (const width of [1440, 390]) {
    const destination = await worker(), next = await browser.newContext({ viewport: { width, height: 1000 } })
    next.setDefaultTimeout(30_000)
    try {
      const { command, view } = await owner(next, destination.origin)
      await destinationBooks(command, view)
      const page = await next.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
      await page.goto(destination.origin + '/app/move-in')
      await page.getByText('Export a closed year to another accounting system', { exact: true }).click()
      await page.getByLabel('Fiscal year ending in', { exact: true }).fill('2027')
      await page.getByRole('button', { name: 'Review destination export', exact: true }).click()
      await page.getByRole('alert').filter({ hasText: /Close/ }).waitFor()
      await screen(page, 'destination-unclosed', width)
      await page.getByLabel('Fiscal year ending in', { exact: true }).fill('2026')
      for (const system of ['qbo', 'xero']) {
        await page.getByLabel('Destination accounting system', { exact: true }).selectOption(system)
        await page.getByRole('button', { name: 'Review destination export', exact: true }).click()
        await page.getByRole('link', { name: 'Download destination package', exact: true }).waitFor()
        await screen(page, `destination-${system}`, width)
        const url = await page.getByRole('link', { name: 'Download destination package', exact: true }).getAttribute('href')
        const response = await next.request.get(destination.origin + url)
        assert.equal(response.status(), 200); assert.equal(response.headers()['content-type'],'application/zip')
      }
      await page.goto(destination.origin+'/app/settings');const disclosure=page.locator('[data-service="qbo"]');await disclosure.locator('summary').click();if(process.env.PANTRY_PROOF_DIR)await disclosure.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/qbo-disclosure-${width}.png`});assert.deepEqual(errors, [])
    } finally { await next.close(); await destination.close() }
  }
}
