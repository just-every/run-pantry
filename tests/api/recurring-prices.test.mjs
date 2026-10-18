// INVOICE-005 journeys use the actual Worker, native sessions, D1 and Cron.
// Only the harness's outbound mail endpoint is faked.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date())
const addDays = (day, n) => new Date(Date.parse(day + 'T00:00:00Z') + n * 86400000).toISOString().slice(0, 10)
// The first of the month avoids short-month clipping when counting back.
const month = (day, n) => { const [y, m] = day.split('-').map(Number); return new Date(Date.UTC(y, m - 1 + n, 1)).toISOString().slice(0, 10) }
const line = (accountId, rate) => ({ description: 'Monthly retainer', quantity: '1', rate, accountId, taxCode: 'exempt' })
const recurring = async (h, id) => at((await h.view('sales')).recurring, t => t.id === id)
const invoices = async (h, id) => (await h.view('sales')).invoices.filter(i => i.recurring_id === id).sort((a, b) => a.issue_date.localeCompare(b.issue_date))

test('INVOICE-005 recurring invoices retain three approved $2,400 months before a chosen price date, then wait for approval at the changed price', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h), day = today(), start = month(day, -3), fourth = month(day, 0)
  const c = await h.command('contact.save', { kind: 'customer', name: 'Retainer customer', email: 'billing@retainer.example', termsDays: 30 })
  const preparer = await h.member('preparer@example.test', 'accountant', { canPost: true })
  const approver = await h.member('approver@example.test', 'accountant', { canPost: true })
  const viewer = await h.member('viewer@example.test', 'viewer')
  let template = await h.command('recurring.save', { customerId: c.id, startDate: start, every: 1, unit: 'month', mode: 'send', lines: [line(acct['4000'], '2400.00')] }, preparer)
  await h.cron()
  assert.equal((await invoices(h, template.id)).length, 0, 'an unapproved sending template does not generate invoices')
  await h.command('recurring.approve', { id: template.id, revision: template.revision }, preparer, 403)
  template = await h.command('recurring.approve', { id: template.id, revision: template.revision }, approver)

  const change = { id: template.id, revision: template.revision, effectiveDate: fourth, lines: [line(acct['4000'], '2600.00')] }
  assert.equal((await h.send('/api/pantry/command/recurring.price', change)).status, 401)
  await h.command('recurring.price', change, viewer, 403)
  const price = await h.command('recurring.price', change, preparer)
  await h.command('recurring.approve-price', { id: price.id, revision: price.revision, templateRevision: template.revision }, preparer, 403)
  await h.command('recurring.approve-price', { id: price.id, revision: template.revision, templateRevision: template.revision }, approver, 409)

  await Promise.all([h.cron(), h.cron()])
  const generated = await invoices(h, template.id)
  assert.deepEqual(generated.map(i => [i.issue_date, i.total_cents, i.status]), [
    [start, 240000, 'issued'], [month(start, 1), 240000, 'issued'], [month(start, 2), 240000, 'issued'], [fourth, 260000, 'draft'],
  ])
  assert.ok(generated.slice(0, 3).every(i => i.approved_by === 'approver@example.test' && i.sent_at))
  assert.equal(generated[3].approved_by, null); assert.equal(generated[3].sent_at, null)
  const mails = h.mail.filter(m => m.subject.startsWith('Invoice '))
  assert.equal(mails.length, 3); assert.ok(mails.every(m => m.to[0] === c.email && m.subject.includes('$2,400.00')))
  const state = await recurring(h, template.id)
  assert.equal(state.prices[0].effective_date, fourth)
  assert.match(at(state.runs_list, r => r.occurrence === fourth).detail, /price changed.*approval/i)
  await h.command('recurring.price', { ...change, effectiveDate: start }, preparer, 409)
  assert.deepEqual((await invoices(h, template.id)).map(i => i.total_cents), [240000, 240000, 240000, 260000], 'a rejected retroactive change cannot rewrite invoices')

  // Each changed occurrence can use the ordinary invoice approval door.
  await h.command('invoice.approve', { id: generated[3].id, revision: generated[3].revision }, preparer, 403)
  const approved = await h.command('invoice.approve', { id: generated[3].id, revision: generated[3].revision }, approver)
  await h.command('invoice.issue', { id: approved.id }, approver)
  await h.command('invoice.send', { id: approved.id }, approver)
  await h.cron()
  assert.equal(h.mail.filter(m => m.subject.startsWith('Invoice ')).length, 4, 'Cron does not recreate or resend any occurrence')
  assert.equal((await invoices(h, template.id)).length, 4)
})

test('INVOICE-005 approving a dated price authorises its exact future amounts; schedules, pause, end and failed sends remain visible', async t => {
  let rejectMail = false
  const submissions = []
  const h = await harness({ bindings: { MAIL_PROVIDER: 'sendgrid' }, outbound: async request => {
    assert.equal(request.url, 'https://api.sendgrid.com/v3/mail/send')
    submissions.push(await request.json())
    return new Response(null, { status: rejectMail ? 400 : 202 })
  } }); t.after(() => h.close())
  const { acct } = await books(h), day = today()
  const c = await h.command('contact.save', { kind: 'customer', name: 'Scheduled customer', email: 'scheduled@example.test' })
  const create = (values = {}) => h.command('recurring.save', { customerId: c.id, startDate: day, every: 1, unit: 'month', mode: 'draft', lines: [line(acct['4000'], '2400.00')], ...values })
  let sending = await create({ mode: 'send' })
  sending = await h.command('recurring.approve', { id: sending.id, revision: sending.revision })
  const price = await h.command('recurring.price', { id: sending.id, revision: sending.revision, effectiveDate: day, lines: [line(acct['4000'], '2750.00')] })
  await h.command('recurring.approve-price', { id: price.id, revision: price.revision, templateRevision: sending.revision })
  await h.command('recurring.status', { id: sending.id, status: 'paused' })
  await h.cron()
  assert.equal((await invoices(h, sending.id)).length, 0)
  await h.command('recurring.status', { id: sending.id, status: 'active' })
  await h.cron()
  const [changed] = await invoices(h, sending.id)
  assert.equal(changed.status, 'issued'); assert.equal(changed.total_cents, 275000); assert.ok(changed.sent_at)
  assert.equal((await recurring(h, sending.id)).prices[0].approved_by, 'owner@example.test')

  // A late weekly schedule catches up; quarterly and yearly schedules honour
  // their end condition, and all draft-mode invoices still require approval.
  const weekly = await create({ startDate: addDays(day, -14), endDate: day, unit: 'week' })
  const quarterly = await create({ every: 3, endDate: day })
  const yearly = await create({ unit: 'year', endDate: day })
  await h.cron()
  assert.deepEqual((await invoices(h, weekly.id)).map(i => [i.issue_date, i.status]), [[addDays(day, -14), 'draft'], [addDays(day, -7), 'draft'], [day, 'draft']])
  for (const id of [weekly.id, quarterly.id, yearly.id]) {
    const state = await recurring(h, id)
    assert.equal(state.status, 'ended'); assert.equal(state.next_date, null)
    assert.ok((await invoices(h, id)).every(i => i.status === 'draft' && !i.sent_at))
  }
  assert.equal((await invoices(h, quarterly.id)).length, 1); assert.equal((await invoices(h, yearly.id)).length, 1)

  // The real mail adapter receives a provider rejection. Its issued invoice
  // and failure reason remain available through sales.
  let failed = await create({ mode: 'send', endDate: day })
  failed = await h.command('recurring.approve', { id: failed.id, revision: failed.revision })
  rejectMail = true
  await h.cron()
  const failedState = await recurring(h, failed.id)
  assert.equal(failedState.runs_list[0].status, 'failed')
  assert.match(failedState.runs_list[0].detail, /sending was rejected.*provider_rejected/i)
  const [failedInvoice] = await invoices(h, failed.id)
  assert.equal(failedInvoice.status, 'issued'); assert.equal(failedInvoice.sent_at, null)
  const delivery = at((await h.view('sales')).deliveries, d => d.invoice_id === failedInvoice.id)
  assert.equal(delivery.status, 'rejected')
  assert.ok(submissions.some(m => m.subject.includes(failedInvoice.number)), 'the send reached the provider edge')
  const attempts = submissions.length
  await h.cron()
  assert.equal((await invoices(h, failed.id)).length, 1)
  assert.equal(submissions.length, attempts, 'the failed occurrence is not sent again without a person choosing to resend')
})
