import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { books } from './books.mjs'
import { worker, TOKEN } from './worker.mjs'

export async function remindersJourney(t) {
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] })
  t.after(() => browser.close())
  for (const width of [1440, 390]) {
    const app = await worker(), context = await browser.newContext({ viewport: { width, height: 1000 } })
    try {
      assert.equal((await context.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })).status(), 303)
      assert.equal((await context.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
      await books(context.request, app.origin)
      const view = async path => {
        const response = await context.request.get(`${app.origin}/api/pantry/${path}`)
        assert.equal(response.status(), 200, await response.text()); return response.json()
      }
      const page = await context.newPage(), errors = []
      page.on('pageerror', error => errors.push(String(error)))
      const submit = async (op, button) => {
        const [response] = await Promise.all([page.waitForResponse(r => r.url().endsWith(`/command/${op}`)), button.click()])
        assert.equal(response.status(), 200, await response.text())
        return response.json()
      }
      const proof = async (name, target) => {
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true, `${name} fits at ${width}`)
        assert.equal(await target.locator('button').evaluateAll(buttons => buttons.filter(button => !button.textContent.trim()).length), 0, 'all controls in the reminder panel have visible labels')
        if (process.env.PANTRY_PROOF_DIR) {
          await mkdir(process.env.PANTRY_PROOF_DIR, { recursive: true })
          const anchor = name.startsWith('reminders-customer') ? target.getByLabel('Customer reminder days', {exact:true}) : name === 'reminders-settings' ? target.getByLabel('Reminder subject', {exact:true}) : target.getByRole('button', {name:'Pause reminders',exact:true})
          await anchor.evaluate(element => element.scrollIntoView({block:'center'}))
          await page.screenshot({ path: `${process.env.PANTRY_PROOF_DIR}/${name}-${width}.png` })
        }
      }

      const subject = `Invoice {{invoice}} from {{business}} · ${width}`
      const body = 'Hello {{customer}},\nInvoice {{invoice}} was due {{due_date}}. The balance is {{balance}}.\nView it: {{link}}\nThank you, {{business}} <accounts & billing>'
      await page.goto(`${app.origin}/app/settings`)
      const settings = page.locator('section.card').filter({ has: page.getByRole('heading', { name: 'Sending invoices and reminders', exact: true }) })
      await settings.getByRole('checkbox', { name: 'Send reminders for unpaid invoices', exact: true }).check()
      await settings.getByLabel('Reminder days', { exact: true }).fill('-3, 0, 7')
      await settings.getByLabel('Reminder subject', { exact: true }).fill(subject)
      await settings.getByLabel('Reminder message', { exact: true }).fill(body)
      await submit('sending.save', settings.getByRole('button', { name: 'Save reminders', exact: true }))
      await page.reload()
      await settings.getByLabel('Reminder message', { exact: true }).waitFor()
      assert.equal(await settings.getByLabel('Reminder subject', { exact: true }).inputValue(), subject)
      assert.equal(await settings.getByLabel('Reminder message', { exact: true }).inputValue(), body)
      const sending = (await view('invoicing')).sending
      assert.equal(sending.reminder_subject, subject); assert.equal(sending.reminder_body, body)
      assert.deepEqual(sending.reminder_days, [-3, 0, 7])
      await proof('reminders-settings', settings)

      const customer = (await view('state')).contacts.find(contact => contact.name === 'Cedar Studio')
      const editCustomer = async () => {
        await page.goto(`${app.origin}/app/sales?tab=contacts&customer=${customer.id}`)
        await page.getByRole('button', { name: 'Edit contact details', exact: true }).click()
        return page.locator('section.card').filter({ has: page.getByRole('heading', { name: `Edit ${customer.name}`, exact: true }) })
      }
      let editor = await editCustomer()
      assert.equal(await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).isChecked(), true)
      await editor.getByLabel('Email', { exact: true }).fill('billing@cedar.example.test')
      await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).uncheck()
      await editor.getByLabel('Customer reminder days', { exact: true }).fill('-2, 4, 10')
      await submit('contact.save', editor.getByRole('button', { name: 'Save', exact: true }))
      editor = await editCustomer()
      assert.equal(await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).isChecked(), false)
      assert.equal(await editor.getByLabel('Customer reminder days', { exact: true }).inputValue(), '-2, 4, 10')
      assert.deepEqual(JSON.parse((await view('state')).contacts.find(contact => contact.id === customer.id).reminder_days), [-2, 4, 10])
      await proof('reminders-customer', editor)
      // An empty override disables this customer's reminders and survives reload.
      await editor.getByLabel('Customer reminder days', { exact: true }).fill('')
      await submit('contact.save', editor.getByRole('button', { name: 'Save', exact: true }))
      editor = await editCustomer()
      assert.equal(await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).isChecked(), false)
      assert.equal(await editor.getByLabel('Customer reminder days', { exact: true }).inputValue(), '')
      assert.deepEqual(JSON.parse((await view('state')).contacts.find(contact => contact.id === customer.id).reminder_days), [])
      await proof('reminders-customer-disabled', editor)
      // Returning to the default persists null rather than an empty override.
      await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).check()
      await submit('contact.save', editor.getByRole('button', { name: 'Save', exact: true }))
      editor = await editCustomer()
      assert.equal(await editor.getByRole('checkbox', { name: 'Use business reminder schedule', exact: true }).isChecked(), true)
      assert.equal((await view('state')).contacts.find(contact => contact.id === customer.id).reminder_days, null)

      const invoice = (await view('sales')).invoices.find(invoice => invoice.customer_id === customer.id)
      await page.goto(`${app.origin}/app/sales?invoice=${invoice.id}`)
      const sendingPanel = page.locator('.send-panel')
      await submit('invoice.send', sendingPanel.getByRole('button', { name: 'Send invoice', exact: true }))
      await sendingPanel.getByRole('button', { name: 'Pause reminders', exact: true }).waitFor()
      await sendingPanel.getByRole('heading', { name: 'Deliveries', exact: true }).waitFor()
      await sendingPanel.locator('.send-log li').filter({ hasText: 'billing@cedar.example.test' }).getByText('Not sent: local run', { exact: true }).waitFor()
      const next = sendingPanel.locator('.facts > div').filter({ has: page.locator('dt', { hasText: 'Next reminder' }) }).locator('dd')
      assert.match(await next.innerText(), /After the invoice is sent/)
      await submit('invoice.reminders', sendingPanel.getByRole('button', { name: 'Pause reminders', exact: true }))
      await sendingPanel.getByText('Paused for this invoice', { exact: true }).waitFor()
      await page.reload()
      await sendingPanel.getByRole('button', { name: 'Resume reminders', exact: true }).waitFor()
      assert.equal((await view('sales')).invoices.find(item => item.id === invoice.id).reminders_paused, 1)
      await submit('invoice.reminders', sendingPanel.getByRole('button', { name: 'Resume reminders', exact: true }))
      await sendingPanel.getByRole('button', { name: 'Pause reminders', exact: true }).waitFor()
      assert.match(await next.innerText(), /After the invoice is sent/)
      assert.equal((await view('sales')).invoices.find(item => item.id === invoice.id).reminders_paused, 0)
      await proof('reminders-invoice', sendingPanel)
      assert.deepEqual(errors, [])
    } finally { await context.close(); await app.close() }
  }
}
