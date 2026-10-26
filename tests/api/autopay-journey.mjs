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
    s.setup_intent = { id: id(), status: 'succeeded', usage:'off_session', customer: s.customer, payment_method: pm, mandate, metadata: { pantry_autopay_setup: s.client_reference_id } }
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
        assert.equal(b.get('mode'), 'setup')
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
  const sending=(await h.view('invoicing')).sending
  await h.command('sending.save',{revision:sending.revision,remindersOn:true,reminderDays:'0,1,3,7,8',timeZone:'America/New_York'})
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
    const page = `/i/${invoice.link_token}`, policyBody = { customerId: customer.id, recurringId: recurring.id, enabled: true, purpose: 'Monthly design retainer at the customer billing address', consent: true, noticeRecipients: [{recipient:customer.email,timeZone:'America/New_York'}] }
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
  await h.command('autopay.policy', { ...ach.policyBody, noticeRecipients: undefined }, h.owner, 400)
  await h.command('autopay.policy', { ...ach.policyBody, noticeRecipients: [{recipient:ach.customer.email,timeZone:'synthetic-pantry-201'}] }, h.owner, 400)
  await approve(ach)
  assert.equal((await h.send(ach.page+'/autopay/setup',{method:'card',accepted:true,policyRevision:ach.policy.revision},{headers:{origin:'https://untrusted.example'}})).status,403)
  assert.equal((await h.send(ach.page + '/autopay/setup', { method: 'us_bank_account', policyRevision: ach.policy.revision, accepted: true }, { headers: { 'x-synthetic-pantry-peer': 'absent', 'x-forwarded-for': '192.0.2.10' } })).status, 409, 'untrusted forwarding cannot become mandate evidence')
  ach.customer = await h.command('contact.save', { ...ach.customer, kind: 'customer', payMethods: ['card'] })
  assert.equal((await h.send(ach.page + '/autopay/setup', { method: 'us_bank_account', policyRevision: ach.policy.revision, accepted: true })).status, 409, 'customer offerings constrain saved methods at the API')
  assert.doesNotMatch((await h.send(ach.page)).value, /<option value="us_bank_account"/,'hosted saved-method controls hide unoffered ACH')
  assert.deepEqual((await h.send(ach.page+'/autopay')).value.methods,['card'])
  ach.customer = await h.command('contact.save', { ...ach.customer, kind: 'customer', payMethods: null })
  const historyBank=await h.command('bank-account.save',{name:'Retainer operating checking',institution:'Local credit union',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0'})
  for(const [issue,paid] of [['2026-10-01','2026-10-10'],['2026-10-02','2026-10-11'],['2026-10-03','2026-10-12']]){
    let historical=await h.command('invoice.save-draft',{customerId:ach.customer.id,issueDate:issue,dueDate:issue,lines:[{description:'Earlier design work',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
    historical=await h.command('invoice.approve',{id:historical.id,revision:historical.revision})
    historical=await h.command('invoice.issue',{id:historical.id})
    await h.command('payment.record',{direction:'received',contactId:ach.customer.id,date:paid,amount:'100',bankAccountId:historyBank.id,reference:'Earlier design payment',allocations:[{targetId:historical.id,amount:'100'}]})
  }
  assert.equal((await h.view('cash-planner?asOf=2026-10-20')).weeks.flatMap(w=>w.items).find(i=>i.id===ach.invoice.id).date,'2026-10-29','without saved authorization the customer’s nine-day median predicts payment')
  await setup(ach)
  const publicSaved=(await h.send(ach.page+'/autopay')).value.saved
  assert.equal(publicSaved.last4,undefined);assert.equal(publicSaved.acceptedIP,undefined);assert.equal(publicSaved.mandateText,undefined)
  const authorized = await state(ach)
  assert.equal(authorized.saved.acceptedIP, '192.0.2.10'); assert.ok(authorized.saved.acceptedAt); assert.match(authorized.saved.mandateText, /electronic debits/)
  assert.equal(authorized.attempts.length, 0, 'saving a method does not submit a charge')
  const cash = await h.view('cash-planner?asOf=2026-10-20'), forecast = cash.weeks.flatMap(w => w.items).find(i => i.id === ach.invoice.id)
  assert.equal(forecast.date, ach.invoice.due_date, 'an authorized autopay invoice projects cash on its due date')
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
  for (const date of ['2026-10-21', '2026-10-22', '2026-10-24', '2026-10-28']) {
    await due(date)
    if(date<'2026-10-28')assert.equal((await h.view('sales')).deliveries.filter(d=>d.invoice_id===card.invoice.id&&d.kind==='reminder').length,0,'ordinary reminders wait until scheduled retries are exhausted')
  }
  const failed = await state(card)
  assert.deepEqual([...failed.attempts].sort((a,b)=>a.sequence-b.sequence).map(a=>a.scheduled_on),['2026-10-21','2026-10-22','2026-10-24','2026-10-28'])
  assert.ok((await h.view('sales')).deliveries.some(d=>d.invoice_id===card.invoice.id&&d.kind==='reminder'&&d.status==='accepted'),'exhausted retries hand the balance to ordinary reminders')
  assert.equal(failed.attempts.length, 4); assert.ok(failed.attempts.every(a => a.status === 'failed'))
  assert.equal(failed.notices.length, 4); assert.ok(failed.notices.every(n => n.status === 'accepted'))
  const customerMail=(await h.view(`customers/${card.customer.id}`)).deliveries.filter(d=>d.kind==='autopay-failed')
  assert.equal(customerMail.length,4);assert.ok(customerMail.every(d=>d.status==='accepted'))
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

  const zoned = await scene('synthetic-pantry-202')
  zoned.customer = await h.command('contact.save', { ...zoned.customer, kind:'customer', contacts:[
    {email:zoned.customer.email,roles:['billing']}, {email:'synthetic-pantry-203@example.test',roles:['cc']}
  ] })
  zoned.policyBody.noticeRecipients = [{recipient:zoned.customer.email,timeZone:'America/Los_Angeles'}, {recipient:'synthetic-pantry-203@example.test',timeZone:'America/New_York'}]
  await h.command('autopay.policy', { ...zoned.policyBody, noticeRecipients:[zoned.policyBody.noticeRecipients[0]] }, h.owner, 400)
  await approve(zoned); await setup(zoned,'card'); provider.outcome('requires_payment_method'); provider.at('2026-10-21')
  await h.cron(Date.parse('2026-10-21T12:00:00Z'))
  let zonedState = await state(zoned)
  assert.equal(zonedState.notices.find(n=>n.recipient===zoned.customer.email).status,'queued','a west coast recipient waits while the business is open')
  assert.equal(zonedState.notices.find(n=>n.recipient==='synthetic-pantry-203@example.test').status,'accepted','a recipient whose local morning has started receives a separate email')
  await Promise.all([h.cron(Date.parse('2026-10-21T15:00:00Z')),h.cron(Date.parse('2026-10-21T15:00:00Z'))])
  zonedState = await state(zoned)
  assert.ok(zonedState.notices.every(n=>n.status==='accepted'))
  assert.equal(h.mail.filter(m=>m.subject.startsWith('Automatic payment failed:')&&m.to.includes(zoned.customer.email)).length,1)
  await h.command('autopay.revoke',{customerId:zoned.customer.id})

  const blocked = await scene('synthetic-pantry-204')
  blocked.customer = await h.command('contact.save', { ...blocked.customer, kind:'customer', contacts:[
    {email:blocked.customer.email,roles:['billing']}, {email:'synthetic-pantry-205@example.test',roles:['cc']}
  ] })
  blocked.policyBody.noticeRecipients = [blocked.customer.email,'synthetic-pantry-205@example.test'].map(recipient=>({recipient,timeZone:'America/New_York'}))
  await approve(blocked)
  const mailControl = async (recipient, changes, cookie=h.owner, status=200) => {
    const current=(await state(blocked)).noticeRecipients.find(r=>r.recipient===recipient)
    return h.command('autopay.policy',{customerId:blocked.customer.id,mailControl:{recipient,revision:current.revision,...changes}},cookie,status)
  }
  const observed = {suppression:'bounced',reason:'synthetic-pantry-206 observed permanent rejection'}
  await mailControl(blocked.customer.email,observed,accountant,403)
  await mailControl(blocked.customer.email,observed)
  const stale=(await state(blocked)).noticeRecipients.find(r=>r.recipient===blocked.customer.email)
  await mailControl(blocked.customer.email,{timeZone:'America/Chicago'})
  await h.command('autopay.policy',{customerId:blocked.customer.id,mailControl:{recipient:blocked.customer.email,revision:stale.revision,timeZone:'America/New_York'}},h.owner,409)
  await mailControl('synthetic-pantry-205@example.test',{suppression:'complained',reason:'synthetic-pantry-207 recipient reported unwanted email'})
  await approve(blocked)
  assert.ok((await state(blocked)).noticeRecipients.every(r=>r.suppression&&r.suppressionSource==='owner_recorded'),'approving a charge policy preserves owner-recorded email stops')
  await setup(blocked,'card'); await due('2026-10-21'); await due('2026-10-21')
  let blockedState=await state(blocked)
  assert.equal(blockedState.attempts[0].status,'failed','email suppression does not authorize or prevent a scheduled charge')
  assert.equal(blockedState.notices.length,2); assert.ok(blockedState.notices.every(n=>n.status==='suppressed'))
  assert.equal(h.mail.filter(m=>m.subject.startsWith('Automatic payment failed:')&&m.to.some(r=>[blocked.customer.email,'synthetic-pantry-205@example.test'].includes(r))).length,0)
  await mailControl(blocked.customer.email,{suppression:null,reason:'synthetic-pantry-208 mailbox repaired'},h.owner,409)
  await mailControl(blocked.customer.email,{suppression:null,confirmReset:true,reason:'synthetic-pantry-208 mailbox repaired'})
  await due('2026-10-22')
  blockedState=await state(blocked)
  assert.equal(blockedState.notices.filter(n=>n.recipient===blocked.customer.email&&n.status==='accepted').length,1,'an explicit reset permits only future retry notices')
  assert.equal(blockedState.notices.filter(n=>n.recipient==='synthetic-pantry-205@example.test'&&n.status==='suppressed').length,2)
  await due('2026-10-24'); await due('2026-10-28')
  const handoff=(await h.view('sales')).deliveries.filter(d=>d.invoice_id===blocked.invoice.id&&d.kind==='reminder')
  assert.ok(handoff.some(d=>d.recipient==='synthetic-pantry-205@example.test'&&d.status==='suppressed'),'ordinary reminders inherit the complaint stop after retries are exhausted')
  assert.ok(handoff.some(d=>d.recipient===blocked.customer.email&&d.status==='accepted'))
  await h.command('autopay.revoke',{customerId:blocked.customer.id})

  const missing = await approve(await scene('synthetic-pantry-209'))
  await setup(missing,'card')
  await h.db.prepare('DELETE FROM pt_autopay_mail_controls WHERE customer_id=?').bind(missing.customer.id).run()
  await due('2026-10-21')
  assert.equal((await state(missing)).attempts[0].status,'failed','a migrated policy without recipient settings retains its separate charge authority')
  assert.equal((await state(missing)).notices[0].status,'queued','no recipient time zone is guessed for an existing policy')
  await h.command('autopay.policy',{customerId:missing.customer.id,mailControl:{recipient:missing.customer.email,revision:null,timeZone:'America/New_York'}})
  await due('2026-10-21')
  assert.equal((await state(missing)).notices[0].status,'accepted')
  await h.command('autopay.revoke',{customerId:missing.customer.id})

  const authority = await approve(await scene('synthetic-pantry-210'))
  await setup(authority,'card'); provider.at('2026-10-21'); await h.cron(Date.parse('2026-10-21T23:00:00Z'))
  assert.equal((await state(authority)).notices[0].status,'queued')
  await h.db.prepare("UPDATE oa_operators SET status='inactive' WHERE email='owner@example.test'").run()
  try { await h.cron(Date.parse('2026-10-22T12:00:00Z')) }
  finally { await h.db.prepare("UPDATE oa_operators SET status='active' WHERE email='owner@example.test'").run() }
  assert.equal((await state(authority)).notices[0].status,'cancelled','a queued notice stops when the approving owner loses current authority')
  assert.equal(h.mail.filter(m=>m.subject.startsWith('Automatic payment failed:')&&m.to.includes(authority.customer.email)).length,0)
  await h.command('autopay.revoke',{customerId:authority.customer.id})

  await h.command('recurring.status',{id:blocked.recurring.id,status:'ended'})
  const eraseInvoice=(await h.view('sales')).invoices.find(i=>i.id===blocked.invoice.id)
  await h.command('invoice.void',{id:eraseInvoice.id,revision:eraseInvoice.revision,date:'2026-10-20',reason:'synthetic-pantry-215 cancelled service'})
  for (const subject of [blocked.customer,await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-211',email:'synthetic-pantry-211@example.test'})]) {
    if(subject.id!==blocked.customer.id)await h.command('autopay.policy',{customerId:subject.id,mailControl:{recipient:subject.email,revision:null,timeZone:'America/New_York',suppression:'bounced',reason:'synthetic-pantry-212 observed bounce'}})
    const preview=await h.command('erasure.preview',{kind:'contact',id:subject.id})
    await h.command('erasure.execute',{kind:'contact',id:subject.id,fingerprint:preview.fingerprint,requester:'synthetic-pantry-213',channel:'email',reason:'synthetic-pantry-214 remove contact information',confirm:'ERASE'})
    assert.equal((await h.db.prepare('SELECT count(*) AS count FROM pt_autopay_mail_controls WHERE customer_id=?').bind(subject.id).first()).count,0,'erasure removes mail controls for both posted and transaction-free customers')
  }
  const browserScene = await scene('Autopay browser customer')
  return { ...browserScene, provider, accountant, approve: () => approve(browserScene), setup: method => setup(browserScene, method), due, state: () => state(browserScene) }
}
