// The real Worker, native owner session, migrations and scheduled handlers.
// Only mail (in harness) and Stripe's HTTP boundary are faked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const linkIn = message => new URL(message.text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
const recipients = messages => messages.flatMap(m => m.to).sort()
const PRIVATE = 'PRIVATE-CUSTOMER-COLLECTION-NOTE-6842'

test('INVOICE-009 customer payment offerings are enforced at hosted checkout; invoice, recurring and reminder delivery use billing plus cc once per recipient without exposing internal notes', async t => {
  const sessions = new Map(), stripeBodies = []
  const h = await harness({ outbound: async request => {
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.stripe.com')
    if (url.pathname === '/v1/account') return Response.json({ id: 'acct_customers', country: 'US', default_currency: 'usd', business_profile: { name: 'Juniper Lane Design' } })
    if (url.pathname === '/v1/checkout/sessions' && request.method === 'POST') {
      const body = new URLSearchParams(await request.text()), id = `cs_customer_${sessions.size + 1}`
      stripeBodies.push(body.toString())
      sessions.set(id, { id, status: 'open', payment_intent: null, body })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    const id = url.pathname.split('/').at(-1)
    if (request.method === 'GET' && sessions.has(id)) {
      const { body, ...session } = sessions.get(id)
      return Response.json(session)
    }
    assert.fail(`Unexpected Stripe call: ${request.method} ${url.pathname}`)
  } }); t.after(() => h.close())
  const { acct } = await books(h), day = today()
  const settings = async (days, on = true) => {
    const { sending } = await h.view('invoicing')
    await h.command('sending.save', { revision: sending.revision, remindersOn: on, reminderDays: days, timeZone: 'America/New_York' })
  }
  await settings('-1', false)
  const contacts = [
    { name: 'Primary contact', email: 'primary@example.test', phone: '', roles: ['primary'] },
    { name: 'Accounts payable', email: 'BILLING@example.test', phone: '', roles: ['billing'] },
    { name: 'Accounts payable copy', email: 'billing@example.test', phone: '', roles: ['cc'] },
    { name: 'Controller', email: 'controller@example.test', phone: '', roles: ['cc'] },
  ]
  let customer = await h.command('contact.save', { kind: 'customer', name: 'Delivery customer', email: '', contacts, internalNotes: PRIVATE, payMethods: ['card'], termsDays: 30 })
  const update = async values => {
    customer = await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', name: customer.name, email: customer.email, termsDays: customer.terms_days, ...values })
  }
  const issue = async customerId => {
    const draft = await h.command('invoice.save-draft', { customerId, issueDate: day, dueDate: day, memo: 'Public invoice memo', lines: [{ description: 'Design services', quantity: '1', rate: '2400.00', accountId: acct['4000'], taxCode: 'exempt' }] })
    const approved = await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
    return h.command('invoice.issue', { id: approved.id })
  }
  const invoice = await issue(customer.id)
  const sent = await h.command('invoice.send', { id: invoice.id })
  assert.deepEqual(sent.deliveries.map(d => d.recipient).sort(), ['billing@example.test', 'controller@example.test'])
  const invoiceMail = () => h.mail.filter(m => m.subject.startsWith(`Invoice ${invoice.number} `))
  assert.deepEqual(recipients(invoiceMail()), ['billing@example.test', 'controller@example.test'])
  const path = linkIn(invoiceMail()[0])
  const page = async () => {
    const response = await h.send(path)
    assert.equal(response.status, 200)
    assert.doesNotMatch(response.value, new RegExp(PRIVATE))
    return response.value
  }
  const pay = async (method, status) => {
    const response = await h.send(path + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: `method=${method}` })
    assert.equal(response.status, status, `${method}: ${response.value}`)
    if (status === 303) assert.match(response.headers.get('location'), /^https:\/\/checkout\.stripe\.com\//)
    return response
  }
  assert.doesNotMatch(await page(), /Pay by|How to pay/, 'card-only customers get no offline instructions when Stripe is unavailable')
  await pay('card', 409)
  await h.command('stripe.connect', { secretKey: 'sk_test_' + crypto.randomUUID().replaceAll('-', '') })
  let html = await page()
  assert.match(html, /Pay by card/); assert.doesNotMatch(html, /Pay by bank account|How to pay/)
  await pay('us_bank_account', 409); await pay('offline', 409)
  assert.equal(sessions.size, 0, 'refused methods never reach Stripe')
  await pay('card', 303)
  assert.equal(sessions.get('cs_customer_1').body.get('allowed_payment_method_types[0]'), 'card')

  await update({ payMethods: ['us_bank_account'] })
  html = await page()
  assert.match(html, /Pay by bank account/); assert.doesNotMatch(html, /Pay by card|How to pay/)
  await pay('card', 409); await pay('us_bank_account', 303)
  assert.equal(sessions.get('cs_customer_2').body.get('allowed_payment_method_types[0]'), 'us_bank_account')
  await update({ payMethods: [] })
  assert.doesNotMatch(await page(), /Pay by|How to pay/)
  await pay('card', 409); await pay('us_bank_account', 409)
  await update({ payMethods: ['offline'] })
  html = await page()
  assert.match(html, /How to pay/); assert.doesNotMatch(html, /Pay by/)
  await pay('card', 409); await pay('us_bank_account', 409); await pay('offline', 409)
  assert.equal(sessions.size, 2)
  await update({ payMethods: null })
  html = await page()
  assert.match(html, /Pay by card/); assert.match(html, /Pay by bank account/); assert.match(html, /How to pay/)
  await h.command('stripe.methods', { card: false, ach: true })
  assert.doesNotMatch(await page(), /Pay by card/)
  await pay('card', 409)
  await h.command('stripe.methods', { card: false, ach: false })
  html = await page()
  assert.doesNotMatch(html, /Pay by/); assert.match(html, /How to pay/)
  await pay('us_bank_account', 409)

  // Default addresses come from the profile; an explicit send remains possible.
  const override = await h.command('invoice.send', { id: invoice.id, to: 'HANDOFF@example.test, handoff@example.test' })
  assert.deepEqual(override.deliveries.map(d => d.recipient), ['handoff@example.test'])
  const fallback = await h.command('contact.save', { kind: 'customer', name: 'Legacy email customer', email: 'legacy@example.test', contacts: [{ name: 'Primary only', email: 'other-primary@example.test', roles: ['primary'] }], internalNotes: PRIVATE })
  const fallbackInvoice = await issue(fallback.id)
  const fallbackSent = await h.command('invoice.send', { id: fallbackInvoice.id })
  assert.deepEqual(fallbackSent.deliveries.map(d => d.recipient), ['legacy@example.test'])

  // Sending templates accept billing contacts even with no customer email.
  let recurring = await h.command('recurring.save', { customerId: customer.id, startDate: day, endDate: day, every: 1, unit: 'month', mode: 'send', termsDays: 30, lines: [{ description: 'Monthly design services', quantity: '1', rate: '2400.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  recurring = await h.command('recurring.approve', { id: recurring.id, revision: recurring.revision })
  await Promise.all([h.cron(), h.cron()])
  let sales = await h.view('sales')
  const generated = at(sales.invoices, i => i.recurring_id === recurring.id)
  const recurringMail = () => h.mail.filter(m => m.subject.startsWith(`Invoice ${generated.number} `))
  assert.deepEqual(recipients(recurringMail()), ['billing@example.test', 'controller@example.test'])
  assert.equal(at(sales.recurring, r => r.id === recurring.id).runs_list[0].status, 'sent')
  await h.cron()
  assert.equal(recurringMail().length, 2, 'overlapping and repeated runs do not resend an occurrence')

  await settings('-1')
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  const reminders = number => h.mail.filter(m => m.subject.startsWith(`Reminder: invoice ${number} `))
  assert.deepEqual(recipients(reminders(invoice.number)), ['billing@example.test', 'controller@example.test'])
  assert.deepEqual(recipients(reminders(fallbackInvoice.number)), ['legacy@example.test'])
  sales = await h.view('sales')
  assert.deepEqual(sales.deliveries.filter(d => d.invoice_id === invoice.id && d.kind === 'reminder').map(d => [d.recipient, d.step]).sort(), [['billing@example.test', -1], ['controller@example.test', -1]])

  // A newly reached step cannot cause a second reminder to the same recipient
  // today. A newly added cc still gets its own latest reminder.
  await settings('-1,0')
  await h.cron()
  assert.equal(reminders(invoice.number).length, 2)
  await update({ contacts: [...contacts, { name: 'New billing copy', email: 'new-cc@example.test', roles: ['cc'] }] })
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  assert.deepEqual(recipients(reminders(invoice.number)), ['billing@example.test', 'controller@example.test', 'new-cc@example.test'])
  sales = await h.view('sales')
  const deliveries = sales.deliveries.filter(d => d.invoice_id === invoice.id && d.kind === 'reminder')
  assert.equal(deliveries.length, 3)
  assert.equal(at(deliveries, d => d.recipient === 'new-cc@example.test').step, 0)
  assert.equal(reminders(fallbackInvoice.number).length, 1)
  assert.equal(h.mail.some(m => m.to.includes('primary@example.test') || m.to.includes('other-primary@example.test')), false)

  const pdf = await h.send(path + '/invoice.pdf')
  assert.equal(pdf.status, 200); assert.match(pdf.headers.get('content-type'), /application\/pdf/)
  assert.doesNotMatch(pdf.value, new RegExp(PRIVATE))
  assert.match(await page(), /Public invoice memo/)
  for (const mail of h.mail) {
    assert.doesNotMatch(JSON.stringify(mail), new RegExp(PRIVATE))
    for (const attachment of mail.attachments ?? []) assert.doesNotMatch(Buffer.from(attachment.content, 'base64').toString('latin1'), new RegExp(PRIVATE))
  }
  assert.doesNotMatch(stripeBodies.join('\n'), new RegExp(PRIVATE))
})
