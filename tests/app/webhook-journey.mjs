import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'

export async function webhookJourney(t) {
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext(); t.after(() => owner.close())
  assert.equal((await owner.request.post(app.origin + '/auth/bootstrap', { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Olivia Owner' }, maxRedirects: 0 })).status(), 303)
  assert.equal((await owner.request.post(app.origin + '/setup', { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
  const command = async (op, data) => {
    const response = await owner.request.post(app.origin + '/api/pantry/command/' + op, { headers: { origin: app.origin }, data })
    // Never include a successful lifecycle response (which may contain a secret) in assertion output.
    if (response.status() !== 200) assert.fail(`${op}: ${response.status()} ${await response.text()}`)
    return response.json()
  }
  const view = async () => {
    const response = await owner.request.get(app.origin + '/api/pantry/webhooks')
    assert.equal(response.status(), 200)
    return response.json()
  }
  await command('entity.save', { legalName: 'Cedar Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: 'Design services invoiced on approval.' })
  await command('chart.start', {})
  const state = await (await owner.request.get(app.origin + '/api/pantry/state')).json()
  const accounts = Object.fromEntries(state.accounts.map(account => [account.code, account.id]))
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'Community Bank', accountId: accounts['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0' })
  const customer = await command('contact.save', { kind: 'customer', name: 'Juniper Workshop', email: 'juniper@example.test', termsDays: 30 })
  const signedIn = await owner.storageState()
  const dir = process.env.PANTRY_WEBHOOK_SCREENSHOTS ?? '/tmp/sx-pantry-c29-webhooks'
  await mkdir(dir, { recursive: true })
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState: signedIn, viewport: { width, height: width === 390 ? 844 : 1000 } })
    try {
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(String(error)))
      await page.goto(app.origin + '/app/settings')
      const card = page.getByRole('heading', { name: 'Webhooks', exact: true }).locator('../..')
      const history = page.getByRole('heading', { name: 'Webhook delivery history', exact: true }).locator('../..')
      const secret = page.getByRole('status', { name: 'One-time webhook secret' })
      const shot = async state => {
        await card.screenshot({ mask: [secret.locator('code')], path: `${dir}/webhooks-${state}-${width}.png` })
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
        assert.equal(await card.getByRole('button').evaluateAll(buttons=>buttons.every(button=>{const r=button.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth})),true,'every webhook action fits the viewport')
      }
      await card.getByLabel('Webhook destination', { exact: true }).fill('https://receiver.example.test/pantry')
      await card.getByLabel('approved', { exact: true }).check()
      await card.getByRole('button', { name: 'Create webhook', exact: true }).click()
      await secret.waitFor()
      assert.equal(await secret.locator('code').evaluate(node => node.textContent.length > 30), true)
      await card.getByText('receiver.example.test', { exact: true }).waitFor()
      await shot('created')
      const subscriptions = await view()
      assert.equal(subscriptions.subscriptions.length, 1)
      assert.equal('secret' in subscriptions.subscriptions[0], false)
      const subscriptionId = subscriptions.subscriptions[0].id

      await page.reload()
      await card.getByText('receiver.example.test', { exact: true }).waitFor()
      assert.equal(await secret.count(), 0)
      await shot('reloaded')
      await card.getByRole('button', { name: 'Rotate secret', exact: true }).click()
      await secret.waitFor()
      // Rotation's secret arrives before the subscription reload finishes. Wait
      // for the action to settle so Edit uses the refreshed revision.
      await card.getByRole('button', { name: 'Rotate secret', exact: true }).waitFor()
      await shot('rotated')
      await card.getByRole('button', { name: 'Edit webhook', exact: true }).click()
      await card.getByRole('heading', { name: 'Edit webhook · receiver.example.test', exact: true }).waitFor()
      assert.equal(await secret.count(), 0)
      await card.getByLabel('Webhook destination', { exact: true }).fill('https://receiver.example.test/pantry-updated')
      await card.getByLabel('paid', { exact: true }).check()
      await shot('editing')
      await card.getByRole('button', { name: 'Save webhook', exact: true }).click()
      await card.getByRole('heading', { name: 'New webhook', exact: true }).waitFor()
      const edited = (await view()).subscriptions.find(subscription => subscription.id === subscriptionId)
      assert.equal(edited.destination, 'https://receiver.example.test/pantry-updated')
      assert.deepEqual([...edited.events].sort(), ['approved', 'paid'])
      assert.equal(await secret.count(), 0)
      await shot('edited')

      await card.getByRole('button', { name: 'Disable webhook', exact: true }).click()
      await card.getByRole('button', { name: 'Enable webhook', exact: true }).waitFor()
      await shot('disabled')
      await card.getByRole('button', { name: 'Enable webhook', exact: true }).click()
      await card.getByRole('button', { name: 'Disable webhook', exact: true }).waitFor()
      assert.equal(await secret.count(), 0)
      await shot('enabled')
      await card.getByText('Data shared and receiver setup', { exact: true }).click()
      await card.getByText(/timestamp\.body/).waitFor()
      await shot('data-shared')
      await card.getByText('Data shared and receiver setup', { exact: true }).click()

      let invoice = await command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-20', lines: [{ description: `Autumn design consultation ${width}`, quantity: '1', rate: '125.00', accountId: accounts['4000'], taxCode: 'exempt' }] })
      await command('invoice.approve', { id: invoice.id, revision: invoice.revision })
      invoice = await command('invoice.issue', { id: invoice.id })
      await command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-10-21', amount: '125.00', bankAccountId: bank.id, allocations: [{ targetId: invoice.id, amount: '125.00' }] })
      assert.equal((await owner.request.get(app.origin + '/cdn-cgi/local/scheduled?cron=' + encodeURIComponent('*/30 * * * *'))).status(), 200)
      // The receiver's .test DNS failure is real; signing and receiver success are exercised at the API network edge.
      let attempts = []
      for (let check = 0; check < 80; check++) {
        attempts = (await view()).history.filter(attempt => attempt.record.id === invoice.id)
        if (attempts.some(attempt => attempt.eventType === 'approved') && attempts.some(attempt => attempt.eventType === 'paid')) break
        await new Promise(resolve => setTimeout(resolve, 250))
      }
      assert.equal(attempts.some(attempt => attempt.eventType === 'approved'), true)
      assert.equal(attempts.some(attempt => attempt.eventType === 'paid'), true)
      for (const attempt of attempts) {
        assert.equal(attempt.host, 'receiver.example.test')
        assert.equal(typeof attempt.errorClass === 'string' && attempt.errorClass.length > 0, true)
        assert.equal(Object.keys(attempt).some(key => /body|headers|destination|secret/i.test(key)), false)
      }
      await card.getByRole('button', { name: 'Refresh webhooks', exact: true }).click()
      await history.getByText(invoice.id, { exact: false }).first().waitFor()
      assert.equal((await history.innerText()).includes('/pantry-updated'), false)
      await history.screenshot({ path: `${dir}/webhooks-history-${width}.png` })
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)

      page.once('dialog', dialog => dialog.accept())
      await card.getByRole('button', { name: 'Delete webhook', exact: true }).click()
      await card.getByText('No webhook subscriptions yet.', { exact: true }).waitFor()
      await shot('deleted')
      assert.equal((await view()).subscriptions.length, 0)
      assert.deepEqual(errors, [])
    } finally { await context.close() }
  }
}
