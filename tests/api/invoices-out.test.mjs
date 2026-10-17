// Invoices out: sending with a PDF and customer link, viewed, reminders on the
// business's schedule, recurring invoices, deposits that match themselves, and
// card or ACH payment from the link. Mail and Stripe are faked only at their
// HTTP edge; everything else is the real Worker, D1 and public routes.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (d, n) => new Date(Date.parse(d + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
const addMonths = (d, n) => { const [y, m, dd] = d.split('-').map(Number), t = new Date(Date.UTC(y, m - 1 + n, 1)), last = new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth() + 1, 0)).getUTCDate(); return new Date(Date.UTC(t.getUTCFullYear(), t.getUTCMonth(), Math.min(dd, last))).toISOString().slice(0, 10) }
const line = (description, rate, accountId) => ({ description, quantity: '1', rate, accountId, taxCode: 'exempt' })

async function setup(h) {
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })
  const c = {}
  for (const [name, email, bankReference] of [['Cedar Studio', 'ap@cedar.example', 'CEDAR STUDIO'], ['Willow Services', 'billing@willow.example', ''], ['Northstar Consulting', 'pay@northstar.example', '']])
    c[name] = await h.command('contact.save', { kind: 'customer', name, email, bankReference, termsDays: 30 })
  const issue = async (customer, issueDate, dueDate, rate) => {
    const d = await h.command('invoice.save-draft', { customerId: c[customer].id, issueDate, dueDate, lines: [line('Design services', rate, acct['4000'])] })
    const a = await h.command('invoice.approve', { id: d.id, revision: d.revision })
    return h.command('invoice.issue', { id: a.id })
  }
  return { acct, bank, c, issue }
}
const invoiceOf = async (h, id) => at((await h.view('sales')).invoices, i => i.id === id)
const linkIn = message => new URL(message.text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname

test('INVOICE-002/003/004 an issued invoice is emailed with its PDF and customer link; the first customer view is recorded; reminders follow the schedule once and stop when paid', async t => {
  const h = await harness(); t.after(() => h.close())
  const { bank, c, issue } = await setup(h), day = today()
  const { sending } = await h.view('invoicing')
  await h.command('sending.save', { revision: sending.revision, remindersOn: true, reminderDays: '7, -3, 0', timeZone: 'America/New_York' })
  const soon = await issue('Cedar Studio', addDays(day, -27), addDays(day, 3), '2400.00')
  const late = await issue('Willow Services', addDays(day, -37), addDays(day, -7), '900.00')
  const paid = await issue('Northstar Consulting', addDays(day, -37), addDays(day, -7), '300.00')
  await issue('Cedar Studio', addDays(day, -37), addDays(day, -7), '100.00') // never sent: no reminders

  const sent = await h.command('invoice.send', { id: soon.id })
  assert.equal(sent.deliveries[0].status, 'accepted')
  const message = h.mail.at(-1)
  assert.deepEqual(message.to, ['ap@cedar.example'])
  assert.equal(message.from, 'Juniper Lane Design LLC <pantry@example.test>')
  assert.match(message.subject, new RegExp(`Invoice ${soon.number} from Juniper Lane Design LLC: \\$2,400\\.00 due`))
  assert.equal(message.attachments[0].filename, `${soon.number}.pdf`)
  const pdf = Buffer.from(message.attachments[0].content, 'base64')
  assert.equal(pdf.subarray(0, 5).toString(), '%PDF-'); assert.ok(pdf.toString('latin1').includes('(Invoice ' + soon.number + ')'))
  const path = linkIn(message)

  // The business opening its own link is not the customer viewing it.
  assert.equal((await h.send(path, undefined, { cookie: h.owner })).status, 200)
  let inv = await invoiceOf(h, soon.id)
  assert.ok(inv.sent_at); assert.equal(inv.viewed_at, null)
  const page = await h.send(path)
  assert.equal(page.status, 200); assert.match(page.value, new RegExp(`Invoice ${soon.number}`)); assert.match(page.value, /\$2,400\.00/)
  const viewed = (await invoiceOf(h, soon.id)).viewed_at
  assert.ok(viewed)
  await h.send(path)
  assert.equal((await invoiceOf(h, soon.id)).viewed_at, viewed, 'only the first opening is recorded')
  const download = await h.send(path + '/invoice.pdf')
  assert.equal(download.status, 200); assert.equal(download.headers.get('content-type'), 'application/pdf')
  assert.equal((await h.send('/i/' + 'x'.repeat(32))).status, 404)

  await h.command('invoice.send', { id: late.id }); await h.command('invoice.send', { id: paid.id })
  await h.command('payment.record', { direction: 'received', contactId: c['Northstar Consulting'].id, date: day, amount: '300.00', bankAccountId: bank.id, allocations: [{ targetId: paid.id, amount: '300.00' }] })
  await h.command('invoice.send', { id: paid.id }, h.owner, 409)

  // Due work: the step due today for each sent, open invoice, once; a late invoice gets only its latest step.
  const before = h.mail.length
  await Promise.all([h.cron(), h.cron()]); await h.cron()
  const reminders = h.mail.slice(before)
  assert.deepEqual(reminders.map(m => m.subject).sort(), [
    `Reminder: invoice ${soon.number} from Juniper Lane Design LLC is due in 3 days`,
    `Reminder: invoice ${late.number} from Juniper Lane Design LLC is 7 days overdue`].sort())
  assert.deepEqual(reminders.map(m => m.to[0]).sort(), ['ap@cedar.example', 'billing@willow.example'])
  assert.ok(reminders.every(m => m.attachments?.[0]?.content && linkIn(m)))
  const sales = await h.view('sales')
  assert.deepEqual(sales.deliveries.filter(d => d.kind === 'reminder').map(d => [d.number, d.step, d.status]).sort(), [[late.number, 7, 'accepted'], [soon.number, -3, 'accepted']].sort())
  assert.equal(sales.deliveries.filter(d => d.kind === 'invoice').length, 3)
  assert.equal(sales.reminders.plans[soon.id], addDays(day, 3), 'the next reminder is on the due date')
  assert.equal(sales.reminders.plans[late.id], null, 'no steps left after the last')
})

test('INVOICE-005 a recurring invoice creates drafts for approval, or once a second person approves it issues and sends each one on its own, once per occurrence', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, c } = await setup(h), day = today()
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const start = addMonths(day, -2)
  let monthly = await h.command('recurring.save', { customerId: c['Cedar Studio'].id, startDate: start, every: 1, unit: 'month', mode: 'send', lines: [line('Monthly retainer', '2400.00', acct['4000'])] }, bea)
  assert.equal(monthly.status, 'awaiting-approval'); assert.equal(monthly.next_date, start)
  await h.cron()
  assert.equal((await h.view('sales')).invoices.length, 0, 'nothing is sent before the template is approved')
  await h.command('recurring.approve', { id: monthly.id, revision: monthly.revision }, bea, 403)
  monthly = await h.command('recurring.approve', { id: monthly.id, revision: monthly.revision }, ann)
  assert.equal(monthly.status, 'active')

  // An ordinary request runs due work too; Cron at the same moment creates nothing twice.
  await h.db.prepare("UPDATE pt_due_work SET started_at = '1970-01-01T00:00:00.000Z'").run()
  const mails = h.mail.length
  await Promise.all([h.view('state'), h.cron(), h.cron()])
  let generated = []
  const invoiceMails = () => h.mail.slice(mails).filter(m => m.subject.startsWith('Invoice '))
  for (let i = 0; i < 50 && (generated.length < 3 || invoiceMails().length < 3); i++) { await new Promise(r => setTimeout(r, 100)); generated = (await h.view('sales')).invoices.filter(i => i.recurring_id === monthly.id) }
  assert.deepEqual(generated.map(i => i.issue_date).sort(), [start, addMonths(start, 1), addMonths(start, 2)])
  assert.ok(generated.every(i => i.status === 'issued' && i.total_cents === 240000 && i.approved_by === 'ann@example.test' && i.sent_at))
  await h.cron()
  assert.deepEqual(invoiceMails().map(m => m.to[0]), ['ap@cedar.example', 'ap@cedar.example', 'ap@cedar.example'], 'each occurrence is sent once')
  const view = at((await h.view('sales')).recurring, r => r.id === monthly.id)
  assert.equal(view.next_date, addMonths(start, 3)); assert.deepEqual(view.runs_list.map(r => r.status), ['sent', 'sent', 'sent'])

  // A price change returns it to approval; nothing sends at the new price until someone approves.
  const edited = await h.command('recurring.save', { id: monthly.id, revision: view.revision, customerId: c['Cedar Studio'].id, startDate: start, every: 1, unit: 'month', mode: 'send', lines: [line('Monthly retainer', '2600.00', acct['4000'])] }, bea)
  assert.equal(edited.status, 'awaiting-approval')

  // Draft mode: each occurrence waits for approval by someone other than the template's preparer.
  const drafts = await h.command('recurring.save', { customerId: c['Willow Services'].id, startDate: day, every: 3, unit: 'month', mode: 'draft', lines: [line('Quarterly review', '900.00', acct['4000'])] }, bea)
  assert.equal(drafts.status, 'active')
  await h.cron()
  const draft = at((await h.view('sales')).invoices, i => i.recurring_id === drafts.id)
  assert.equal(draft.status, 'draft'); assert.equal(draft.prepared_by, 'bea@example.test'); assert.equal(draft.issue_date, day)
  await h.command('invoice.approve', { id: draft.id, revision: draft.revision }, bea, 403)
  await h.command('invoice.approve', { id: draft.id, revision: draft.revision }, ann)
  assert.equal(at((await h.view('sales')).recurring, r => r.id === drafts.id).next_date, addMonths(day, 3))
})

test('PAY-004 a deposit naming one open invoice of its amount matches itself, with an undo; ambiguous deposits wait for a person', async t => {
  const h = await harness(); t.after(() => h.close())
  const { bank, issue } = await setup(h)
  const cedar = await issue('Cedar Studio', '2026-10-01', '2026-10-31', '1200.00')
  const willow = await issue('Willow Services', '2026-10-01', '2026-10-31', '1200.00')
  const north = await issue('Northstar Consulting', '2026-10-01', '2026-10-31', '500.00')
  const csv = ['Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #',
    'CREDIT,10/05/2026,"ACH DEPOSIT CEDAR STUDIO LLC",1200.00,ACH_CREDIT,1200.00,',
    `CREDIT,10/06/2026,"REMOTE DEPOSIT REF ${north.number}",500.00,ACH_CREDIT,1700.00,`,
    'CREDIT,10/07/2026,"MOBILE DEPOSIT",1200.00,ACH_CREDIT,2900.00,'].join('\n') + '\n'
  const imported = await h.command('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-10.csv', content: csv, opening: '0.00', closing: '2900.00', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
  assert.deepEqual(imported.automatic.matched.map(m => m.invoice).sort(), [cedar.number, north.number].sort())
  assert.equal(imported.automatic.needsPerson.length, 1)
  assert.match(imported.automatic.needsPerson[0].reason, new RegExp(`Same amount as ${willow.number} \\(Willow Services\\)`))
  assert.equal((await invoiceOf(h, cedar.id)).open_cents, 0); assert.equal((await invoiceOf(h, north.id)).open_cents, 0); assert.equal((await invoiceOf(h, willow.id)).open_cents, 120000)

  let r = await h.view(`reconciliation/${imported.statement.id}`)
  const cedarLine = at(r.lines, l => l.description.includes('CEDAR')), mobile = at(r.lines, l => l.description === 'MOBILE DEPOSIT')
  assert.equal(cedarLine.automatic, 1); assert.match(cedarLine.match_note, /Matched automatically/)
  assert.equal(mobile.match_id, null); assert.match(r.depositNotes[mobile.id], /confirm it/)
  const payment = at((await h.view('sales')).payments, p => p.contact_name === 'Cedar Studio')
  assert.deepEqual([payment.amount_cents, payment.recorded_by, payment.bank_name], [120000, 'pantry:auto-match', 'Operating checking'])

  // Undo: the match and the receipt Pantry recorded go, and the invoice is open again.
  await h.command('match.undo', { id: cedarLine.match_id })
  assert.equal((await invoiceOf(h, cedar.id)).open_cents, 120000)
  r = await h.view(`reconciliation/${imported.statement.id}`)
  assert.equal(at(r.lines, l => l.id === cedarLine.id).match_id, null)
  assert.ok(at((await h.view('sales')).payments, p => p.id === payment.id).reversal_id, 'the automatic receipt is reversed')
  assert.ok((await h.view('reports/trial-balance?to=2026-10-31')).balanced)
  // Re-importing the file adds and matches nothing.
  const again = await h.command('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-10.csv', content: csv, opening: '0.00', closing: '2900.00', confirmLast4: '4821' })
  assert.equal(again.duplicate, true)
})

test('PAY-001 customers pay by card or ACH from the invoice link through the business\'s own Stripe; the payment is recorded and allocated and the fee booked; RER Managed says plainly it is not available', async t => {
  const KEY = 'sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2'
  const sessions = new Map()
  const outbound = async request => {
    const url = new URL(request.url)
    assert.equal(url.host, 'api.stripe.com', `unexpected outbound ${request.method} ${request.url}`)
    assert.equal(request.headers.get('authorization'), `Bearer ${KEY}`)
    if (request.method === 'GET' && url.pathname === '/v1/account') return Response.json({ id: 'acct_1Test', country: 'US', default_currency: 'usd', settings: { dashboard: { display_name: 'Juniper Lane Design' } } })
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const body = new URLSearchParams(await request.text()), id = `cs_test_${sessions.size + 1}`
      sessions.set(id, { body, status: 'open', pi: null })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    const session = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/)
    if (request.method === 'GET' && session) {
      assert.equal(url.searchParams.get('expand[0]'), 'payment_intent.latest_charge.balance_transaction')
      const s = sessions.get(session[1])
      return Response.json({ id: session[1], object: 'checkout.session', status: s.status, payment_intent: s.pi })
    }
    throw new Error(`unexpected Stripe call ${request.method} ${url.pathname}`)
  }
  const h = await harness({ outbound }); t.after(() => h.close())
  const { issue } = await setup(h)
  const card = await issue('Cedar Studio', '2026-10-01', '2026-10-31', '2400.00'), ach = await issue('Willow Services', '2026-10-01', '2026-10-31', '900.00')
  await h.command('invoice.send', { id: card.id }); const cardPage = linkIn(h.mail.at(-1))
  await h.command('invoice.send', { id: ach.id }); const achPage = linkIn(h.mail.at(-1))
  assert.doesNotMatch((await h.send(cardPage)).value, /Pay by card/, 'no online payment before Stripe is connected')

  await h.command('stripe.connect', { secretKey: 'pk_test_not-a-secret' }, h.owner, 400)
  const settings = (await h.command('stripe.connect', { secretKey: KEY })).connected
  assert.deepEqual([settings.account, settings.keyHint, settings.livemode, settings.webhook], ['Juniper Lane Design', 'sk_test_…K1l2', false, false])
  const page = await h.send(cardPage)
  assert.match(page.value, /Pay by card/); assert.match(page.value, /Pay by bank account \(ACH\)/)

  // Card: the customer goes to Stripe Checkout and comes back paid.
  const pay = await h.send(cardPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  assert.equal(pay.status, 303); assert.equal(pay.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_1')
  const s1 = sessions.get('cs_test_1')
  assert.deepEqual([s1.body.get('payment_method_types[0]'), s1.body.get('line_items[0][price_data][unit_amount]'), s1.body.get('customer_email')], ['card', '240000', 'ap@cedar.example'])
  assert.ok(s1.body.get('success_url').startsWith(h.origin + cardPage + '?checkout='))
  Object.assign(s1, { status: 'complete', pi: { id: 'pi_card', status: 'succeeded', amount_received: 240000, latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', amount: 240000, currency: 'usd', fee: 6990, exchange_rate: null } } } })
  const back = await h.send(cardPage + '?checkout=cs_test_1')
  assert.match(back.value, /your payment was received/); assert.match(back.value, /Paid/)
  assert.equal((await invoiceOf(h, card.id)).open_cents, 0)

  // ACH: processing first (not paid, no reminders), then cleared and recorded by due work.
  await h.send(achPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=us_bank_account' })
  const s2 = sessions.get('cs_test_2')
  assert.equal(s2.body.get('payment_method_types[0]'), 'us_bank_account')
  Object.assign(s2, { status: 'complete', pi: { id: 'pi_ach', status: 'processing', amount_received: 0, latest_charge: null } })
  assert.match((await h.send(achPage + '?checkout=cs_test_2')).value, /bank payment is processing/)
  assert.equal((await invoiceOf(h, ach.id)).open_cents, 90000)
  s2.pi = { id: 'pi_ach', status: 'succeeded', amount_received: 90000, latest_charge: { id: 'ch_2', balance_transaction: { id: 'txn_2', amount: 90000, currency: 'usd', fee: 500, exchange_rate: null } } }
  await h.cron()
  assert.equal((await invoiceOf(h, ach.id)).open_cents, 0)

  const sales = await h.view('sales')
  assert.deepEqual(sales.onlinePayments.map(p => [p.method, p.status, p.amount_cents, p.fee_cents]).sort(), [['card', 'succeeded', 240000, 6990], ['us_bank_account', 'succeeded', 90000, 500]].sort())
  const payments = sales.payments.filter(p => p.bank_name === 'Stripe balance')
  assert.deepEqual(payments.map(p => [p.contact_name, p.amount_cents, p.unallocated_cents]).sort(), [['Cedar Studio', 240000, 0], ['Willow Services', 90000, 0]])
  const tb = await h.view(`reports/trial-balance?to=${today()}`)
  assert.ok(tb.balanced)
  const balance = name => at(tb.rows, a => a.name === name).net
  assert.equal(balance('Stripe balance'), 240000 + 90000 - 6990 - 500)
  assert.equal(balance('Stripe fees'), 6990 + 500)
  // Repeating the confirmation records nothing twice.
  await h.send(cardPage + '?checkout=cs_test_1'); await h.cron()
  assert.equal((await h.view('sales')).payments.filter(p => p.bank_name === 'Stripe balance').length, 2)

  // RER Managed has no route out to Stripe yet: the page says so and connecting is refused.
  const m = await harness({ bindings: { RER_INSTALLATION_ID: 'inst_test', RER_MANAGEMENT_ORIGIN: 'https://manage.runeditrun.example' } }); t.after(() => m.close())
  const ms = await setup(m), minv = await ms.issue('Cedar Studio', '2026-10-01', '2026-10-31', '400.00')
  await m.command('invoice.send', { id: minv.id })
  const managedPage = await m.send(linkIn(m.mail.at(-1)))
  assert.match(managedPage.value, /not available yet on RER Managed/); assert.doesNotMatch(managedPage.value, /Pay by card/)
  assert.equal((await m.view('invoicing')).stripe.managed, true)
  await m.command('stripe.connect', { secretKey: KEY }, m.owner, 409)
})
