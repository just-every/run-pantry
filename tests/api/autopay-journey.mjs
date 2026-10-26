import { memberAt } from './member-at.mjs'
import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

export function autopayProvider() {
  const sessions = new Map(), intents = new Map(), mandates = new Map(), customers = new Map(), writes = []
  let serial = 0, outcome = 'succeeded', uncertain = false, providerDate = '2026-10-21'
  const id = () => `synthetic-pantry-${++serial}`
  const completeSetup = sessionId => {
    const s = sessions.get(sessionId)
    assert.ok(s)
    const pm = { id: id(), type: s.method, customer: s.customer, [s.method]: { last4: '6789' } }
    const mandate = s.method === 'us_bank_account' ? { id: id(), status: 'active', customer_acceptance: { type: 'online', accepted_at: 1792497600, online: { ip_address: '192.0.2.10', user_agent: 'Pantry provider edge' } } } : null
    if (mandate) mandates.set(mandate.id, mandate)
    s.setup_intent = { id: id(), status: 'succeeded', customer: s.customer, payment_method: pm, mandate, metadata: { pantry_autopay_setup: s.client_reference_id } }
    s.status = 'complete'
    return s
  }
  return { sessions, intents, mandates, writes, completeSetup, at: date => { providerDate = date }, outcome: value => { outcome = value }, uncertain: () => { uncertain = true },
    async outbound(request) {
      const url = new URL(request.url), path = url.pathname.replace('/v1', '')
      assert.equal(url.hostname, 'api.stripe.com')
      if (request.method === 'POST') writes.push(path)
      if (path === '/account') return Response.json({ id: 'synthetic-pantry-0', country: 'US', default_currency: 'usd' })
      if (path === '/customers' && request.method === 'POST') { const row = { id: id() }; customers.set(row.id, row); return Response.json(row) }
      if (path === '/checkout/sessions' && request.method === 'POST') {
        const b = new URLSearchParams(await request.text())
        assert.equal(b.get('mode'), 'setup'); assert.equal(b.get('setup_intent_data[usage]'), 'off_session')
        const row = { id: id(), mode: 'setup', status: 'open', livemode: false, customer: b.get('customer'), client_reference_id: b.get('client_reference_id'), method: b.get('allowed_payment_method_types[0]') }
        sessions.set(row.id, row); return Response.json({ ...row, url: `https://checkout.stripe.com/c/pay/${row.id}` })
      }
      if (path.startsWith('/checkout/sessions/')) return Response.json(sessions.get(path.split('/').at(-1)))
      if (path.startsWith('/mandates/')) return Response.json(mandates.get(path.split('/').at(-1)))
      if (path === '/payment_intents' && request.method === 'POST') {
        if (uncertain) { uncertain = false; throw new Error('Synthetic network disconnect after submission') }
        const b = new URLSearchParams(await request.text())
        assert.equal(b.get('confirm'), 'true'); assert.equal(b.get('off_session'), 'true'); assert.ok(request.headers.get('idempotency-key'))
        const amount = Number(b.get('amount')), method = b.get('allowed_payment_method_types[0]'), pi = { id: id(), status: outcome, customer: b.get('customer'), amount, amount_received: outcome === 'succeeded' ? amount : 0, currency: 'usd', livemode: false,
          metadata: { pantry_autopay_attempt: b.get('metadata[pantry_autopay_attempt]'), pantry_invoice: b.get('metadata[pantry_invoice]') },
          latest_charge: { id: id(), status: outcome === 'succeeded' ? 'succeeded' : 'failed', payment_method_details: { type: method, [method]: method === 'card' ? { brand: 'visa', last4: '6789' } : { bank_name: 'Synthetic credit union', last4: '6789' } }, balance_transaction: { id: id(), amount, currency: 'usd', fee: 0, net: amount, created: Date.parse(providerDate + 'T16:00:00Z') / 1000 } },
          ...(outcome === 'requires_payment_method' ? { last_payment_error: { code: 'card_declined' } } : {}) }
        intents.set(pi.id, pi)
        return outcome === 'requires_payment_method' ? Response.json({ error: { payment_intent: pi } }, { status: 402 }) : Response.json(pi)
      }
      if (path.startsWith('/payment_intents/')) return Response.json(intents.get(path.split('/').at(-1)))
      if (['/events', '/balance_transactions', '/payouts', '/checkout/sessions'].includes(path)) return Response.json({ data: [], has_more: false })
      if (path === '/balance') return Response.json({ available: [{ currency: 'usd', amount: 0 }], pending: [] })
      assert.fail(`Unexpected Stripe request ${request.method} ${path}`)
    } }
}

export async function autopayJourney(t, factory = harness) {
  const provider = autopayProvider(), clock = '2026-10-20T16:00:00Z'
  const h = await factory({ clock, outbound: provider.outbound })
  t.after(() => h.close())
  const { acct } = await books(h)
  await h.command('stripe.connect', { secretKey: 'synthetic-pantry-101' })
  const discount = await h.command('account.save', { code: '4952', name: 'Autopay early discounts', type: 'expense' })
  await h.command('discount-settings.save', { discountAccountId: discount.id, earlyAccountId: discount.id })
  const accountant = await memberAt(h,clock,'autopay-accountant@example.test', 'accountant', { canPost: true })
  const scene = async (name, { early = false, termsDays = 1 } = {}) => {
    const customer = await h.command('contact.save', { kind: 'customer', name, email: `${name.toLowerCase().replace(/\s+/g, '-')}@example.test`, billingAddress: '12 Cedar Street, New York, NY 10001', termsDays })
    let recurring = await h.command('recurring.save', { customerId: customer.id, startDate: '2026-10-20', every: 1, unit: 'month', termsDays, mode: 'send', ...(early ? { earlyPayment: { percent: '2', days: Math.min(10,termsDays) } } : {}), lines: [{ description: 'Monthly design retainer', quantity: '1', rate: '100', accountId: acct['4000'], taxCode: 'exempt' }] })
    recurring = await h.command('recurring.approve', { id: recurring.id, revision: recurring.revision })
    await h.cron(Date.parse(clock))
    const invoice = (await h.view('sales')).invoices.find(i => i.recurring_id === recurring.id)
    assert.ok(invoice?.link_token)
    const page = `/i/${invoice.link_token}`, policyBody = { customerId: customer.id, recurringId: recurring.id, enabled: true, purpose: 'Monthly design retainer at the customer billing address', consent: true }
    return { h, customer, recurring, invoice, page, policyBody }
  }
  const approve = async s => {
    s.policy = (await h.command('autopay.policy', s.policyBody)).policy
    return s
  }
  const setup = async (s, method = 'us_bank_account') => {
    const response = await h.send(s.page + '/autopay/setup', { method, policyRevision: s.policy.revision, accepted: true }, { headers: { 'cf-connecting-ip': '192.0.2.10' } })
    assert.equal(response.status, 200, JSON.stringify(response.value))
    provider.completeSetup(response.value.sessionId)
    const confirmed = await h.send(s.page + '/autopay/confirm', { sessionId: response.value.sessionId })
    assert.equal(confirmed.status, 200, JSON.stringify(confirmed.value)); assert.equal(confirmed.value.saved.active, true)
    return response.value
  }
  const due = date => { provider.at(date); return h.cron(Date.parse(date + 'T16:00:00Z')) }
  const state = s => h.view(`autopay/${s.customer.id}`)
  const ach = await scene('Autopay ACH customer')
  assert.equal((await h.send(ach.page + '/autopay/setup', { method: 'card', accepted: true })).status, 409, 'standing charges start off')
  await h.command('autopay.policy', ach.policyBody, accountant, 403)
  await approve(ach)
  assert.equal((await h.send(ach.page+'/autopay/setup',{method:'card',accepted:true,policyRevision:ach.policy.revision},{headers:{origin:'https://untrusted.example'}})).status,403)
  assert.equal((await h.send(ach.page + '/autopay/setup', { method: 'us_bank_account', policyRevision: ach.policy.revision, accepted: true }, { headers: { 'x-synthetic-pantry-peer': 'absent', 'x-forwarded-for': '192.0.2.10' } })).status, 409, 'untrusted forwarding cannot become mandate evidence')
  ach.customer = await h.command('contact.save', { ...ach.customer, kind: 'customer', payMethods: ['card'] })
  assert.equal((await h.send(ach.page + '/autopay/setup', { method: 'us_bank_account', policyRevision: ach.policy.revision, accepted: true })).status, 409, 'customer offerings constrain saved methods at the API')
  assert.doesNotMatch((await h.send(ach.page)).value, /<option value="us_bank_account"/,'hosted saved-method controls hide unoffered ACH')
  assert.deepEqual((await h.send(ach.page+'/autopay')).value.methods,['card'])
  ach.customer = await h.command('contact.save', { ...ach.customer, kind: 'customer', payMethods: null })
  await setup(ach)
  const authorized = await state(ach)
  assert.equal(authorized.saved.acceptedIP, '192.0.2.10'); assert.ok(authorized.saved.acceptedAt); assert.match(authorized.saved.mandateText, /electronic debits/)
  assert.equal(authorized.attempts.length, 0, 'saving a method does not submit a charge')
  const cash = await h.view('cash-planner?asOf=2026-10-20'), forecast = cash.weeks.flatMap(w => w.items).find(i => i.id === ach.invoice.id)
  assert.equal(forecast.date, ach.invoice.due_date, 'an authorized autopay invoice projects cash on its due date')
  assert.match(forecast.reason, /Autopay/)
  provider.outcome('processing')
  await Promise.all([due('2026-10-21'), due('2026-10-21')])
  assert.equal((await state(ach)).attempts.length, 1, 'overlapping triggers submit only once')
  assert.equal((await state(ach)).attempts[0].status, 'processing')
  const claim=(await h.view(`activity?record=${ach.invoice.id}`)).audit.find(e=>e.action==='autopay.claim')
  assert.equal(claim.origin_kind,'schedule');assert.equal(claim.authority_kind,'autopay')
  assert.equal(claim.authority_id,ach.customer.id);assert.equal(claim.authority_revision,ach.policy.revision)
  assert.equal(claim.approval?.actor_email,'owner@example.test')
  assert.equal((await h.view('sales')).invoices.find(i => i.id === ach.invoice.id).open_cents, 10000, 'processing ACH is not paid')
  const pending = [...provider.intents.values()][0]
  pending.status = 'succeeded'; pending.amount_received = pending.amount; pending.latest_charge.status = 'succeeded'
  await due('2026-10-21')
  assert.equal((await h.view('sales')).invoices.find(i => i.id === ach.invoice.id).open_cents, 0)
  assert.equal((await h.view('reports/receivables?to=2026-10-31')).agrees, true)

  const card = await approve(await scene('Autopay declined card'))
  await setup(card, 'card'); provider.outcome('requires_payment_method')
  for (const date of ['2026-10-21', '2026-10-22', '2026-10-24', '2026-10-28']) await due(date)
  const failed = await state(card)
  assert.equal(failed.attempts.length, 4); assert.ok(failed.attempts.every(a => a.status === 'failed'))
  assert.equal(failed.notices.length, 4); assert.ok(failed.notices.every(n => n.status === 'accepted'))
  const sends = h.mail.filter(m => m.subject.startsWith('Automatic payment failed:') && m.to.includes(card.customer.email)).length
  await due('2026-10-29')
  assert.equal((await state(card)).attempts.length, 4)
  assert.equal(h.mail.filter(m => m.subject.startsWith('Automatic payment failed:') && m.to.includes(card.customer.email)).length, sends)
  await h.send(card.page + '/autopay/revoke', {})
  assert.equal((await state(card)).saved.active, false)

  const customerRevoked = await approve(await scene('Autopay customer revoked'))
  await setup(customerRevoked, 'card'); await due('2026-10-21')
  assert.equal((await state(customerRevoked)).attempts.length, 1)
  assert.equal((await h.send(customerRevoked.page + '/autopay/revoke', {})).status, 200)
  await due('2026-10-22'); await due('2026-10-28')
  assert.equal((await state(customerRevoked)).attempts.length, 1, 'customer revocation cancels remaining scheduled retries')

  const revoked = await approve(await scene('Autopay owner revoked'))
  await setup(revoked, 'card'); await h.command('autopay.revoke', { customerId: revoked.customer.id }); await due('2026-10-21')
  assert.equal((await state(revoked)).attempts.length, 0)

  const removed = await approve(await scene('Autopay removed offering'))
  await setup(removed)
  await h.command('contact.save', { ...(await h.view(`customers/${removed.customer.id}`)).customer, kind: 'customer', payMethods: ['card'] })
  await due('2026-10-21')
  assert.equal((await state(removed)).attempts.length, 0, 'removing ACH prevents automatic charges using an already-saved ACH method')

  const uncertainScene = await approve(await scene('Autopay unknown outcome'))
  await setup(uncertainScene, 'card'); provider.uncertain(); await due('2026-10-21'); await due('2026-10-22')
  assert.equal((await state(uncertainScene)).attempts.length, 1)
  assert.equal((await state(uncertainScene)).attempts[0].status, 'uncertain', 'an uncertain submission is retained without automatic replay')
  await h.command('autopay.revoke', { customerId: uncertainScene.customer.id })

  const changed = await approve(await scene('Autopay changed recipient'))
  await setup(changed, 'card'); await h.command('contact.save', { ...(await h.view(`customers/${changed.customer.id}`)).customer, kind: 'customer', email: 'changed-autopay@example.test' }); await due('2026-10-21')
  assert.equal((await state(changed)).attempts.length, 0, 'changed recipient requires purpose-bound consent again')
  const inside = await approve(await scene('Autopay early window', { early: true }))
  await setup(inside, 'card'); provider.outcome('succeeded'); await due('2026-10-21')
  assert.equal((await state(inside)).attempts[0].amount_cents, 9800, 'due-date autopay takes the approved discount within its window')
  assert.equal((await h.view('sales')).invoices.find(i => i.id === inside.invoice.id).open_cents, 0)
  const outside = await approve(await scene('Autopay ended window', { early: true, termsDays: 12 }))
  await setup(outside, 'card'); await due('2026-11-01')
  assert.equal((await state(outside)).attempts[0].amount_cents, 10000, 'autopay charges the full balance after the discount window')
  assert.equal((await h.view('sales')).invoices.filter(i => i.credit_for === outside.invoice.id && i.early_discount).length, 0)
  const quiet = await approve(await scene('Autopay quiet notice'))
  await setup(quiet, 'card'); provider.outcome('requires_payment_method'); provider.at('2026-10-21'); await h.cron(Date.parse('2026-10-21T23:00:00Z'))
  assert.equal((await state(quiet)).attempts[0].status, 'failed', 'charges remain on their due date during quiet hours')
  assert.equal((await state(quiet)).notices[0].status, 'queued', 'automatic failure mail waits through the quiet period')
  await h.cron(Date.parse('2026-10-22T12:00:00Z'))
  assert.ok((await state(quiet)).notices.every(n => n.status === 'accepted'))
  await h.command('autopay.revoke', { customerId: quiet.customer.id })
  const browserScene = await scene('Autopay browser customer')
  return { ...browserScene, provider, accountant, approve: () => approve(browserScene), setup: method => setup(browserScene, method), due, state: () => state(browserScene) }
}
