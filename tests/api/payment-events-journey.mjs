// Imported by the parent PAY-002 test. Real auth, HTTP routes and D1; only Stripe
// and the mail transport are faked. This file deliberately registers no tests.
import assert from 'node:assert/strict'
import { createHmac, webcrypto } from 'node:crypto'
import { at, books, harness } from './harness.mjs'

export async function paymentEventsJourney(t, factory) {
  const clock = '2026-10-20T12:00:00Z', epoch = Date.parse(clock) / 1000
  const sessions = new Map(), charges = new Map(), events = new Map(), disputes = new Map(), refunds = new Map(), balances = new Map()
  const eventPages = [], eventReads = [], listedCursors = [], writes = []
  const list = (data, has_more = false) => Response.json({ object: 'list', data, has_more })
  const h = await (factory ?? harness)({ clock, outbound: async request => {
    const url = new URL(request.url), path = url.pathname.replace('/v1', '')
    assert.equal(url.hostname, 'api.stripe.com')
    if (request.method !== 'GET') writes.push(`${request.method} ${path}`)
    if (path === '/account') return Response.json({ id: 'acct_events', country: 'US', default_currency: 'usd', business_profile: { name: 'Juniper Lane Design LLC' } })
    if (path === '/checkout/sessions' && request.method === 'POST') {
      const form = new URLSearchParams(await request.text()), id = `cs_events_${sessions.size + 1}`
      sessions.set(id, { id, object: 'checkout.session', status: 'open', payment_intent: null, customer_details: { email: 'events-payer@example.test' }, amount: Number(form.get('line_items[0][price_data][unit_amount]')), method: form.get('payment_method_types[0]') ?? form.get('allowed_payment_method_types[0]') })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    if (path === '/checkout/sessions') return list([...sessions.values()].filter(s => s.payment_intent?.id === url.searchParams.get('payment_intent')))
    if (path.startsWith('/checkout/sessions/')) return Response.json(sessions.get(path.split('/').at(-1)))
    if (path.startsWith('/payment_intents/')) return Response.json([...sessions.values()].find(s => s.payment_intent?.id === path.split('/').at(-1))?.payment_intent)
    if (path.startsWith('/charges/')) return Response.json(charges.get(path.split('/').at(-1)))
    if (path.startsWith('/balance_transactions/')) return Response.json(balances.get(path.split('/').at(-1)))
    if (path.startsWith('/disputes/')) return Response.json(disputes.get(path.split('/').at(-1)))
    if (path === '/refunds') return list([...refunds.values()].filter(r => r.charge === url.searchParams.get('charge')))
    if (path.startsWith('/refunds/')) return Response.json(refunds.get(path.split('/').at(-1)))
    if (path.startsWith('/events/')) { const id = path.split('/').at(-1); eventReads.push(id); return Response.json(events.get(id)) }
    if (path === '/events') {
      const cursor = url.searchParams.get('starting_after'); listedCursors.push(cursor)
      const offset = cursor ? eventPages.findIndex(e => e.id === cursor) + 1 : 0
      return list(eventPages.slice(offset, offset + 1), offset + 1 < eventPages.length)
    }
    assert.fail(`Unexpected Stripe request ${request.method} ${path}`)
  } })
  t.after(() => h.close())
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Willow Design Studio', email: 'events-payer@example.test', termsDays: 30 })
  const discounts = await h.command('account.save', { code: '4951', name: 'Provider event early discounts', type: 'expense' })
  await h.command('discount-settings.save', { discountAccountId: discounts.id, earlyAccountId: discounts.id })
  await h.command('stripe.connect', { secretKey: 'synthetic-pantry-1011' })
  // A local HTTP origin cannot register a public endpoint. Install the sealed
  // test endpoint secret as fixture setup, then use the real signature door.
  const secret = 'synthetic-pantry-1012', subtle = webcrypto.subtle
  const material = await subtle.importKey('raw', new TextEncoder().encode('local-test-secret-not-production-0123456789'), 'HKDF', false, ['deriveKey'])
  const key = await subtle.deriveKey({ name: 'HKDF', hash: 'SHA-256', salt: new TextEncoder().encode('pantry-stripe'), info: new TextEncoder().encode('sealed provider keys') }, material, { name: 'AES-GCM', length: 256 }, false, ['encrypt'])
  const iv = webcrypto.getRandomValues(new Uint8Array(12)), encrypted = await subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(secret))
  await h.db.prepare('UPDATE pt_stripe SET webhook_secret_sealed=? WHERE id=1').bind(`${Buffer.from(iv).toString('base64')}.${Buffer.from(encrypted).toString('base64')}`).run()
  const event = (id, type, object) => {
    const value = { id, object: 'event', type, created: epoch, livemode: false, data: { object } }
    events.set(id, value); return value
  }
  const deliver = async (value, expected = 200) => {
    const raw = JSON.stringify(value), timestamp = epoch
    const signature = createHmac('sha256', secret).update(`${timestamp}.${raw}`).digest('hex')
    const response = await h.send('/api/pantry/stripe/webhook', undefined, { raw, headers: { 'stripe-signature': `t=${timestamp},v1=${signature}` } })
    assert.equal(response.status, expected, JSON.stringify(response.value)); return response
  }
  const checkout = async (method = 'card', early = false) => {
    const draft = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-10', dueDate: '2026-10-20', ...(early ? { earlyPayment: { percent: '2', days: '10' } } : {}), lines: [{ description: 'Studio design services', quantity: '1', rate: '100', accountId: acct['4000'], taxCode: 'exempt' }] })
    await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
    const invoice = await h.command('invoice.issue', { id: draft.id })
    await h.command('invoice.send', { id: invoice.id })
    const page = new URL(h.mail.at(-1).text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
    const response = await h.send(page + '/pay', undefined, { raw: `method=${method}`, headers: { 'content-type': 'application/x-www-form-urlencoded' } })
    assert.equal(response.status, 303)
    const session = [...sessions.values()].at(-1), suffix = sessions.size
    session.payment_intent = { id: `pi_events_${suffix}`, object: 'payment_intent', status: 'processing', amount_received: 0, currency: 'usd', latest_charge: null }
    session.status = 'complete'
    return { invoice, page, session, suffix }
  }
  const succeed = item => {
    const { session, suffix } = item, id = `ch_events_${suffix}`, bt = { id: `txn_events_${suffix}`, object: 'balance_transaction', currency: 'usd', amount: session.amount, fee: 0, net: session.amount, created: epoch }
    const method = session.method === 'us_bank_account' ? { type: 'us_bank_account', us_bank_account: { bank_name: 'Test Credit Union', last4: '6789' } } : { type: 'card', card: { brand: 'visa', last4: '4242' } }
    const charge = { id, object: 'charge', amount: session.amount, currency: 'usd', status: 'succeeded', payment_intent: session.payment_intent.id, payment_method_details: method, billing_details: { email: 'events-payer@example.test' }, balance_transaction: bt }
    charges.set(id, charge); balances.set(bt.id, bt)
    Object.assign(session.payment_intent, { status: 'succeeded', amount_received: session.amount, latest_charge: charge })
    return charge
  }
  const invoiceRow = async id => at((await h.view('sales')).invoices, i => i.id === id)
  const paymentRow = id => h.db.prepare('SELECT * FROM pt_stripe_payments WHERE id=?').bind(id).first()

  const card = await checkout(), cardCharge = succeed(card)
  const cardEvent = event('evt_events_card', 'checkout.session.completed', { id: card.session.id, object: 'checkout.session' })
  await h.send('/api/pantry/stripe/webhook', undefined, { raw: JSON.stringify(cardEvent), headers: { 'stripe-signature': `t=${epoch},v1=bad` } }).then(r => assert.equal(r.status, 400))
  assert.equal((await invoiceRow(card.invoice.id)).open_cents, 10000)
  await deliver(cardEvent)
  const cardState = await paymentRow(card.session.id), mailCount = h.mail.length
  assert.equal((await invoiceRow(card.invoice.id)).open_cents, 0)
  await deliver(cardEvent)
  assert.equal((await paymentRow(card.session.id)).payment_id, cardState.payment_id)
  assert.equal(h.mail.length, mailCount, 'a replay posts and emails nothing twice')
  assert.ok(eventReads.includes(cardEvent.id), 'signed webhook data is read back from Stripe')
  const receipt = h.mail.find(m => m.subject.startsWith('Payment receipt:') && m.text.includes(card.invoice.number))
  assert.match(receipt.text, /4242/)

  const ach = await checkout('us_bank_account', true)
  const sending=(await h.view('invoicing')).sending
  await h.command('sending.save',{revision:sending.revision,remindersOn:true,reminderDays:'0',timeZone:'America/New_York'})
  ach.session.status='open';ach.session.payment_intent.status='requires_payment_method'
  await h.cron(Date.parse(clock))
  const reminderCount=()=>h.mail.filter(m=>m.subject.startsWith('Reminder:')&&m.subject.includes(ach.invoice.number)).length
  assert.equal(reminderCount(),1)
  ach.session.status='complete';ach.session.payment_intent.status='processing'
  await deliver(event('evt_events_processing', 'checkout.session.completed', { id: ach.session.id, object: 'checkout.session' }))
  assert.equal((await paymentRow(ach.session.id)).status, 'processing')
  assert.equal((await invoiceRow(ach.invoice.id)).open_cents, 10000)
  assert.ok(h.mail.some(m => m.subject.startsWith('Payment received, processing:') && m.text.includes(ach.invoice.number)))
  const achCharge = succeed(ach)
  await deliver(event('evt_events_ach_success', 'checkout.session.async_payment_succeeded', { id: ach.session.id, object: 'checkout.session' }))
  assert.equal((await invoiceRow(ach.invoice.id)).open_cents, 0)
  assert.equal(ach.session.amount, 9800)
  const achBt = { id: 'txn_events_return', amount: -9800, net: -9800, fee: 0, currency: 'usd', created: epoch }
  balances.set(achBt.id, achBt)
  const achDispute = { id: 'dp_events_ach', object: 'dispute', charge: achCharge.id, amount: 9800, currency: 'usd', reason: 'insufficient_funds', network_reason_code: 'R01', status: 'lost', balance_transactions: [achBt], evidence_details: { due_by: null } }
  disputes.set(achDispute.id, achDispute)
  const returned = event('evt_events_return', 'charge.dispute.created', { id: achDispute.id, object: 'dispute' })
  await deliver(returned)
  const returnedRow = await paymentRow(ach.session.id)
  assert.equal(returnedRow.status, 'returned'); assert.equal(returnedRow.return_code, 'R01')
  assert.ok(returnedRow.return_entry_id)
  assert.equal((await invoiceRow(ach.invoice.id)).open_cents, 10000, 'return and early discount reversal reopen the full invoice together')
  const returnedMails = h.mail.filter(m => m.subject.startsWith('Payment returned:') && m.text.includes(ach.invoice.number))
  assert.equal(returnedMails.length, 2, 'payer and owner each receive one return notice')
  assert.ok(returnedMails.every(m => /discount reversed/i.test(m.text)))
  await deliver(returned); assert.equal(h.mail.filter(m => m.subject.startsWith('Payment returned:') && m.text.includes(ach.invoice.number)).length, 2)

  const refund = { id: 're_events_external', object: 'refund', charge: cardCharge.id, payment_intent: card.session.payment_intent.id, amount: 3000, currency: 'usd', status: 'succeeded', created: epoch, reason: 'requested_by_customer', metadata: {}, balance_transaction: 'txn_events_refund' }
  refunds.set(refund.id, refund); balances.set(refund.balance_transaction, { id: refund.balance_transaction, amount: -3000, net: -3000, fee: 0, currency: 'usd', created: epoch })
  const refundEvent = event('evt_events_refund', 'refund.created', { id: refund.id, object: 'refund' })
  await deliver(refundEvent); await deliver(refundEvent)
  assert.equal((await invoiceRow(card.invoice.id)).open_cents, 3000)
  assert.equal((await paymentRow(card.session.id)).refunded_cents, 3000)
  assert.equal((await h.db.prepare('SELECT COUNT(*) AS n FROM pt_customer_refunds WHERE provider_id=? AND status=\'succeeded\'').bind(refund.id).first()).n, 1)
  assert.ok(!writes.includes('POST /refunds'), 'reconciliation never issues an outbound refund')

  const discounted = await checkout('card', true), discountCharge = succeed(discounted)
  await deliver(event('evt_events_discounted_paid', 'checkout.session.completed', { id: discounted.session.id, object: 'checkout.session' }))
  const smallRefund = { ...refund, id: 're_events_discount', charge: discountCharge.id, payment_intent: discounted.session.payment_intent.id, amount: 100, balance_transaction: 'txn_events_discount_refund' }
  refunds.set(smallRefund.id, smallRefund); balances.set(smallRefund.balance_transaction, { id: smallRefund.balance_transaction, amount: -100, net: -100, fee: 0, currency: 'usd', created: epoch })
  await deliver(event('evt_events_discount_refund', 'refund.updated', { id: smallRefund.id, object: 'refund' }))
  assert.equal((await invoiceRow(discounted.invoice.id)).open_cents, 300, 'a one-dollar counted refund also reverses the two-dollar earned discount in the same write')

  const disputed = await checkout(), disputedCharge = succeed(disputed)
  await deliver(event('evt_events_disputed_success', 'checkout.session.completed', { id: disputed.session.id, object: 'checkout.session' }))
  const deadline = epoch + 7 * 86400, dispute = { id: 'dp_events_card', object: 'dispute', charge: disputedCharge.id, amount: 10000, currency: 'usd', status: 'needs_response', reason: 'fraudulent', evidence_details: { due_by: deadline }, balance_transactions: [] }
  disputes.set(dispute.id, dispute)
  await deliver(event('evt_events_dispute', 'charge.dispute.created', { id: dispute.id, object: 'dispute' }))
  const disputeRow = await paymentRow(disputed.session.id)
  assert.deepEqual([disputeRow.status, disputeRow.disputed_cents, disputeRow.evidence_due_by], ['disputed', 10000, deadline])

  const dropped = await checkout(); succeed(dropped)
  const droppedEvent = event('evt_events_dropped', 'checkout.session.completed', { id: dropped.session.id, object: 'checkout.session' })
  assert.equal((await invoiceRow(dropped.invoice.id)).open_cents, 10000)
  eventPages.push(droppedEvent, cardEvent)
  const beforeComparisonMail = h.mail.length
  await h.command('stripe.events-compare', { force: true })
  const comparison = await h.view('stripe/events')
  assert.equal((await invoiceRow(dropped.invoice.id)).open_cents, 0)
  assert.ok(comparison.runs[0].missing_found >= 1)
  assert.ok(comparison.missing.some(m => m.event_id === droppedEvent.id))
  assert.ok(listedCursors.includes(droppedEvent.id), 'daily comparison reads subsequent event pages')
  await h.command('stripe.events-compare', { force: true })
  assert.equal(h.mail.length, beforeComparisonMail + 1, 'comparison and repeated comparison send only the dropped receipt')
  const ar=(await h.send('/api/pantry/reports/receivables?to=2026-10-20', undefined, { cookie: h.owner })).value
  assert.equal(ar.agrees,true,JSON.stringify(ar))
  const cash=await h.view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=cash')
  assert.equal(cash.netIncome,36700,'returns and partial refunds reverse their settled cash shares exactly once')
  await h.cron(Date.parse('2026-10-21T12:00:00Z'))
  assert.equal(reminderCount(),2,'a returned ACH payment starts a fresh reminder cycle while preserving prior history')
  const history=(await h.view('sales')).deliveries.filter(d=>d.invoice_id===ach.invoice.id&&d.kind==='reminder')
  assert.equal(history.length,2)
  return { h, customer, card, ach, disputed, dropped }
}
