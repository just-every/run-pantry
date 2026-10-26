import assert from 'node:assert/strict'

// Stripe's documented sandbox card saves successfully and declines later charges.
// https://docs.stripe.com/testing
export async function declinedCard({ app, browser, headers, command, view, acct, day, stripe, receipt, retain, stage }) {
  const customer = await command('contact.save', { kind: 'customer', name: 'Synthetic Pantry declined card', email: 'synthetic-pantry-card@example.test', billingAddress: '12 Cedar Street, New York NY 10001', termsDays: 1 })
  let template = await command('recurring.save', { customerId: customer.id, startDate: day, every: 1, unit: 'month', termsDays: 1, mode: 'send', lines: [{ description: 'Synthetic recurring card service', quantity: '1', rate: '1', accountId: acct, taxCode: 'exempt' }] })
  template = await command('recurring.approve', { id: template.id, revision: template.revision })
  await app.cron(Date.parse(day + 'T16:00:00Z'))
  const invoice = (await view('sales')).invoices.find(i => i.recurring_id === template.id)
  assert.ok(invoice?.link_token)
  await command('autopay.policy', { customerId: customer.id, recurringId: template.id, enabled: true, consent: true, purpose: 'Synthetic recurring card service at the billing address', noticeRecipients: [{ recipient: customer.email, timeZone: 'America/New_York' }] })
  const payer = await browser.newContext({ extraHTTPHeaders: headers, viewport: { width: 390, height: 844 } })
  const page = await payer.newPage()
  const returnedDocuments = []
  page.on('response', response => {
    if (!response.request().isNavigationRequest() || new URL(response.url()).origin !== app.origin) return
    const entry = { status: response.status(), mainFrame: response.frame() === page.mainFrame() }
    returnedDocuments.push(entry)
    void response.text().then(body => { entry.bytes = body.length; entry.savedCardText = /Saved card.*Autopay authorized/.test(body); entry.pdfFrame = body.includes('invoice.pdf') }).catch(() => { entry.readFailed = true })
  })
  try {
    page.setDefaultTimeout(20000)
    await page.goto(`${app.origin}/i/${invoice.link_token}`)
    await page.getByText('Save a method for recurring invoices', { exact: true }).click()
    await page.getByLabel('Payment method', { exact: false }).selectOption('card')
    await page.getByLabel('I authorize these recurring charges and agree to the authorization above.', { exact: true }).check()
    await page.getByRole('button', { name: 'Continue to Stripe to save method', exact: true }).click()
    await page.waitForURL(url => url.hostname === 'checkout.stripe.com')
    await stage('decline-card-checkout', page)
    await page.getByPlaceholder('1234 1234 1234 1234').fill('4000000000000341')
    await page.getByPlaceholder('MM / YY').fill('1230')
    await page.getByPlaceholder('CVC').fill('123')
    const name = page.getByLabel('Cardholder name', { exact: true })
    if (await name.isVisible()) await name.fill('Synthetic Pantry')
    await page.getByRole('combobox', { name: 'Country or region', exact: true }).selectOption('US')
    const link = page.getByRole('checkbox', { name: /Save my information with Link/ })
    if (await link.isVisible()) await link.uncheck()
    const postal = page.getByPlaceholder('ZIP')
    if (await postal.isVisible()) await postal.fill('10001')
    await page.getByRole('button', { name: /^(save|set up|save card)$/i }).click()
    await page.waitForURL(url => url.origin === app.origin)
    await page.getByText(/Saved card.*Autopay authorized/).waitFor()
    await stage('decline-card-saved', page)
    const saved = await view(`autopay/${customer.id}`)
    assert.equal(saved.saved.active, true)
    assert.ok(saved.saved.acceptedAt && saved.saved.acceptedIP)
    receipt.card = { saved: true, attempts: [], emailOutcomes: [] }
    const state = () => view(`autopay/${customer.id}`)
    for (const offset of [0, 1, 3, 7]) {
      const at = new Date(invoice.due_date + 'T16:00:00Z')
      at.setUTCDate(at.getUTCDate() + offset)
      await app.cron(at.getTime())
      const current = await state(), attempt = current.attempts.find(a => a.sequence === receipt.card.attempts.length)
      assert.ok(attempt?.payment_intent)
      const intent = await stripe(`/payment_intents/${attempt.payment_intent}`)
      assert.equal(intent.livemode, false)
      assert.equal(intent.amount, 100)
      assert.equal(intent.status, 'requires_payment_method')
      assert.equal(attempt.status, 'failed')
      assert.equal(attempt.attempted_on, at.toISOString().slice(0, 10))
      assert.equal(attempt.scheduled_on, attempt.attempted_on)
      receipt.card.attempts.push({ id: intent.id, sequence: attempt.sequence, scheduledOn: attempt.scheduled_on, status: intent.status, failureCode: intent.last_payment_error?.code })
      await retain()
    }
    const current = await state()
    assert.equal(current.attempts.length, 4)
    assert.equal(new Set(current.attempts.map(a => a.payment_intent)).size, 4)
    assert.equal(current.notices.length, 4)
    assert.ok(current.notices.every(n => n.status === 'suppressed'))
    receipt.card.emailOutcomes = current.notices.map(n => ({ attemptId: n.attempt_id, status: n.status, provider: n.provider }))
    receipt.card.emailTransport = 'development suppression; accepted mail is asserted at the network edge in the API journey'
    await page.goto(`${app.origin}/i/${invoice.link_token}`)
    await page.getByRole('button', { name: 'Revoke autopay', exact: true }).click()
    await page.getByText(/Autopay is off/).waitFor()
    const submissions = receipt.paymentSubmissions
    await app.cron(Date.parse(invoice.due_date + 'T16:00:00Z') + 8 * 86400000)
    const nextPeriod = new Date(day + 'T16:00:00Z')
    nextPeriod.setUTCMonth(nextPeriod.getUTCMonth() + 1)
    await app.cron(nextPeriod.getTime())
    const nextInvoice = (await view('sales')).invoices.find(i => i.recurring_id === template.id && i.id !== invoice.id)
    assert.ok(nextInvoice?.link_token, 'The following recurring invoice exists after revocation')
    await app.cron(Date.parse(nextInvoice.due_date + 'T16:00:00Z'))
    assert.equal((await state()).attempts.length, 4)
    assert.equal((await state()).saved.active, false)
    assert.equal(receipt.paymentSubmissions, submissions, 'Revocation prevents a real provider submission on the following invoice due date')
    receipt.card.nextInvoiceDue = nextInvoice.due_date
    receipt.card.revoked = true
    await stage('decline-card-revoked', page)
  } catch (error) {
    const body = await page.locator('body').innerText().catch(() => '')
    const current = await view(`autopay/${customer.id}`).catch(() => null)
    receipt.cardReturn = { origin: new URL(page.url()).origin, text: body.replace(/https?:\/\/\S+/g, '[redacted URL]').slice(0, 700), policyValid: current?.policy?.valid ?? false, saved: current?.saved?.active ?? false, returnedDocuments }
    const response = await payer.request.get(`${app.origin}/i/${invoice.link_token}`)
    const html = await response.text()
    receipt.cardReturn.directResponse = { status: response.status(), bytes: html.length, savedCardText: /Saved card.*Autopay authorized/.test(html) }
    receipt.cardReturn.freshTabs = []
    for (const width of [390, 1440]) {
      const fresh = await payer.newPage()
      await fresh.setViewportSize({ width, height: 900 })
      try {
        await fresh.goto(`${app.origin}/i/${invoice.link_token}`, { timeout: 15000 })
        await fresh.getByText(/Saved card.*Autopay authorized/).waitFor({ timeout: 10000 })
        receipt.cardReturn.freshTabs.push({ width, savedCardVisible: true })
      } catch { receipt.cardReturn.freshTabs.push({ width, savedCardVisible: false }) }
      finally { await fresh.close() }
    }
    await retain()
    await stage('decline-card-blocked', page)
    throw error
  } finally { await payer.close() }
}
