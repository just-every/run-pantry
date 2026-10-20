import { fakePlaid } from './plaid.mjs'
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

test('INVOICE-009 the private customer record preserves preferences and follows invoices, credits, payments, mail and certificates down to their records', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, bank, c, issue } = await setup(h), day = today(), original = c['Cedar Studio']
  const privateNote = 'Internal collection arrangement: call Olivia before escalating.'
  let customer = await h.command('contact.save', { id: original.id, revision: original.revision, kind: 'customer',
    termsDays: 45, billingAddress: '12 Cedar Street, New York NY 10001', serviceAddress: '90 Studio Road, Albany NY 12207',
    phone: '212 555 0192', internalNotes: privateNote, payMethods: ['card', 'offline'], contacts: [
      { name: 'Casey', email: 'casey@cedar.example', phone: '212 555 0111', roles: ['primary'] },
      { name: 'Accounts', email: 'accounts@cedar.example', roles: ['billing'] },
      { name: 'Owner', email: 'owner@cedar.example', roles: ['cc'] },
    ] })
  customer = await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', name: 'Cedar Studio' })
  const profile = (await h.view(`customers/${customer.id}`)).customer
  assert.deepEqual([profile.terms_days, profile.billing_address, profile.service_address, profile.phone, profile.internal_notes, profile.pay_methods],
    [45, '12 Cedar Street, New York NY 10001', '90 Studio Road, Albany NY 12207', '212 555 0192', privateNote, ['card', 'offline']])
  assert.equal(profile.contacts.length, 3)
  assert.deepEqual(profile.default_recipients, ['accounts@cedar.example', 'owner@cedar.example'])
  await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', payMethods: ['cash'] }, h.owner, 400)
  await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', contacts: [{ name: 'No email', roles: ['billing'] }] }, h.owner, 400)
  const inv = await issue('Cedar Studio', day, addDays(day, 30), '1200.00')
  const other = await issue('Willow Services', day, addDays(day, 30), '900.00')
  const payment = await h.command('payment.record', { direction: 'received', contactId: customer.id, date: day, amount: '300.00', bankAccountId: bank.id,
    reference: 'Cedar deposit', allocations: [{ targetId: inv.id, amount: '200.00' }] })
  const draftCredit = await h.command('invoice.save-draft', { kind: 'credit', customerId: customer.id, creditFor: inv.id, issueDate: day, dueDate: day,
    lines: [line('Service allowance', '100.00', acct['4000'])] })
  const approvedCredit = await h.command('invoice.approve', { id: draftCredit.id, revision: draftCredit.revision })
  const credit = await h.command('invoice.issue', { id: approvedCredit.id })
  const certificate = await h.command('exemption.save', { customerId: customer.id, states: ['NY'], validFrom: day, expiresOn: addDays(day, 365),
    certificateNumber: 'CEDAR-EXEMPT', name: 'cedar-certificate.txt', mediaType: 'text/plain', base64: Buffer.from('Cedar resale certificate evidence').toString('base64') })
  const attachment = await h.command('document.upload', { name: 'invoice-evidence.txt', mediaType: 'text/plain', base64: Buffer.from('Invoice supporting evidence').toString('base64'), linkedKind: 'invoice', linkedId: inv.id })
  const sent = await h.command('invoice.send', { id: inv.id })
  const message = h.mail.at(-1), publicPath = linkIn(message)
  assert.doesNotMatch(message.text + message.html, /Internal collection arrangement/)
  const page = await h.send(publicPath)
  assert.equal(page.status, 200); assert.doesNotMatch(page.value, /Internal collection arrangement/)
  const pdf = await h.send(publicPath + '/invoice.pdf')
  assert.equal(pdf.status, 200); assert.doesNotMatch(pdf.value, /Internal collection arrangement/)

  const history = await h.view(`customers/${customer.id}?to=${day}`), report = await h.view(`reports/receivables?to=${day}`)
  assert.deepEqual(history.summary.ageing_items, report.items.filter(i => i.contact_id === customer.id))
  assert.deepEqual([history.summary.open_invoice_cents, history.summary.unallocated_payment_cents, history.summary.unallocated_credit_cents, history.summary.open_balance_cents], [90000, 10000, 0, 80000])
  const willow = await h.view(`customers/${c['Willow Services'].id}?to=${day}`)
  assert.equal(history.summary.open_balance_cents + willow.summary.open_balance_cents, report.subledger)
  assert.equal(report.agrees, true)
  assert.deepEqual(history.rows.map(r => r.kind).sort(), ['credit', 'invoice', 'payment'])
  assert.ok(!history.rows.some(r => r.id === other.id))
  assert.equal(at(history.rows, r => r.id === payment.id).balance_cents, 10000)
  assert.equal(at(history.rows, r => r.id === credit.id).balance_cents, 0)
  for (const row of history.rows) {
    const record = await h.view(`reports/record/${row.kind === 'payment' ? 'payment' : 'invoice'}/${row.id}`)
    assert.equal(record.id, row.id)
    assert.ok(row.href.includes(encodeURIComponent(row.id)))
    assert.ok(row.allocations.length)
  }
  const invoiceRow = at(history.rows, r => r.id === inv.id)
  const evidence = at(invoiceRow.documents, d => d.id === attachment.id)
  assert.equal((await h.send(evidence.href, undefined, { cookie: h.owner })).value, 'Invoice supporting evidence')
  assert.deepEqual(history.deliveries.map(d => [d.id, d.status, d.recipient]).sort(), sent.deliveries.map(d => [d.id, d.status, d.recipient]).sort())
  assert.ok(history.deliveries.every(d => d.invoice_id === inv.id && d.href === invoiceRow.href))
  const cert = at(history.certificates, e => e.id === certificate.id)
  assert.equal(cert.status, 'Valid')
  assert.equal((await h.send(cert.href, undefined, { cookie: h.owner })).value, 'Cedar resale certificate evidence')
  assert.deepEqual(history.sections, { estimates: { available: false, rows: [] }, statements: { available: false, rows: [] } })
  await h.view(`customers/${customer.id}`, '', 401)
  await h.view(`customers/missing`, h.owner, 404)
  const viewer = await h.member('customer-reader@example.test', 'viewer')
  assert.equal((await h.view(`customers/${customer.id}/history`, viewer)).customer.id, customer.id)
  await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', internalNotes: 'Cannot save' }, viewer, 403)
  customer = await h.command('contact.save', { id: customer.id, revision: customer.revision, kind: 'customer', contacts: [], payMethods: null, internalNotes: '' })
  const cleared = (await h.view(`customers/${customer.id}`)).customer
  assert.deepEqual([cleared.contacts, cleared.pay_methods, cleared.internal_notes, cleared.default_recipients], [[], null, '', ['ap@cedar.example']])
})

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

test('INVOICE-003 customer links show payment history, expire after settlement, and revoke every public door', async t => {
  const h = await harness(); t.after(() => h.close())
  const { bank, c, issue } = await setup(h), day = today()
  const inv = await issue('Cedar Studio', day, addDays(day, 30), '2400.00')
  const viewer = await h.member('viewer@example.test', 'viewer')
  await h.command('invoice.send', { id: inv.id })
  const path = linkIn(h.mail.at(-1))
  await h.command('invoice.link-revoke', { id: inv.id }, viewer, 403)
  await h.command('invoice.link-policy', { id: inv.id, daysAfterPayment: 0 }, viewer, 403)
  await h.command('invoice.link-policy', { id: inv.id, daysAfterPayment: -1 }, h.owner, 400)
  await h.command('invoice.link-policy', { id: inv.id, daysAfterPayment: 0 })
  await h.command('payment.record', { direction: 'received', contactId: c['Cedar Studio'].id, date: day, amount: '400.00', bankAccountId: bank.id, memo: 'Deposit received', allocations: [{ targetId: inv.id, amount: '400.00' }] })
  let page = await h.send(path)
  assert.equal(page.status, 200, 'partial settlement does not expire the link')
  assert.match(page.value, /Payments/); assert.match(page.value, /Deposit received/); assert.match(page.value, /\$400\.00/)
  assert.doesNotMatch(page.value, /<img|pixel/i, 'no email open pixel')
  await h.command('invoice.link-revoke', { id: inv.id })
  for (const suffix of ['', '/invoice.pdf', '/pay']) {
    const r = await h.send(path + suffix, suffix === '/pay' ? { method: 'card' } : undefined)
    assert.equal(r.status, 404, `revoked ${suffix || 'page'}`)
  }
  await h.command('invoice.send', { id: inv.id })
  const fresh = linkIn(h.mail.at(-1))
  assert.notEqual(fresh, path)
  assert.equal((await h.send(path)).status, 404, 'sending again never revives the old token')
  assert.equal((await h.send(fresh)).status, 200)
  await h.command('payment.record', { direction: 'received', contactId: c['Cedar Studio'].id, date: day, amount: '2000.00', bankAccountId: bank.id, allocations: [{ targetId: inv.id, amount: '2000.00' }] })
  for (const suffix of ['', '/invoice.pdf', '/pay']) assert.equal((await h.send(fresh + suffix, suffix === '/pay' ? { method: 'card' } : undefined)).status, 404, `expired ${suffix || 'page'}`)
  await h.command('invoice.link-policy', { id: inv.id, daysAfterPayment: 30 })
  page = await h.send(fresh)
  assert.equal(page.status, 200); assert.match(page.value, />Paid</); assert.match(page.value, /\$2,000\.00/)
  const saved = await invoiceOf(h, inv.id)
  assert.ok(saved.viewed_at)
  await h.send(fresh)
  assert.equal((await invoiceOf(h, inv.id)).viewed_at, saved.viewed_at)
  for (const suffix of ['', '/invoice.pdf', '/pay']) assert.equal((await h.send('/i/' + 'z'.repeat(32) + suffix, suffix === '/pay' ? { method: 'card' } : undefined)).status, 404)
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

test('PAY-004 invoice-named deposits clear automatically, amount-only wires await confirmation, and both undo without duplicates', async t => {
  const plaid = await fakePlaid()
  const h = await harness({ bindings: plaid.bindings, outbound: plaid.outbound }); t.after(() => h.close())
  const { bank, c, issue } = await setup(h)
  const cedar = await issue('Cedar Studio', '2026-10-01', '2026-10-31', '1200.00')
  const willow = await issue('Willow Services', '2026-10-01', '2026-10-31', '1200.00')
  await issue('Northstar Consulting', '2026-10-01', '2026-10-31', '1200.00')
  const north = await issue('Northstar Consulting', '2026-10-01', '2026-10-31', '500.00')
  const referenced = await issue('Cedar Studio', '2026-10-01', '2026-10-31', '375.00')
  await issue('Willow Services', '2026-10-01', '2026-10-31', '375.00')
  const csv = ['Posting Date,Description,Amount',
    `10/05/2026,ZELLE ${cedar.number},1200.00`,
    '10/06/2026,WIRE,500.00',
    '10/07/2026,MOBILE DEPOSIT,1200.00',
    '10/08/2026,ZELLE CEDAR STUDIO,375.00'].join('\n') + '\n'
  const input = { bankAccountId: bank.id, fileName: 'checking-2026-10.csv', content: csv, opening: '0.00', closing: '3275.00', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' }
  const first = plaid.recorded['transactions-sync-1'], next = plaid.recorded['transactions-sync-2']
  const account = at(plaid.recorded['accounts-get'].accounts, a => a.mask === '0000')
  const template = first.added[0]
  first.added = [
    { ...template, account_id: account.account_id, transaction_id: 'outside-zelle', date: '2026-10-05', name: `ZELLE ${cedar.number}`, merchant_name: null, amount: -1200, pending: false, pending_transaction_id: null },
    { ...template, account_id: account.account_id, transaction_id: 'outside-wire', date: '2026-10-06', name: 'WIRE', merchant_name: null, amount: -500, pending: false, pending_transaction_id: null },
    { ...template, account_id: account.account_id, transaction_id: 'outside-mobile', date: '2026-10-07', name: 'MOBILE DEPOSIT', merchant_name: null, amount: -1200, pending: false, pending_transaction_id: null },
    { ...template, account_id: account.account_id, transaction_id: 'outside-reference', date: '2026-10-08', name: 'ZELLE CEDAR STUDIO', merchant_name: null, amount: -375, pending: false, pending_transaction_id: null }]
  next.added = []; next.modified = []; next.removed = []
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-public-sandbox-b0e2c4ee-a763-4df5-bfe9-46a46bce993d', institution: { name: 'First Platypus Bank' } })
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: at(connection.accounts, a => a.mask === '0000').id, bankAccountId: bank.id }] })
  const queue = await h.view('bank/lines')
  const zelle = at(queue.lines, l => l.description === `ZELLE ${cedar.number}`), wire = at(queue.lines, l => l.description === 'WIRE'), mobile = at(queue.lines, l => l.description === 'MOBILE DEPOSIT')
  const refLine = at(queue.lines, l => l.description === 'ZELLE CEDAR STUDIO')
  assert.ok(refLine.match_id, 'PAY-004 the customer payment reference identifies one invoice of the exact amount on the feed')
  assert.equal(refLine.automatic, 1)
  assert.equal((await invoiceOf(h, referenced.id)).open_cents, 0)
  // A downloaded statement adopts the feed lines and retains their proposal identities.
  const imported = await h.command('statement.import', input)
  assert.equal(imported.added, 0)
  assert.equal(imported.automatic.matched.length, 0)
  let r = await h.view(`reconciliation/${imported.statement.id}`)
  assert.equal(r.depositProposals[zelle.id], undefined)
  const automatic = at(r.lines, l => l.id === zelle.id)
  assert.ok(automatic.match_id); assert.equal(automatic.automatic, 1)
  assert.equal(r.depositProposals[wire.id].invoiceId, north.id)
  assert.equal(r.depositProposals[mobile.id], undefined, 'ambiguous amount has no one-click suggestion')
  assert.equal((await h.view('bank/lines')).depositProposals[wire.id].invoiceId, north.id)
  assert.equal((await invoiceOf(h, cedar.id)).open_cents, 0, 'the feed settles an invoice-named deposit without confirmation')
  assert.equal((await invoiceOf(h, north.id)).open_cents, 50000)
  const viewer = await h.member('read@example.test', 'viewer')
  await h.command('deposit.confirm', { lineId: wire.id, invoiceId: north.id }, viewer, 403)
  await h.command('deposit.confirm', { lineId: mobile.id, invoiceId: willow.id }, h.owner, 409)
  await h.command('deposit.confirm', { lineId: wire.id, invoiceId: cedar.id }, h.owner, 409)
  const confirmed = await h.command('deposit.confirm', { lineId: wire.id, invoiceId: north.id })
  await h.command('deposit.confirm', { lineId: zelle.id, invoiceId: cedar.id }, h.owner, 409)
  assert.equal((await invoiceOf(h, cedar.id)).open_cents, 0)
  assert.equal((await invoiceOf(h, north.id)).open_cents, 0)
  const payments = (await h.view('sales')).payments
  assert.equal(payments.length, 3, 'repeat confirmation posts nothing twice')
  r = await h.view(`reconciliation/${imported.statement.id}`)
  assert.ok(at(r.lines, l => l.id === wire.id).match_id)
  const audit = await h.view('activity')
  assert.ok(audit.audit.some(e => e.action === 'match.automatic' && e.subject_id === automatic.match_id), 'automatic payment has an audit entry')
  await h.command('feed.sync', { itemId: connection.id })
  assert.equal((await h.view('sales')).payments.length, 3, 'feed replay cannot duplicate a receipt')
  await h.command('match.undo', { id: automatic.match_id })
  assert.equal((await invoiceOf(h, cedar.id)).open_cents, 120000)
  assert.ok(audit.audit.some(e => e.action === 'match.automatic' && e.subject_id === refLine.match_id))
  await h.command('match.undo', { id: refLine.match_id })
  assert.equal((await invoiceOf(h, referenced.id)).open_cents, 37500)
  await h.command('match.undo', { id: confirmed.id })
  assert.equal((await invoiceOf(h, north.id)).open_cents, 50000)
  assert.ok(at((await h.view('sales')).payments, p => p.contact_name === 'Cedar Studio').reversal_id)
  assert.ok((await h.view('reports/trial-balance?to=2026-10-31&basis=accrual')).balanced)
  assert.equal((await h.command('statement.import', input)).duplicate, true)

  // The CSV door uses the same payment-reference rule. Several same-customer
  // invoices of the amount remain ambiguous, even when their reference is named.
  const csvInvoice = await issue('Cedar Studio', '2026-10-01', '2026-10-31', '425.00')
  await issue('Willow Services', '2026-10-01', '2026-10-31', '425.00')
  await issue('Cedar Studio', '2026-10-01', '2026-10-31', '275.00')
  await issue('Cedar Studio', '2026-10-01', '2026-10-31', '275.00')
  const recorded = await issue('Willow Services', '2026-10-01', '2026-10-31', '180.00')
  await h.command('payment.record', { direction: 'received', contactId: c['Willow Services'].id, date: '2026-10-09', amount: '180.00', bankAccountId: bank.id, reference: 'WILLOW PAYMENT 7842', allocations: [{ targetId: recorded.id, amount: '180.00' }] })
  const before = (await h.view('sales')).payments.length
  c['Ab Design'] = await h.command('contact.save', { kind: 'customer', name: 'Ab Design', bankReference: 'AB', termsDays: 30 })
  c['Abc Design'] = await h.command('contact.save', { kind: 'customer', name: 'Abc Design', bankReference: 'ABC', termsDays: 30 })
  const short = await issue('Ab Design', '2026-10-01', '2026-10-31', '90.00'), longer = await issue('Abc Design', '2026-10-01', '2026-10-31', '90.00')
  const csvInput = { ...input, fileName: 'checking-reference.csv', content: 'Posting Date,Description,Amount\n10/09/2026,WIRE cédar-stúdio,425.00\n10/09/2026,ZELLE CEDAR STUDIO,275.00\n10/09/2026,WILLOW PAYMENT 7842,180.00\n10/09/2026,ZELLE ABC,90.00\n10/09/2026,ZELLE AB,90.00\n10/09/2026,OTHER INVOICE PREFIX,1200.00\n'.replace('OTHER INVOICE PREFIX', `OTHER ${cedar.number}0`), opening: '3275.00', closing: '5535.00', start: '2026-10-09', end: '2026-10-09' }
  const importedReference = await h.command('statement.import', csvInput)
  assert.equal((await invoiceOf(h, csvInvoice.id)).open_cents, 0)
  assert.equal((await invoiceOf(h, short.id)).open_cents, 0, 'a short stored reference is still a payment reference')
  assert.equal((await invoiceOf(h, longer.id)).open_cents, 0, 'a reference must name the whole value, not a prefix')
  const csvLines = (await h.view(`reconciliation/${importedReference.statement.id}`)).lines
  assert.ok(at(csvLines, l => l.description === 'WIRE cédar-stúdio').match_id, 'case, accents and separators do not change a reference')
  assert.equal(at(csvLines, l => l.description === `OTHER ${cedar.number}0`).match_id, null, 'a different, longer invoice number cannot settle its prefix')
  assert.equal(at((await h.view('sales')).payments, p => p.id === at(csvLines, l => l.description === 'ZELLE ABC').payment_id).contact_id, c['Abc Design'].id)
  assert.equal(at(csvLines, l => l.description === 'ZELLE CEDAR STUDIO').match_id, null, 'ambiguous customer reference waits for a person')
  assert.ok(at(csvLines, l => l.description === 'WILLOW PAYMENT 7842').match_id, 'PAN-06 recorded receipt clears automatically')
  assert.equal((await h.view('sales')).payments.length, before + 3, 'the recorded receipt is never posted a second time')
  assert.equal((await h.command('statement.import', csvInput)).duplicate, true)
  assert.equal((await h.view('sales')).payments.length, before + 3)

})

test('PAY-001 customers pay by card or ACH from the invoice link through the business\'s own Stripe; the payment is recorded and allocated and the fee booked; without online payment the customer is told how to pay, and RER Managed refuses to connect', async t => {
  const KEY = 'sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2'
  const sessions = new Map()
  const outbound = async request => {
    const url = new URL(request.url)
    assert.equal(url.host, 'api.stripe.com', `unexpected outbound ${request.method} ${request.url}`)
    assert.equal(request.headers.get('authorization'), `Bearer ${KEY}`)
    assert.match(request.headers.get('stripe-version') ?? '', /^\d{4}-\d{2}-\d{2}\.\w+$/, 'every call names the Stripe API version Pantry is written for, not the account default')
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
  const before = (await h.send(cardPage)).value
  assert.doesNotMatch(before, /Pay by card/, 'no online payment before Stripe is connected')
  assert.match(before, /How to pay/); assert.doesNotMatch(before, /Stripe/, 'the customer is not told how the business is set up')

  await h.command('stripe.connect', { secretKey: 'pk_test_not-a-secret' }, h.owner, 400)
  const settings = (await h.command('stripe.connect', { secretKey: KEY })).connected
  assert.deepEqual([settings.account, settings.keyHint, settings.livemode, settings.webhook], ['Juniper Lane Design', 'sk_test_…K1l2', false, false])
  const page = await h.send(cardPage)
  assert.match(page.value, /Pay by card/); assert.match(page.value, /Pay by bank account \(ACH\)/)

  // Card: the customer goes to Stripe Checkout and comes back paid.
  const pay = await h.send(cardPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  assert.equal(pay.status, 303); assert.equal(pay.headers.get('location'), 'https://checkout.stripe.com/c/pay/cs_test_1')
  const s1 = sessions.get('cs_test_1')
  assert.deepEqual([s1.body.get('allowed_payment_method_types[0]'), s1.body.get('line_items[0][price_data][unit_amount]'), s1.body.get('customer_email')], ['card', '240000', 'ap@cedar.example'])
  assert.ok(![...s1.body.keys()].some(k => k.startsWith('payment_method_types')), 'Stripe removed payment_method_types from Checkout')
  assert.ok(s1.body.get('success_url').startsWith(h.origin + cardPage + '?checkout='))
  Object.assign(s1, { status: 'complete', pi: { id: 'pi_card', status: 'succeeded', amount_received: 240000, latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', amount: 240000, currency: 'usd', fee: 6990, exchange_rate: null } } } })
  const back = await h.send(cardPage + '?checkout=cs_test_1')
  assert.match(back.value, /your payment was received/); assert.match(back.value, /Paid/)
  assert.equal((await invoiceOf(h, card.id)).open_cents, 0)

  // ACH: processing first (not paid, no reminders), then cleared and recorded by due work.
  await h.send(achPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=us_bank_account' })
  const s2 = sessions.get('cs_test_2')
  assert.equal(s2.body.get('allowed_payment_method_types[0]'), 'us_bank_account')
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
  const tb = await h.view(`reports/trial-balance?to=${today()}&basis=accrual`)
  assert.ok(tb.balanced)
  const balance = name => at(tb.rows, a => a.name === name).net
  assert.equal(balance('Stripe balance'), 240000 + 90000 - 6990 - 500)
  assert.equal(balance('Stripe fees'), 6990 + 500)
  // Repeating the confirmation records nothing twice.
  await h.send(cardPage + '?checkout=cs_test_1'); await h.cron()
  assert.equal((await h.view('sales')).payments.filter(p => p.bank_name === 'Stripe balance').length, 2)

  // RER Managed has no route out to Stripe yet: the customer is told how to pay, and connecting is refused.
  const m = await harness({ bindings: { RER_INSTALLATION_ID: 'inst_test', RER_MANAGEMENT_ORIGIN: 'https://manage.runeditrun.example' } }); t.after(() => m.close())
  const ms = await setup(m), minv = await ms.issue('Cedar Studio', '2026-10-01', '2026-10-31', '400.00')
  await m.command('invoice.send', { id: minv.id })
  const managedPage = await m.send(linkIn(m.mail.at(-1)))
  assert.match(managedPage.value, /How to pay/); assert.doesNotMatch(managedPage.value, /Pay by card|RER Managed|Stripe/)
  assert.equal((await m.view('invoicing')).stripe.managed, true)
  await m.command('stripe.connect', { secretKey: KEY }, m.owner, 409)
})

test('INVOICE-010 discounts, delivery charges and deposits on the invoice: tax on the discounted base, the discount and deposit posted, the balance due on the PDF and the hosted page', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, bank, c } = await setup(h)
  const bookkeeper = await h.member('bea@example.test', 'bookkeeper')
  const discounts = await h.command('account.save', { code: '4950', name: 'Sales discounts', type: 'income' })
  const ca = await h.command('tax-code.save', { name: 'California 8.25%', rate: '8.25', accountId: acct['2200'], state: 'CA' })
  const customer = c['Cedar Studio'].id, issueDate = '2026-11-02'
  const body = { customerId: customer, issueDate, dueDate: '2026-12-02', lines: [
    { description: 'Kitchen design', quantity: '1', rate: '1000.00', accountId: acct['4000'], taxCode: ca.id },
    { kind: 'delivery', description: 'Delivery', quantity: '1', rate: '40.00', accountId: acct['4000'], taxCode: ca.id }],
    discounts: [{ type: 'percent', value: '10' }], deposit: { amount: '300.00', method: 'check', date: issueDate, bankAccountId: bank.id, reference: '1042' } }

  // The discounts account is the accountant's choice: without it approval waits; a bookkeeper cannot choose it.
  let draft = await h.command('invoice.save-draft', body)
  assert.deepEqual([draft.discount_account_id, draft.subtotal_cents, draft.discount_cents, draft.tax_cents, draft.total_cents], [null, 104000, 10000, 7755, 101755])
  assert.deepEqual(draft.lines.map(l => [l.line_kind, l.amount_cents, l.discount_cents, l.tax_cents]), [['item', 100000, 10000, 7425], ['delivery', 4000, 0, 330]])
  await h.command('invoice.approve', { id: draft.id, revision: draft.revision }, h.owner, 409)
  await h.command('discount-settings.save', { discountAccountId: discounts.id }, bookkeeper, 403)
  await h.command('discount-settings.save', { discountAccountId: acct['1000'] }, h.owner, 400)
  const settings = await h.command('discount-settings.save', { discountAccountId: discounts.id })
  assert.equal((await h.view('invoicing')).discounts.settings.discount_code, '4950')
  draft = await h.command('invoice.save-draft', { ...body, id: draft.id, revision: draft.revision })
  assert.equal(draft.discount_account_id, discounts.id)

  // Refusals: delivery is not discounted, a credit carries no discount, a deposit is no more than the total and dated at issue.
  for (const bad of [{ discounts: [{ type: 'percent', value: '10', lines: [2] }] }, { discounts: [{ type: 'percent', value: '0' }] }, { discounts: [{ type: 'amount', value: '1000.01', lines: [1] }] },
    { deposit: { ...body.deposit, amount: '1017.56' } }, { deposit: { ...body.deposit, date: '2026-11-03' } }, { deposit: { ...body.deposit, method: 'barter' } }])
    await h.command('invoice.save-draft', { ...body, ...bad }, h.owner, 400)

  const approved = await h.command('invoice.approve', { id: draft.id, revision: draft.revision })
  const issued = await h.command('invoice.issue', { id: approved.id })
  assert.equal(issued.open_cents, 71755)
  const entry = at((await h.view('journal')).entries, e => e.id === issued.journal_id)
  assert.deepEqual(entry.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['1200', 101755, 0], ['4000', 0, 100000], ['4000', 0, 4000], ['4950', 10000, 0], ['2200', 0, 7755]])
  const deposit = at((await h.view('sales')).payments, p => p.id === issued.deposit_payment_id)
  assert.deepEqual([deposit.amount_cents, deposit.method, deposit.payment_date, deposit.reference, deposit.bank_account_id], [30000, 'check', issueDate, '1042', bank.id])
  const depositEntry = at((await h.view('journal')).entries, e => e.id === deposit.journal_id)
  assert.deepEqual(depositEntry.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['1000', 30000, 0], ['1200', 0, 30000]])

  // The PDF and the hosted page show the discount, the deposit and $717.55 due.
  await h.command('invoice.send', { id: issued.id })
  const path = linkIn(h.mail.at(-1))
  const pdf = (await h.send(path + '/invoice.pdf')).value
  for (const shown of ['(Discount 10% on subtotal)', '(-$100.00)', '(Sales tax)', '($77.55)', '($1,017.55)', '(Deposit received \\(check 1042, Nov 2, 2026\\))', '(-$300.00)', '(Amount due)', '($717.55)'])
    assert.ok(pdf.includes(shown), `PDF shows ${shown}`)
  const page = (await h.send(path)).value
  assert.match(page, /Discount 10% on subtotal<\/span><strong>-\$100\.00/); assert.match(page, /Amount due<\/span><strong class="due">\$717\.55/)
  assert.match(page, /Current balance: \$717\.55/); assert.match(page, new RegExp(`\\$300\\.00 · Deposit received at issue of ${issued.number}`))

  // Tax is on $940; on the cash basis the paid invoice recognises the same taxable sale, tax and discount.
  const accrual = await h.view(`reports/sales-tax?from=2026-11-01&to=2026-11-30&basis=accrual`)
  const caRow = at(accrual.states, s => s.state === 'CA')
  assert.deepEqual([caRow.taxable, caRow.charged, accrual.ledger.ties], [94000, 7755, true])
  await h.command('payment.record', { direction: 'received', contactId: customer, date: '2026-11-20', amount: '717.55', bankAccountId: bank.id, allocations: [{ targetId: issued.id, amount: '717.55' }] })
  const cash = await h.view(`reports/sales-tax?from=2026-11-01&to=2026-11-30&basis=cash`)
  assert.deepEqual([at(cash.states, s => s.state === 'CA').taxable, at(cash.states, s => s.state === 'CA').collected, cash.ledger.ties], [94000, 7755, true])
  const items = await h.view(`reports/sales-by-item?from=2026-11-01&to=2026-11-30&basis=cash`)
  assert.equal(items.total, 94000)

  // An after-tax discount leaves the tax on the full price; a discount on a chosen line reaches only that line.
  const other = await h.command('invoice.save-draft', { customerId: customer, issueDate, lines: [
    { description: 'Consultation', quantity: '1', rate: '200.00', accountId: acct['4000'], taxCode: ca.id },
    { description: 'Site visit', quantity: '2', rate: '50.00', accountId: acct['4000'], taxCode: ca.id }],
    discounts: [{ type: 'amount', value: '15.00', lines: [2] }, { type: 'amount', value: '20.00', afterTax: true }] }, bookkeeper)
  assert.deepEqual(other.lines.map(l => [l.discount_cents, l.tax_cents]), [[0, 1650], [1500, 701]])
  assert.deepEqual([other.after_tax_discount_cents, other.total_cents], [2000, 30000 - 1500 + 2351 - 2000])
  const otherIssued = await h.command('invoice.issue', { id: (await h.command('invoice.approve', { id: other.id, revision: other.revision })).id })
  assert.deepEqual(at((await h.view('journal')).entries, e => e.id === otherIssued.journal_id).lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]),
    [['1200', 28851, 0], ['4000', 0, 20000], ['4000', 0, 10000], ['4950', 3500, 0], ['2200', 0, 2351]])
  const credit = { kind: 'credit', creditFor: otherIssued.id, customerId: customer, issueDate, dueDate: issueDate, lines: [line('Allowance', '10.00', acct['4000'])] }
  await h.command('invoice.save-draft', { ...credit, discounts: [{ type: 'amount', value: '1.00' }] }, h.owner, 400)
  await h.command('invoice.save-draft', { ...credit, lines: [{ ...credit.lines[0], kind: 'delivery' }] }, h.owner, 400)

  // A recurring template carries the discount and the delivery charge to each invoice it creates.
  const today_ = today()
  const template = await h.command('recurring.save', { customerId: customer, startDate: today_, unit: 'month', every: 1, mode: 'draft', termsDays: 30, lines: body.lines, discounts: body.discounts })
  assert.deepEqual(template.discounts, [{ type: 'percent', value: '10' }])
  await h.command('recurring.save', { customerId: customer, startDate: today_, unit: 'month', every: 1, mode: 'draft', lines: body.lines, deposit: body.deposit }, h.owner, 400)
  const { date: _, ...each } = body.deposit
  const withDeposit = await h.command('recurring.save', { customerId: customer, startDate: today_, unit: 'month', every: 1, mode: 'draft', termsDays: 30, lines: body.lines, deposit: each })
  assert.deepEqual(withDeposit.deposit, { amount: '300.00', method: 'check', bankAccountId: bank.id, reference: '1042' })
  await h.cron()
  const occurrence = at((await h.view('sales')).invoices, i => i.recurring_id === template.id)
  assert.deepEqual([occurrence.status, occurrence.discount_cents, occurrence.tax_cents, occurrence.total_cents, occurrence.lines.map(l => l.line_kind)], ['draft', 10000, 7755, 101755, ['item', 'delivery']])
  const deposited = at((await h.view('sales')).invoices, i => i.recurring_id === withDeposit.id)
  assert.deepEqual(deposited.deposit, { amount: 30000, method: 'check', date: today_, bankAccountId: bank.id, reference: '1042' })
  const depositedIssued = await h.command('invoice.issue', { id: (await h.command('invoice.approve', { id: deposited.id, revision: deposited.revision })).id })
  assert.equal(depositedIssued.open_cents, 104000 + 8580 - 30000)
  assert.equal(settings.revision.length > 0, true)
})

test('INVOICE-010 early-payment terms (with SALESTAX-001/002/004, INVOICE-001/003/005, PAY-001/002/004): per-code treatment, the offer approved with the invoice, an all-or-nothing linked discount credit in the window, reversal, Stripe and PAY-004, sales-tax columns and refusals', async t => {
  const KEY = 'sk_test_' + 'A1b2C3d4E5f6G7h8I9j0K1l2', sessions = new Map()
  const outbound = async request => {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/v1/account') return Response.json({ id: 'acct_1Test', country: 'US', default_currency: 'usd', settings: { dashboard: { display_name: 'Juniper Lane Design' } } })
    if (request.method === 'POST' && url.pathname === '/v1/checkout/sessions') {
      const id = `cs_test_${sessions.size + 1}`
      sessions.set(id, { body: new URLSearchParams(await request.text()), status: 'open', pi: null })
      return Response.json({ id, url: `https://checkout.stripe.com/c/pay/${id}` })
    }
    const session = url.pathname.match(/^\/v1\/checkout\/sessions\/(cs_test_\d+)$/)
    if (request.method === 'GET' && session) { const s = sessions.get(session[1]); return Response.json({ id: session[1], object: 'checkout.session', status: s.status, payment_intent: s.pi }) }
    throw new Error(`unexpected Stripe call ${request.method} ${url.pathname}`)
  }
  const h = await harness({ outbound }); t.after(() => h.close())
  const { acct, bank, c } = await setup(h)
  const la = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
  const { sending } = await h.view('invoicing')
  await h.command('sending.save', { revision: sending.revision, remindersOn: false, reminderDays: '0', timeZone: 'America/Los_Angeles' })
  const day = la(), long = d => { const [y, m, dd] = d.split('-').map(Number); return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][m - 1]} ${dd}, ${y}` }
  const ann = await h.member('ann@example.test', 'accountant', { canPost: true }), bea = await h.member('bea@example.test', 'bookkeeper'), vic = await h.member('vic@example.test', 'viewer')
  const agent = await h.agent()
  const discounts = await h.command('account.save', { code: '4950', name: 'Sales discounts', type: 'income' })
  const code = (name, rate, state) => h.command('tax-code.save', { name, rate, accountId: acct['2200'], state })
  const ca = await code('California 8.25%', '8.25', 'CA'), caB = await code('California 8.25% (B)', '8.25', 'CA'), ca95 = await code('California 9.5%', '9.5', 'CA')
  const ny = await code('New York 8%', '8', 'NY'), tx = await code('Texas 8.25%', '8.25', 'TX'), wa = await code('Washington 8.25%', '8.25', 'WA'), spare = await code('Spare 8.25%', '8.25', 'CA')
  const svc = (rate, taxCode, description = 'Design services') => ({ description, quantity: '1', rate, accountId: acct['4000'], taxCode })
  const term = { percent: '2', days: 10 }
  const customer = c['Cedar Studio'].id, other = c['Willow Services'].id
  const draft = (issueDate, lines, extra = {}, cookie = bea, who = customer) => h.command('invoice.save-draft', { customerId: who, issueDate, dueDate: addDays(issueDate, 30), lines, ...extra }, cookie)
  const issue = async (d, cookie = ann) => h.command('invoice.issue', { id: (await h.command('invoice.approve', { id: d.id, revision: d.revision }, cookie)).id }, cookie)
  const entryLines = async id => at((await h.view('journal')).entries, e => e.id === id).lines.map(l => [l.account_code, l.debit_cents, l.credit_cents])
  const discountOf = async id => (await h.view('sales')).invoices.filter(i => i.credit_for === id && i.early_discount === 1)
  const pay = (inv, date, amount, extra = {}) => h.command('payment.record', { direction: 'received', contactId: inv.customer_id, date, amount, bankAccountId: bank.id, reference: `CHK ${amount}`, allocations: [{ targetId: inv.id, amount }], ...extra })

  // R2 / F5: only the post grant records a treatment, sourced from the table; a choice against a row needs a reason; a new state resets it.
  const revisionOf = async tc => at((await h.view('invoicing')).earlyPayment.codes, x => x.id === tc.id).revision
  const treat = async (tc, treatment, extra = {}, cookie = ann, status = 200) => h.command('tax-code.early-treatment', { id: tc.id, revision: await revisionOf(tc), treatment, ...extra }, cookie, status)
  await treat(ca, 'reduce', {}, bea, 403); await treat(ca, 'reduce', {}, vic, 403)
  assert.equal((await h.send('/api/pantry/command/tax-code.early-treatment', { id: ca.id, revision: ca.revision, treatment: 'reduce' }, { headers: { authorization: `Bearer ${agent.token}` } })).status, 401)
  const caT = await treat(ca, 'reduce')
  assert.deepEqual([caT.early_treatment, caT.early_treatment_source.section.startsWith('Reg. 1671.1(b)(1)'), caT.against_suggestion, caT.early_treatment_by], ['reduce', true, false, 'ann@example.test'])
  await treat(caB, 'reduce'); await treat(ca95, 'reduce'); await treat(ny, 'retain')
  await treat(ny, 'reduce', {}, ann, 400)
  await treat(wa, 'retain', {}, ann, 400)
  const waT = await treat(wa, 'retain', { reason: 'The accountant keeps the tax charged on Washington sales' })
  assert.equal(waT.against_suggestion, true)
  const spareT = await treat(spare, 'reduce')
  const moved = await h.command('tax-code.save', { id: spare.id, revision: await revisionOf(spare), name: spare.name, state: 'NV' })
  assert.deepEqual([moved.early_treatment, moved.early_treatment_revision], ['undecided', null])
  const treatments = (await h.view('invoicing')).earlyPayment
  assert.equal(treatments.version, '2026-10-20'); assert.equal(at(treatments.codes, x => x.id === tx.id).early_treatment, 'undecided')

  // F3: with no discounts account chosen, an invoice with a term waits; F4: a bad term is refused.
  const before = await draft(addDays(day, -8), [svc('1000.00', caB.id)], { earlyPayment: term })
  await h.command('invoice.approve', { id: before.id, revision: before.revision }, ann, 409)
  for (const bad of [{ percent: '0', days: 10 }, { percent: '100', days: 10 }, { percent: '2.0001', days: 10 }, { percent: '2', days: 0 }, { percent: '2', days: 31 }, { percent: '2', days: 1.5 }])
    await h.command('invoice.save-draft', { customerId: customer, issueDate: day, dueDate: addDays(day, 30), lines: [svc('1000.00', caB.id)], earlyPayment: bad }, bea, 400)
  await h.command('invoice.save-draft', { customerId: customer, issueDate: day, dueDate: day, lines: [svc('1000.00', caB.id)], earlyPayment: term }, bea, 400)
  await h.command('discount-settings.save', { discountAccountId: discounts.id }, ann)

  // F1: an undecided code stops a term; without the term, or with only exempt lines, the invoice approves.
  const texan = await draft(day, [svc('100.00', tx.id)], { earlyPayment: term })
  await h.command('invoice.approve', { id: texan.id, revision: texan.revision }, ann, 409)
  const plain = await draft(day, [svc('100.00', tx.id)]); await h.command('invoice.approve', { id: plain.id, revision: plain.revision }, ann)
  const exemptOnly = await draft(day, [svc('100.00', 'exempt')], { earlyPayment: term }); await h.command('invoice.approve', { id: exemptOnly.id, revision: exemptOnly.revision }, ann)

  // A1: the base case's offer under reduce and under retain, after the $300 deposit.
  const base = (taxCode) => ({ lines: [svc('1000.00', taxCode), { kind: 'delivery', description: 'Delivery', quantity: '1', rate: '40.00', accountId: acct['4000'], taxCode }],
    discounts: [{ type: 'percent', value: '10' }], deposit: { amount: '300.00', method: 'check', date: day, bankAccountId: bank.id }, earlyPayment: term })
  const a1 = await draft(day, base(caB.id).lines, base(caB.id), bea, other), a1k = await draft(day, base(wa.id).lines, base(wa.id), bea, other)
  assert.deepEqual([a1.total_cents, a1.early_offer.discount, a1.early_offer.reduction, a1.early_offer.settle, a1.early_offer.payBy], [101755, 1880, 155, 99720, 69720])
  assert.deepEqual([a1k.early_offer.discount, a1k.early_offer.reduction, a1k.early_offer.payBy], [1880, 0, 69875])
  await h.command('invoice.save-draft', { customerId: other, issueDate: day, dueDate: addDays(day, 30), ...base(caB.id), deposit: { ...base(caB.id).deposit, amount: '997.20' } }, bea, 400)
  // A7: mixed reduce lines and an exempt line.
  const a7 = await draft(day, [svc('100.00', ca.id), svc('100.00', ca95.id), svc('100.00', 'exempt')], { earlyPayment: term })
  assert.deepEqual([a7.early_offer.discount, a7.early_offer.reduction, a7.early_offer.payBy], [600, 35, 31140])

  // F2: a treatment recorded again after the draft was saved stops approval until the draft is saved again.
  const f2 = await draft(day, [svc('100.00', ca95.id)], { earlyPayment: term })
  await treat(ca95, 'reduce')
  await h.command('invoice.approve', { id: f2.id, revision: f2.revision }, ann, 409)
  const f2b = await h.command('invoice.save-draft', { id: f2.id, revision: f2.revision, customerId: customer, issueDate: day, dueDate: addDays(day, 30), lines: [svc('100.00', ca95.id)], earlyPayment: term }, bea)
  await h.command('invoice.approve', { id: f2b.id, revision: f2b.revision }, ann)

  // A2: issued on day 0, the PDF and page offer $1,060.85; paying it on day 8 posts the linked $21.65 credit.
  const nexusBefore = at((await h.view('sales-tax/nexus')).states, s => s.state === 'CA').sales
  const d0 = addDays(day, -8), a2 = await issue(await draft(d0, [svc('1000.00', ca.id)], { earlyPayment: term }))
  await h.command('invoice.send', { id: a2.id }); const a2Page = linkIn(h.mail.at(-1))
  const pdfBefore = (await h.send(a2Page + '/invoice.pdf')).value, shaBefore = (await invoiceOf(h, a2.id)).issued_pdf_sha256
  assert.ok(pdfBefore.includes(`(Early-payment discount: 2% if paid by ${long(addDays(d0, 10))}. Pay $1,060.85 by then.)`)); assert.ok(pdfBefore.includes('(Sales tax on the discounted price: $80.85.)'))
  const live = (await h.send(a2Page)).value
  assert.match(live, new RegExp(`Early-payment discount: 2% if paid by ${long(addDays(d0, 10))}\\. Pay \\$1,060\\.85 by then\\.`))
  const a2Pay = await pay(a2, day, '1060.85')
  const [a2Credit] = await discountOf(a2.id)
  assert.deepEqual([a2Credit.number.startsWith('CR-'), a2Credit.total_cents, a2Credit.tax_cents, a2Credit.issue_date, a2Credit.early_detail.windowEnd, a2Credit.early_detail.takenOn], [true, 2165, 165, day, addDays(d0, 10), day])
  assert.deepEqual(await entryLines(a2Credit.journal_id), [['1200', 0, 2165], ['4950', 2000, 0], ['2200', 165, 0]])
  assert.equal((await invoiceOf(h, a2.id)).open_cents, 0)
  assert.equal((await h.send(a2Page + '/invoice.pdf')).value, pdfBefore); assert.equal((await invoiceOf(h, a2.id)).issued_pdf_sha256, shaBefore)
  assert.deepEqual(await entryLines(a2.journal_id), [['1200', 108250, 0], ['4000', 0, 100000], ['2200', 0, 8250]])
  assert.match((await h.send(a2Page)).value, new RegExp(`-\\$21\\.65 · Early-payment discount ${a2Credit.number} \\(sales tax -\\$1\\.65\\)`))
  const creditPdf = await h.send(`/api/pantry/invoice-documents/${a2Credit.id}/pdf`, undefined, { cookie: h.owner })
  assert.ok(creditPdf.value.includes(`(Early-payment discount on ${a2.number} \\(${a2Credit.number}\\))`))
  // A4: New York keeps the tax; the discount shows in the tax-kept column.
  const a4 = await issue(await draft(d0, [svc('350.00', ny.id)], { earlyPayment: { percent: '10', days: 10 } }))
  assert.equal(a4.early_offer.payBy, 34300)
  await pay(a4, day, '343.00')
  const [a4Credit] = await discountOf(a4.id)
  assert.deepEqual(await entryLines(a4Credit.journal_id), [['1200', 0, 3500], ['4950', 3500, 0]])
  let report = await h.view(`reports/sales-tax?from=${d0}&to=${day}&basis=accrual`)
  const row = (r, id) => at(r.states.flatMap(s => s.codes), x => x.id === id)
  assert.deepEqual([row(report, ca.id).taxable, row(report, ca.id).charged, row(report, ca.id).early.reduced, row(report, ca.id).early.taxReduced], [98000, 8085, 2000, 165])
  assert.deepEqual([row(report, ny.id).taxable, row(report, ny.id).charged, row(report, ny.id).early.kept], [35000, 2800, 3500])
  assert.equal(report.ledger.ties, true)
  const cashReport = await h.view(`reports/sales-tax?from=${d0}&to=${day}&basis=cash`)
  assert.deepEqual([row(cashReport, ca.id).taxable, row(cashReport, ca.id).collected, row(cashReport, ca.id).early.reduced, row(cashReport, ny.id).taxable, row(cashReport, ny.id).collected, row(cashReport, ny.id).early.kept, cashReport.ledger.ties], [98000, 8085, 2000, 35000, 2800, 3500, true])
  assert.deepEqual(report.againstSuggestion.map(x => x.id), [wa.id])
  // A12: the nexus watch keeps gross sales.
  assert.equal(at((await h.view('sales-tax/nexus')).states, s => s.state === 'CA').sales, nexusBefore + 100000)

  // A3: issued twelve days ago the offer has ended: paying in full gets no discount, paying the early amount leaves $21.65 open.
  const d12 = addDays(day, -12)
  const a3full = await issue(await draft(d12, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await pay(a3full, day, '1082.50')
  const a3short = await issue(await draft(d12, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await h.command('invoice.send', { id: a3short.id }); const endedPage = linkIn(h.mail.at(-1))
  const endedBefore = (await h.send(endedPage)).value
  assert.match(endedBefore, /Current balance: \$1,082\.50/); assert.match(endedBefore, new RegExp(`Early-payment discount ended ${long(addDays(d12, 10))}\\.`))
  await pay(a3short, day, '1060.85')
  assert.deepEqual([(await discountOf(a3full.id)).length, (await discountOf(a3short.id)).length, (await invoiceOf(h, a3short.id)).open_cents], [0, 0, 2165])
  assert.match((await h.send(endedPage)).value, new RegExp(`Early-payment discount ended ${long(addDays(d12, 10))}\\.`))
  // A5: partial payments in the window add up; a second part after the window gives no discount.
  const a5 = await issue(await draft(d0, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await pay(a5, addDays(day, -3), '500.00')
  assert.equal((await discountOf(a5.id)).length, 0)
  await pay(a5, day, '560.85')
  assert.deepEqual([(await discountOf(a5.id))[0].issue_date, (await invoiceOf(h, a5.id)).open_cents], [day, 0])
  const a5late = await issue(await draft(d12, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await pay(a5late, addDays(d12, 5), '500.00'); await pay(a5late, day, '560.85')
  assert.deepEqual([(await discountOf(a5late.id)).length, (await invoiceOf(h, a5late.id)).open_cents], [0, 2165])
  // A6: an overpayment in the window is capped after the discount; the rest stays unapplied.
  const a6 = await issue(await draft(d0, [svc('1000.00', caB.id)], { earlyPayment: term }))
  const a6Pay = await pay(a6, day, '1082.50')
  const a6Row = at((await h.view('sales')).payments, p => p.id === a6Pay.id)
  assert.deepEqual([a6Row.unallocated_cents, (await invoiceOf(h, a6.id)).open_cents, (await discountOf(a6.id)).length], [2165, 0, 1])

  // F6: a client cannot mark a credit as a discount; an ordinary credit is never a discount and withdraws the offer.
  const f6 = await issue(await draft(addDays(day, -3), [svc('1000.00', caB.id)], { earlyPayment: term }))
  await h.command('invoice.send', { id: f6.id }); const f6Page = linkIn(h.mail.at(-1))
  const allowance = await issue(await h.command('invoice.save-draft', { kind: 'credit', creditFor: f6.id, customerId: customer, issueDate: day, dueDate: day, lines: [line('Allowance', '10.00', acct['4000'])], earlyDiscount: 1, early_discount: 1 }, bea))
  assert.deepEqual([allowance.early_discount, (await invoiceOf(h, f6.id)).early_withdrawn_by], [0, allowance.id])
  assert.match((await h.send(f6Page)).value, new RegExp(`Early-payment discount ended by ${allowance.number}\\.`))
  await pay(f6, day, '1050.85')
  assert.deepEqual([(await discountOf(f6.id)).length, (await invoiceOf(h, f6.id)).open_cents], [0, 2165])

  // F9 / F11: the issued invoice cannot change, and the discount credit is not reversed through journal.reverse.
  await h.command('invoice.save-draft', { id: a2.id, revision: (await invoiceOf(h, a2.id)).revision, customerId: customer, issueDate: d0, dueDate: addDays(d0, 30), lines: [svc('1.00', ca.id)] }, h.owner, 409)
  assert.equal((await invoiceOf(h, a2.id)).issued_pdf_sha256, shaBefore)
  await h.command('journal.reverse', { id: a2Credit.journal_id, date: day }, h.owner, 409)
  // A10: reversing the counted payment reverses the discount in the same write; the balance is $1,082.50 and nothing is granted again.
  await h.command('journal.reverse', { id: a2Pay.journal_id, date: day, memo: 'Check returned' })
  const reversedCredit = at((await h.view('sales')).invoices, i => i.id === a2Credit.id)
  assert.ok(reversedCredit.early_reversal_id)
  assert.deepEqual(await entryLines(reversedCredit.early_reversal_id), [['1200', 2165, 0], ['4950', 0, 2000], ['2200', 0, 165]])
  assert.deepEqual([(await invoiceOf(h, a2.id)).open_cents, (await discountOf(a2.id)).filter(x => !x.early_reversal_id).length], [108250, 0])
  report = await h.view(`reports/sales-tax?from=${d0}&to=${day}&basis=accrual`)
  assert.deepEqual([row(report, ca.id).taxable, row(report, ca.id).charged, row(report, ca.id).early.reduced, report.ledger.ties], [100000, 8250, 0, true])
  assert.equal((await h.view(`reports/receivables?to=${day}`)).agrees, true)
  assert.equal((await invoiceOf(h, a2.id)).issued_pdf_sha256, shaBefore); assert.equal((await h.send(a2Page + '/invoice.pdf')).value, pdfBefore)
  assert.equal((await h.view(`reports/sales-tax?from=${d0}&to=${day}&basis=cash`)).ledger.ties, true)

  // A8: Stripe Checkout in the window charges the early amount and expires by the end of the window day; card and ACH (settling after the window) both take the discount once.
  await h.command('stripe.connect', { secretKey: KEY })
  const d2 = addDays(day, -2)
  const card = await issue(await draft(d2, [svc('1000.00', caB.id)], { earlyPayment: term })), ach = await issue(await draft(d2, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await h.command('invoice.send', { id: card.id }); const cardPage = linkIn(h.mail.at(-1))
  await h.command('invoice.send', { id: ach.id }); const achPage = linkIn(h.mail.at(-1))
  assert.match((await h.send(cardPage)).value, new RegExp(`Pay \\$1,060\\.85 by ${long(addDays(d2, 10))}`))
  const started = Math.floor(Date.now() / 1000)
  await h.send(cardPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=card' })
  const s1 = sessions.get('cs_test_1'), expires = Number(s1.body.get('expires_at'))
  assert.equal(s1.body.get('line_items[0][price_data][unit_amount]'), '106085')
  assert.ok(expires >= started + 30 * 60 && expires <= started + 24 * 3600, 'Checkout expires within Stripe\'s limits and by the end of the window day')
  Object.assign(s1, { status: 'complete', pi: { id: 'pi_card', status: 'succeeded', amount_received: 106085, latest_charge: { id: 'ch_1', balance_transaction: { id: 'txn_1', amount: 106085, currency: 'usd', fee: 3100, exchange_rate: null, created: started } } } })
  await h.send(cardPage + '?checkout=cs_test_1')
  assert.deepEqual([(await discountOf(card.id)).length, (await invoiceOf(h, card.id)).open_cents], [1, 0])
  await h.send(achPage + '/pay', undefined, { headers: { 'content-type': 'application/x-www-form-urlencoded' }, raw: 'method=us_bank_account' })
  const s2 = sessions.get('cs_test_2')
  assert.equal(s2.body.get('line_items[0][price_data][unit_amount]'), '106085')
  Object.assign(s2, { status: 'complete', pi: { id: 'pi_ach', status: 'processing', amount_received: 0, latest_charge: null } })
  await h.send(achPage + '?checkout=cs_test_2')
  const settled = Math.floor(Date.parse(addDays(d2, 14) + 'T18:00:00Z') / 1000)
  s2.pi = { id: 'pi_ach', status: 'succeeded', amount_received: 106085, latest_charge: { id: 'ch_2', balance_transaction: { id: 'txn_2', amount: 106085, currency: 'usd', fee: 500, exchange_rate: null, created: settled } } }
  await h.cron()
  const [achCredit] = await discountOf(ach.id)
  assert.deepEqual([achCredit.issue_date, (await invoiceOf(h, ach.id)).open_cents], [addDays(d2, 14), 0])
  // F10: replaying the confirmations posts nothing twice.
  await h.send(cardPage + '?checkout=cs_test_1'); await h.send(achPage + '?checkout=cs_test_2'); await h.cron()
  assert.deepEqual([(await discountOf(card.id)).length, (await discountOf(ach.id)).length], [1, 1])

  // A9: PAY-004 matches a deposit of the early amount inside the window with its discount; undo reverses both; after the window it is not applied.
  const north = c['Northstar Consulting'].id
  const a9 = await issue(await draft(d0, [svc('1000.00', caB.id)], { earlyPayment: term }, bea, north))
  const a9late = await issue(await draft(d12, [svc('1000.00', caB.id)], { earlyPayment: term }, bea, north))
  const [y, m, dd] = day.split('-')
  const imported = await h.command('statement.import', { bankAccountId: bank.id, fileName: 'early.csv', content: `Date,Description,Amount\n${m}/${dd}/${y},DEPOSIT ${a9.number},1060.85\n${m}/${dd}/${y},DEPOSIT ${a9late.number},1060.85\n`,
    opening: '0.00', closing: '2121.70', start: day, end: day, confirmLast4: '4821' })
  assert.deepEqual(imported.automatic.matched.map(x => x.invoiceId), [a9.id])
  assert.deepEqual([(await discountOf(a9.id)).length, (await invoiceOf(h, a9.id)).open_cents, (await invoiceOf(h, a9late.id)).open_cents], [1, 0, 108250])
  await h.command('match.undo', { id: imported.automatic.matched[0].matchId })
  assert.deepEqual([(await discountOf(a9.id)).filter(x => !x.early_reversal_id).length, (await invoiceOf(h, a9.id)).open_cents], [0, 108250])

  // A11: a sale invoiced before the report's range is flagged as an earlier-period sale with its date and state.
  const monthStart = day.slice(0, 8) + '01', a11Issue = addDays(monthStart, -3)
  const a11 = await issue(await draft(a11Issue, [svc('1000.00', caB.id)], { earlyPayment: term }))
  await pay(a11, addDays(monthStart, 2), '1060.85')
  const monthly = await h.view(`reports/sales-tax?from=${monthStart}&to=${addDays(monthStart, 27)}&basis=accrual`)
  const flagged = at(monthly.earlyItems, i => i.invoice === a11.number)
  assert.deepEqual([flagged.earlierPeriod, flagged.label, flagged.invoiceDate, flagged.state, flagged.discount, flagged.taxReduced], [true, 'Sale in an earlier period', a11Issue, 'CA', 2000, 165])

  // F7: a payment dated in a locked month is refused.
  const close = await h.command('close.tasks', { period: '2025-12' })
  for (const task of close.tasks) await h.command('close.task', { id: task.id, revision: task.revision, done: true })
  await h.command('period.lock', { period: '2025-12' })
  const f7 = await issue(await draft(d0, [svc('100.00', caB.id)], { earlyPayment: term }))
  await h.command('payment.record', { direction: 'received', contactId: customer, date: '2025-12-15', amount: '106.08', bankAccountId: bank.id, allocations: [{ targetId: f7.id, amount: '106.08' }] }, h.owner, 409)

  // A13: a sending template's approval covers its term and treatment revisions; a treatment change makes the next occurrence a draft that says why.
  const template = await h.command('recurring.save', { customerId: customer, startDate: day, unit: 'month', every: 1, mode: 'send', termsDays: 30, lines: [svc('500.00', caB.id)], earlyPayment: term })
  await h.command('recurring.approve', { id: template.id, revision: template.revision }, ann)
  await treat(caB, 'retain', { reason: 'The accountant keeps the tax on this code' })
  await h.cron()
  const run = (await h.view('sales')).recurring.find(r => r.id === template.id).runs_list[0]
  assert.equal(run.status, 'drafted'); assert.match(run.detail, /early-payment treatment changed/)
})
