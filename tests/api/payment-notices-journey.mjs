// Imported by the PAY-002 public-door journey. Only Stripe and mail HTTP are faked.
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

export async function paymentNoticesJourney(t) {
  const sessions = new Map()
  const h = await harness({ clock: '2026-10-20T12:00:00Z', outbound: async request => {
    const url = new URL(request.url)
    assert.equal(url.hostname, 'api.stripe.com')
    if (url.pathname === '/v1/account') return Response.json({ id: 'acct_notices', country: 'US', default_currency: 'usd', business_profile: { name: 'Juniper Lane Design LLC' } })
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const form = new URLSearchParams(await request.text()), id = `cs_notices_${sessions.size + 1}`
      sessions.set(id, { id, object: 'checkout.session', status: 'open', customer_details: { email: 'payer@example.test' }, payment_intent: null, form })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    const session = sessions.get(url.pathname.split('/').at(-1))
    if (request.method === 'GET' && session) { const { form, ...body } = session; return Response.json(body) }
    assert.fail(`Unexpected Stripe request: ${request.method} ${url.pathname}`)
  } })
  t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Receipt checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Payment notices customer', email: 'payer@example.test', termsDays: 30 })
  const issue = async () => {
    const draft = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-20', dueDate: '2026-11-19', lines: [{ description: 'Design services', quantity: '1', rate: '100.00', accountId: acct['4000'], taxCode: 'exempt' }] })
    const approved = await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
    return h.command('invoice.issue', { id: approved.id })
  }
  const manualInvoice = await issue()
  const payment = await h.command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-10-20', amount: '40.00', bankAccountId: bank.id, allocations: [{ targetId: manualInvoice.id, amount: '40.00' }] })
  const receipt = await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id })
  assert.equal(receipt.deliveries[0].status, 'accepted')
  const first = h.mail.at(-1)
  assert.deepEqual(first.to, ['payer@example.test'])
  for (const fact of ['Juniper Lane Design LLC', manualInvoice.number, '$40.00', '$60.00', '2026-10-20']) assert.ok(first.text.includes(fact), `receipt includes ${fact}`)
  const beforeReplay = h.mail.length
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id })
  assert.equal(h.mail.length, beforeReplay, 'repeating the manual action never resends a claimed receipt')
  const otherInvoice = await issue()
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: otherInvoice.id }, h.owner, 409)
  const viewer = await h.member('notice-viewer@example.test', 'viewer')
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id }, viewer, 403)
  const sales = await h.member('notice-sales@example.test', 'sales')
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id }, sales, 403)
  const scoped = await h.member('notice-limited@example.test', 'bookkeeper', { bankAccess: 'selected', bankAccounts: [] })
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id }, scoped, 403)
  await h.command('payment.receipts-preference', { enabled: false, customerId: customer.id })
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id }, h.owner, 409)
  await h.command('payment.receipts-preference', { enabled: true, customerId: customer.id })
  await h.command('payment.receipts-preference', { enabled: false })
  await h.command('payment.receipt', { paymentId: payment.id, invoiceId: manualInvoice.id }, h.owner, 409)
  await h.command('payment.receipts-preference', { enabled: true })
  await h.command('payment.receipts-preference', { enabled: false }, viewer, 403)

  // Online payer communication flows through the same public customer return.
  await h.command('stripe.connect', { secretKey: 'synthetic-notices-key' })
  const onlineInvoice = await issue()
  await h.command('invoice.send', { id: onlineInvoice.id })
  const page = new URL(h.mail.at(-1).text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
  await h.send(page + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  const session = sessions.get('cs_notices_1')
  Object.assign(session, { status: 'complete', payment_intent: { id: 'pi_notices_card', status: 'succeeded', amount_received: 10000, latest_charge: { id: 'ch_notices_card', billing_details: { email: 'payer@example.test' }, payment_method_details: { type: 'card', card: { brand: 'visa', last4: '4242' } }, balance_transaction: { id: 'bt_notices_card', created: 1792497600, amount: 10000, fee: 320, net: 9680, currency: 'usd' } } } })
  const received = () => h.mail.filter(m => m.subject.startsWith('Payment receipt:') && m.text.includes(onlineInvoice.number))
  await h.send(page + '?checkout=cs_notices_1')
  assert.equal(received().length, 1)
  assert.match(received()[0].text, /visa/i)
  assert.match(received()[0].text, /4242/)
  assert.match(received()[0].text, /Remaining balance: \$0\.00/)
  await h.send(page + '?checkout=cs_notices_1'); await h.cron()
  assert.equal(received().length, 1, 'provider confirmation and scheduled rereads send one receipt')
  await h.command('payment.receipts-preference', { enabled: false, customerId: customer.id })
  const optedOut = await issue()
  await h.command('invoice.send', { id: optedOut.id })
  const optedPage = new URL(h.mail.at(-1).text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
  await h.send(optedPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  Object.assign(sessions.get('cs_notices_2'), { status: 'complete', payment_intent: { ...session.payment_intent, id: 'pi_notices_optout', latest_charge: { ...session.payment_intent.latest_charge, id: 'ch_notices_optout', balance_transaction: { ...session.payment_intent.latest_charge.balance_transaction, id: 'bt_notices_optout' } } } })
  await h.send(optedPage + '?checkout=cs_notices_2')
  assert.equal(h.mail.filter(m => m.subject.startsWith('Payment receipt:') && m.text.includes(optedOut.number)).length, 0)
  assert.equal(at((await h.view('sales')).invoices, i => i.id === optedOut.id).open_cents, 0, 'receipt opt-out does not prevent settlement')
  return { h, customer, bank, payment, manualInvoice, onlineInvoice }
}
