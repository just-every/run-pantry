import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

const origin = 'https://billing-qualification.runeditrun.com'
const carry = {
  version: 1, origin, business_id: 'synthetic-pantry-1',
  business_url: `${origin}/business/synthetic-pantry-1`,
  name: 'Example Business Co', legal_name: 'Example Business Company LLC',
  accent: null, logo_url: null, refreshed_at: '2026-10-27T09:00:00.000Z',
}
const productionBusiness = 'https://app.runeditrun.com/business'

export async function businessCarryJourney() {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  try {
    for (const [scenario, business] of [['carried', carry], ['name-only', { ...carry, legal_name: null }], ['missing', null]]) {
      const app = await worker(business ? { RER_BUSINESS: JSON.stringify(business) } : {})
      const contexts = []
      try {
        const owner = await browser.newContext(); contexts.push(owner)
        assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Example Owner' }, maxRedirects: 0 })).status(), 303)
        assert.equal((await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
        const readSettings = async () => {
          const response = await owner.request.get(`${app.origin}/api/pantry/state`)
          assert.equal(response.status(), 200)
          return (await response.json()).settings
        }
        const initial = await readSettings()
        assert.equal(initial.entity, null, 'carrying a Business does not create accounting details')
        assert.deepEqual(initial.business, business ? { name: business.name, legalName: business.legal_name, origin: business.origin, url: business.business_url } : null)
        const storageState = await owner.storageState(), pages = []
        for (const width of [1440, 390]) {
          const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 1000 } }); contexts.push(context)
          const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(String(error)))
          pages.push({ page, errors, width })
          await page.goto(`${app.origin}/app/settings`)
          const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: 'The business', exact: true }) })
          await summary.getByRole('link', { name: 'Set up the business', exact: true }).waitFor()
          if (business) assert.ok((await summary.innerText()).includes(business.name), `carried name in settings at ${width}`)
          await summary.getByRole('link', { name: 'Set up the business', exact: true }).click()
          assert.equal(new URL(page.url()).searchParams.get('step'), 'business')
          const shared = page.locator('section').filter({ has: page.getByRole('heading', { name: 'Your shared Business', exact: true }) })
          await shared.waitFor()
          const link = shared.getByRole('link')
          assert.equal(await link.getAttribute('href'), business?.business_url ?? productionBusiness)
          assert.equal(await link.getAttribute('target'), '_blank')
          assert.ok((await link.getAttribute('rel')).split(/\s+/).includes('noreferrer'))
          if (business) {
            const content = await shared.innerText()
            assert.ok(content.includes(business.name), `carried identity at ${width}`)
            assert.ok(content.includes(new URL(business.origin).host), `carried source at ${width}`)
            assert.equal(await page.locator(`a[href="${productionBusiness}"]`).count(), 0)
          }
          assert.equal(await page.getByText(/not copied into Pantry yet/).count(), 0)
          assert.equal(await page.getByLabel('Legal name', { exact: true }).inputValue(), business ? business.legal_name ?? business.name : '')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `business setup fits ${width}`)
          if (process.env.PANTRY_PROOF_DIR) await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/business-${scenario}-${width}.png`, fullPage: true })
        }
        let saved
        for (const { page, errors, width } of pages) {
          if (saved) {
            await page.reload()
            await page.getByRole('button', { name: 'Save business', exact: true }).waitFor()
            assert.equal(await page.getByLabel('Legal name', { exact: true }).inputValue(), saved.legal_name, 'saved accounting name takes precedence over carry')
            assert.deepEqual((await readSettings()).entity, saved, 'opening the carried Business does not overwrite saved details')
          }
          const legalName = width === 1440 && business ? business.legal_name ?? business.name : `Example Accounting ${width} LLC`
          await page.getByLabel('Legal name', { exact: true }).fill(legalName)
          await page.getByLabel('Entity type', { exact: true }).selectOption('single-member-llc')
          await page.getByLabel('State of organization', { exact: true }).selectOption('NY')
          await page.getByLabel('Fiscal year starts', { exact: true }).selectOption('4')
          await page.getByLabel('Books start', { exact: true }).fill('2026-01-01')
          await page.getByLabel('Tax accounting method (declared with your accountant)', { exact: true }).selectOption('cash')
          await page.getByLabel('Book and report policies', { exact: true }).fill('Revenue recognized when invoiced; accountant reviews exceptions.')
          const saving = page.waitForResponse(response => response.url().endsWith('/api/pantry/command/entity.save') && response.request().method() === 'POST')
          await page.getByRole('button', { name: saved ? 'Save business' : 'Set up the business', exact: true }).click()
          const response = await saving
          assert.equal(response.status(), 200)
          saved = await response.json()
          await page.getByRole('button', { name: 'Save business', exact: true }).waitFor()
          assert.deepEqual([saved.legal_name, saved.currency, saved.book_basis, saved.tax_method, saved.state, saved.fiscal_year_start], [legalName, 'USD', 'accrual', 'cash', 'NY', 4])
          assert.equal(saved.policies, 'Revenue recognized when invoiced; accountant reviews exceptions.')
          await page.goto(`${app.origin}/app/settings`)
          const summary = page.locator('section').filter({ has: page.getByRole('heading', { name: 'The business', exact: true }) })
          await summary.getByText(legalName, { exact: true }).waitFor()
          await summary.getByRole('link', { name: 'Business details', exact: true }).click()
          await page.getByRole('button', { name: 'Save business', exact: true }).waitFor()
          assert.equal(await page.getByLabel('Legal name', { exact: true }).inputValue(), legalName)
          assert.deepEqual((await readSettings()).entity, saved, 'saved details survive settings navigation')
          assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `saved business fits ${width}`)
          assert.deepEqual(errors, [], `business setup has no page errors at ${width}`)
          if (process.env.PANTRY_PROOF_DIR) await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/business-${scenario}-saved-${width}.png`, fullPage: true })
        }
      } finally {
        for (const context of contexts.reverse()) await context.close()
        await app.close()
      }
    }
  } finally { await browser.close() }
}
