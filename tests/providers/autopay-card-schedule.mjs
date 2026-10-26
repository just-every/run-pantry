import assert from 'node:assert/strict'

export async function cardSchedule({ app, payer, invoice, customer, template, day, view, stripe, receipt, retain }) {
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
  const response = await payer.request.post(`${app.origin}/i/${invoice.link_token}/autopay/stop`, { headers: { origin: app.origin }, maxRedirects: 0 })
  assert.equal(response.status(), 303)
  receipt.card.revocationDoor = 'Hosted invoice revoke form action'
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
  await retain()
}
