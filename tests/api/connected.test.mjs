// Connected: a Stripe payout split into gross sales, Stripe fees and refunds
// and matched to its bank deposit; a Gusto payroll posted as one balanced entry
// and matched to its bank debits. Stripe and Gusto are faked only at their HTTP
// edge with responses in their documented shapes (fixtures/stripe, fixtures/gusto);
// everything else is the real Worker, D1 and public routes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, fixture, harness } from './harness.mjs'

const MANAGED = { RER_INSTALLATION_ID: 'inst_test', RER_MANAGEMENT_ORIGIN: 'https://manage.runeditrun.example' }
const json = async name => JSON.parse(await fixture(name))
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const csvOf = rows => ['Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #', ...rows.map(([d, desc, amount, balance]) => `${amount < 0 ? 'DEBIT' : 'CREDIT'},${d},"${desc}",${amount.toFixed(2)},${amount < 0 ? 'ACH_DEBIT' : 'ACH_CREDIT'},${balance.toFixed(2)},`)].join('\n') + '\n'
const net = (tb, name) => tb.rows.find(r => r.name === name)?.net ?? 0
const entriesFor = async (h, sourceId) => (await h.view('journal')).entries.filter(e => e.source_id === sourceId && e.status === 'posted')
const lines = e => e.lines.map(l => [l.account_name, l.debit_cents, l.credit_cents]).sort((a, b) => a[0].localeCompare(b[0]) || a[1] - b[1] || a[2] - b[2])

test('PAYOUT-001 a Stripe payout is split into gross sales, Stripe fees and refunds, matched to its bank deposit, and never booked twice', async t => {
  const KEY = 'sk_test_' + 'Z9y8X7w6V5u4T3s2R1q0P9o8'
  const payouts = await json('stripe/payouts.json'), items = await json('stripe/balance-transactions-po_1TestAutomatic.json')
  const calls = [], sessions = new Map()
  const outbound = async request => {
    const url = new URL(request.url)
    assert.equal(url.host, 'api.stripe.com', `unexpected outbound ${request.method} ${request.url}`)
    assert.equal(request.headers.get('authorization'), `Bearer ${KEY}`)
    calls.push(`${request.method} ${url.pathname}`)
    if (url.pathname === '/v1/account') return Response.json({ id: 'acct_1TestUS', country: 'US', default_currency: 'usd', settings: { dashboard: { display_name: 'Juniper Lane Design' } } })
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') { const id = `cs_test_${sessions.size + 1}`; sessions.set(id, { status: 'open', pi: null }); return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` }) }
    const session = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/)
    if (session) { const s = sessions.get(session[1]); return Response.json({ id: session[1], object: 'checkout.session', status: s.status, payment_intent: s.pi }) }
    if (url.pathname === '/v1/payouts') {
      assert.equal(url.searchParams.get('status'), 'paid')
      assert.equal(url.searchParams.get('arrival_date[gte]'), String(Date.parse('2026-10-01T00:00:00Z') / 1000))
      return Response.json(payouts)
    }
    if (url.pathname === '/v1/balance_transactions') {
      assert.equal(url.searchParams.get('payout'), 'po_1TestAutomatic', 'only automatic payouts are itemized')
      assert.equal(url.searchParams.get('expand[0]'), 'data.source')
      return Response.json(items)
    }
    throw new Error(`unexpected Stripe call ${request.method} ${url.pathname}`)
  }
  const h = await harness({ outbound }); t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })

  // One of the payout's 23 charges is an invoice the customer paid from its link, already in the books.
  const cedar = await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio', email: 'ap@cedar.example', termsDays: 30 })
  const draft = await h.command('invoice.save-draft', { customerId: cedar.id, issueDate: '2026-10-01', dueDate: '2026-10-31', lines: [{ description: 'Design services', quantity: '1', rate: '2400.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  const inv = await h.command('invoice.issue', { id: (await h.command('invoice.approve', { id: draft.id, revision: draft.revision })).id })
  await h.command('invoice.send', { id: inv.id })
  const link = new URL(h.mail.at(-1).text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
  assert.equal((await h.view('connected')).payouts.available, false, 'payouts need Stripe connected first')
  await h.command('stripe.connect', { secretKey: KEY })
  await h.send(link + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  Object.assign(sessions.get('cs_test_1'), { status: 'complete', pi: { id: 'pi_card', status: 'succeeded', amount_received: 240000, latest_charge: { id: 'ch_3TestCharge23', balance_transaction: { id: 'txn_3TestCharge23', amount: 240000, currency: 'usd', fee: 6990, exchange_rate: null } } } })
  await h.send(link + '?checkout=cs_test_1')

  // The owner says where payouts land and where sales go; Pantry reads and books them.
  const stripeBalance = at((await h.view('bank')).accounts, a => a.name === 'Stripe balance')
  await h.command('stripe.payouts', { bankAccountId: stripeBalance.id, salesAccountId: acct['4000'], from: '2026-10-01' }, h.owner, 400)
  const first = await h.command('stripe.payouts', { bankAccountId: bank.id, salesAccountId: acct['4000'], from: '2026-10-01' })
  assert.deepEqual([first.sync.read, first.sync.booked, first.sync.held, first.sync.matched], [2, 1, 1, 0])
  const view = first.payouts
  const auto = at(view.payouts, p => p.id === 'po_1TestAutomatic'), manual = at(view.payouts, p => p.id === 'po_1TestManual')
  assert.deepEqual([auto.status, auto.arrival_date, auto.amount_cents, auto.charges, auto.gross_cents, auto.invoiced_cents, auto.fee_cents, auto.refund_cents, auto.refunds], ['booked', '2026-10-09', 482848, 23, 503798, 240000, 16450, 4500, 1])
  assert.equal(auto.match, null, 'no deposit yet')
  assert.equal(manual.status, 'held'); assert.match(manual.reason, /only automatic payouts/)

  // One balanced entry: the deposit, fees and refunds against sales and the invoice money already in Stripe balance.
  const [entry] = await entriesFor(h, 'po_1TestAutomatic')
  assert.equal(entry.entry_date, '2026-10-09')
  assert.deepEqual(lines(entry), [
    ['Operating checking', 482848, 0],
    ['Refunds and disputes', 4500, 0],
    ['Service revenue', 0, 263798],
    ['Stripe balance', 0, 240000 - 6990],
    ['Stripe fees', 16450 - 6990, 0],
  ])

  // The deposit arrives on the statement and meets the payout by itself.
  const csv = csvOf([['10/08/2026', 'ACH DEPOSIT NORTHSTAR CONSULTING', 300, 300], ['10/09/2026', 'STRIPE TRANSFER ST-K7Q2M9X4 JUNIPER LANE', 4828.48, 5128.48]])
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-10.csv', content: csv, opening: '0.00', closing: '5128.48', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
  const matched = at((await h.view('connected')).payouts.payouts, p => p.id === 'po_1TestAutomatic').match
  assert.ok(matched?.automatic); assert.deepEqual(matched.lines.map(l => [l.posted_date, l.amount_cents]), [['2026-10-09', 482848]])

  // Reading again (by a person and by due work) books nothing twice.
  const tb = await h.view(`reports/trial-balance?to=${today()}`)
  await h.command('stripe.payouts-sync', {}); await h.cron()
  assert.equal((await entriesFor(h, 'po_1TestAutomatic')).length, 1)
  assert.deepEqual(await h.view(`reports/trial-balance?to=${today()}`), tb)
  assert.ok(tb.balanced)
  assert.equal(net(tb, 'Stripe balance'), 0, 'the invoice payment left Stripe balance with the payout')
  assert.equal(net(tb, 'Service revenue'), -(240000 + 263798))
  assert.equal(net(tb, 'Stripe fees'), 16450)
  assert.equal(calls.filter(c => c === 'GET /v1/balance_transactions').length, 1, 'a booked payout is not itemized again')

  // RER Managed cannot reach Stripe yet: one plain line, and nothing to configure.
  const m = await harness({ bindings: MANAGED }); t.after(() => m.close())
  const mb = await books(m)
  const mp = (await m.view('connected')).payouts
  assert.equal(mp.available, false); assert.match(mp.reason, /not available yet on RER Managed/)
  await m.command('stripe.payouts', { bankAccountId: 'x', salesAccountId: mb.acct['4000'], from: '2026-10-01' }, m.owner, 409)
})

test('PAYROLL-001 a Gusto payroll posts as one balanced entry (wages, employer taxes, withholdings, net pay) matched to its bank debits, once', async t => {
  const [token, info, company, payrolls] = await Promise.all(['gusto/oauth-token.json', 'gusto/token-info.json', 'gusto/company.json', 'gusto/payrolls.json'].map(json))
  const GUSTO = { GUSTO_CLIENT_ID: 'demo-client-id', GUSTO_CLIENT_SECRET: 'demo-client-secret', GUSTO_ENV: 'demo' }
  const refreshes = [], live = new Set([token.access_token])
  let refreshToken = token.refresh_token, n = 1
  const outbound = async request => {
    const url = new URL(request.url)
    assert.equal(url.origin, 'https://api.gusto-demo.com', `unexpected outbound ${request.method} ${request.url}`)
    assert.equal(request.headers.get('x-gusto-api-version'), '2026-06-15')
    if (url.pathname === '/oauth/token') {
      const body = await request.json()
      assert.deepEqual([body.client_id, body.client_secret, body.redirect_uri], [GUSTO.GUSTO_CLIENT_ID, GUSTO.GUSTO_CLIENT_SECRET, `${h.origin}/api/pantry/gusto/callback`])
      if (body.grant_type === 'authorization_code') { assert.equal(body.code, 'demo-authorization-code'); return Response.json({ ...token, expires_in: 30 }) }
      refreshes.push(body.refresh_token)
      // Each refresh token works once.
      if (body.grant_type !== 'refresh_token' || body.refresh_token !== refreshToken) return Response.json({ error: 'invalid_grant', error_description: 'The provided authorization grant is invalid, expired or revoked' }, { status: 400 })
      n++; refreshToken = `demo-refresh-token-${n}`; live.add(`demo-access-token-${n}`)
      return Response.json({ ...token, access_token: `demo-access-token-${n}`, refresh_token: refreshToken, expires_in: 30 })
    }
    assert.ok(live.has(request.headers.get('authorization')?.replace('Bearer ', '')), 'a current access token')
    if (url.pathname === '/v1/token_info') return Response.json(info)
    if (url.pathname === `/v1/companies/${company.uuid}`) return Response.json(company)
    if (url.pathname === `/v1/companies/${company.uuid}/payrolls`) {
      const q = Object.fromEntries(url.searchParams)
      assert.deepEqual([q.processing_statuses, q.include, q.per], ['processed', 'totals', '100'])
      return Response.json(q.page === '1' && q.start_date <= '2026-09-14' && q.end_date >= '2026-10-16' ? payrolls : [])
    }
    throw new Error(`unexpected Gusto call ${request.method} ${url.pathname}`)
  }
  const h = await harness({ bindings: GUSTO, outbound }); t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '30000.00' })
  // September's statement already holds Gusto's four debits for the payroll paid on the 30th.
  const september = csvOf([['09/28/2026', 'GUSTO NET 8F3A1C', -7126.58, 22873.42], ['09/28/2026', 'GUSTO TAX 8F3A1C', -2651.85, 20221.57], ['09/28/2026', 'GUSTO REIMB 8F3A1C', -125, 20096.57], ['09/28/2026', 'GUSTO CHILD SUP 8F3A1C', -100, 19996.57]])
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-09.csv', content: september, opening: '30000.00', closing: '19996.57', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })

  // The owner starts Gusto's sign-in from Settings and comes back with the company chosen.
  const { url } = await h.command('gusto.connect', {})
  const authorize = new URL(url)
  assert.equal(authorize.origin + authorize.pathname, 'https://api.gusto-demo.com/oauth/authorize')
  assert.deepEqual([authorize.searchParams.get('client_id'), authorize.searchParams.get('redirect_uri'), authorize.searchParams.get('response_type')], ['demo-client-id', `${h.origin}/api/pantry/gusto/callback`, 'code'])
  const state = authorize.searchParams.get('state')
  const back = await h.send(`/api/pantry/gusto/callback?code=demo-authorization-code&state=${state}`, undefined, { cookie: h.owner })
  assert.equal(back.status, 303); assert.equal(back.headers.get('location'), '/app/settings?gusto=connected#payroll')
  const replay = await h.send(`/api/pantry/gusto/callback?code=demo-authorization-code&state=${state}`, undefined, { cookie: h.owner })
  assert.match(decodeURIComponent(replay.headers.get('location')), /expired or was not started here/)

  const g = (await h.view('connected')).gusto
  assert.deepEqual([g.connected.company, g.connected.bank.name, g.connected.from], ['Juniper Lane Design', 'Operating checking', '2026-01-01'])
  const p1 = at(g.payrolls, p => p.check_date === '2026-09-30'), p2 = at(g.payrolls, p => p.check_date === '2026-10-15'), p3 = at(g.payrolls, p => p.check_date === '2026-10-16')
  assert.equal(g.payrolls.length, 3, 'the external payroll is not posted')
  assert.deepEqual([p1.status, p1.gross_cents, p1.employer_tax_cents, p1.withheld_cents, p1.net_cents, p1.debit_cents], ['booked', 945000, 77843, 232342, 712658, 1000343])
  assert.equal(p3.status, 'held'); assert.match(p3.reason, /tax debit of \$300\.00/)

  // One balanced entry on the check date, matched to the four debits by itself.
  const [entry] = await entriesFor(h, p1.uuid)
  assert.equal(entry.entry_date, '2026-09-30')
  assert.deepEqual(lines(entry), [
    ['Employee benefits', 45000, 0], ['Employee reimbursements', 12500, 0],
    ['Operating checking', 0, 10000], ['Operating checking', 0, 12500], ['Operating checking', 0, 77843], ['Operating checking', 0, 187342], ['Operating checking', 0, 712658],
    ['Payroll liabilities', 0, 5000], ['Payroll liabilities', 0, 30000], ['Payroll liabilities', 0, 45000],
    ['Payroll taxes', 77843, 0], ['Wages and salaries', 945000, 0],
  ])
  assert.deepEqual(p1.match.lines.map(l => l.amount_cents).sort((a, b) => a - b), [-712658, -265185, -12500, -10000])
  assert.equal(p2.status, 'booked'); assert.equal(p2.match, null)

  // October's combined debit arrives later and meets the second payroll.
  const october = csvOf([['10/13/2026', 'GUSTO PAYROLL E7F0C2', -8576.5, 11420.07]])
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-10.csv', content: october, opening: '19996.57', closing: '11420.07', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
  assert.deepEqual(at((await h.view('connected')).gusto.payrolls, p => p.uuid === p2.uuid).match.lines.map(l => l.amount_cents), [-857650])

  // Reading again refreshes the two-hour token (each refresh token once) and posts nothing twice.
  const tb = await h.view('reports/trial-balance?to=2026-10-31')
  await h.command('gusto.sync', {}); await h.command('gusto.sync', {}); await h.cron()
  assert.deepEqual(refreshes.slice(0, 2), ['demo-refresh-token-1', 'demo-refresh-token-2'])
  assert.equal((await entriesFor(h, p1.uuid)).length, 1); assert.equal((await entriesFor(h, p2.uuid)).length, 1)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-10-31'), tb)
  assert.ok(tb.balanced)
  assert.equal(net(tb, 'Wages and salaries'), 945000 + 820000)
  assert.equal(net(tb, 'Payroll taxes'), 77843 + 67650)
  assert.equal(net(tb, 'Operating checking'), -(1000343 + 857650), 'the two debits, against no opening entry in this test')
  assert.equal((await h.view('connected')).gusto.connected.error, '')

  // RER Managed cannot reach Gusto yet: one plain line, and connecting is refused.
  const m = await harness({ bindings: { ...GUSTO, ...MANAGED } }); t.after(() => m.close())
  await books(m)
  const mg = (await m.view('connected')).gusto
  assert.equal(mg.availability.available, false); assert.match(mg.availability.reason, /not available yet on RER Managed/)
  await m.command('gusto.connect', {}, m.owner, 503)
})
