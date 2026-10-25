import assert from 'node:assert/strict'
import { Log, LogLevel } from 'miniflare'
import { books, harness } from './harness.mjs'
const details = {
  legalName: 'Synthetic contractor',
  businessName: 'Synthetic services',
  classification: 'individual',
  tinKind: 'ein',
  tin: '000000123',
  address: '1 Synthetic Lane',
  city: 'Albany',
  state: 'NY',
  zip: '12207',
  signature: 'Synthetic contractor',
  certify: 'yes',
}
export async function w9Journey(t) {
  const logs = []
  class CapturedLog extends Log { log(message) { logs.push(message) } }
  const h = await harness({ log: new CapturedLog(LogLevel.INFO) })
  t.after(() => h.close())
  const { acct } = await books(h),
    v = await h.command('contact.save', { kind: 'vendor', name: 'Synthetic contractor', is1099: true }),
    bank = await h.command('bank-account.save', {
      name: 'Synthetic checking',
      institution: 'Example',
      accountId: acct['1000'],
      numberLast4: '0123',
      openingDate: '2025-01-01',
      openingBalance: '0',
    })
  await h.command('payment.record', {
    direction: 'paid',
    contactId: v.id,
    date: '2025-06-01',
    amount: '2400',
    bankAccountId: bank.id,
    method: 'ach',
  })
  const keeper = await h.member('synthetic-pantry-keeper@example.test', 'bookkeeper'),
    sales = await h.member('synthetic-pantry-sales@example.test', 'sales')
  await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true }, keeper, 403)
  await h.command('w9.request', { contactId: v.id }, h.owner, 400)
  const mailBeforeRequests = h.mail.length
  const first = await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true }),
    request = await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true }),
    path = new URL(request.url).pathname
  assert.equal((await h.send(new URL(first.url).pathname)).status, 404)
  assert.equal((await h.send(path)).status, 200)
  assert.equal((await h.send(path)).headers.get('referrer-policy'), 'strict-origin')
  const post = (body, headers = {}) =>
    h.send(path, undefined, {
      raw: new URLSearchParams(body).toString(),
      headers: { 'content-type': 'application/x-www-form-urlencoded', ...headers },
    })
  assert.equal((await post({ ...details, certify: '' })).status, 400)
  assert.equal((await post(details, { origin: 'https://example.test' })).status, 403)
  assert.equal((await post({ ...details, tin: 'bad' })).status, 400)
  assert.equal((await h.view('missing-w9?year=2025')).vendors[0].id, v.id)
  assert.equal((await h.view('year-end/2025')).checks.find((c) => c.key === 'year-end-w9').ok, false)
  assert.equal((await post(details)).status, 200)
  assert.equal((await post(details)).status, 404, 'one-use submission')
  assert.equal((await h.send(path)).status, 404)
  assert.equal((await h.view(`vendor-w9/${v.id}`, keeper)).status, 'complete')
  assert.equal((await h.view('missing-w9?year=2025')).vendors.length, 0)
  assert.equal((await h.view('year-end/2025')).checks.find((c) => c.key === 'year-end-w9').ok, true)
  const stored = await h.db.prepare('SELECT * FROM pt_contractor_tax WHERE contact_id=?').bind(v.id).first()
  assert.equal(stored.tin_last4, '0123')
  assert.ok(!JSON.stringify(stored).includes(details.tin))
  assert.ok(!stored.w9_evidence_sealed.includes(details.signature))
  assert.ok(!JSON.stringify(await h.view('reports/contractors?year=2025', keeper)).includes(details.tin))
  await h.command('w9.evidence', { contactId: v.id }, keeper, 403)
  await h.command('w9.evidence', { contactId: v.id }, h.owner, 403)
  assert.equal(h.mail.length, mailBeforeRequests, 'requests, certification and reads send nothing')
  const accountant = await h.member('synthetic-pantry-w9-cpa@example.test', 'accountant')
  await h.command('w9.evidence', { contactId: v.id }, accountant, 403)
  await h.command('contractor.step-up', {})
  const mail = h.mail.findLast((m) => [m.to].flat().includes('owner@example.test')),
    token = new URL(mail.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get(
      'token',
    )
  assert.equal((await h.send('/auth/confirm', { token }, { cookie: h.owner })).status, 303)
  assert.equal((await h.command('contractor.reveal', { contactId: v.id })).tin, details.tin)
  assert.equal((await h.command('w9.evidence', { contactId: v.id })).evidence.electronicConsent, true)
  await h.view(`vendor-w9/${v.id}`, sales, 403)
  const audit = await h.view('activity')
  assert.ok(!JSON.stringify(audit).includes(details.tin))
  const revoked = await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true })
  await h.command('w9.revoke', { contactId: v.id })
  assert.equal((await h.send(new URL(revoked.url).pathname)).status, 404)
  const stale = await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true })
  const changedVendor = await h.command('contact.save', { ...v, kind: 'vendor', name: 'Changed contractor' })
  assert.equal((await h.send(new URL(stale.url).pathname)).status, 404)
  await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true }, h.owner, 409)
  const expired = await h.send('/api/pantry/command/w9.request', { contactId: v.id, contactRevision: changedVendor.revision, consent: true }, { cookie: h.owner, headers: { 'x-synthetic-pantry-clock': '2026-02-01T12:00:00Z' } })
  assert.equal(expired.status, 200)
  assert.equal(expired.value.expiresAt, '2026-02-15T12:00:00.000Z')
  const oldPath = new URL(expired.value.url).pathname
  for (const [clock, status] of [['2026-02-15T11:00:00Z', 200], ['2026-02-15T12:00:00Z', 404], ['2026-02-15T13:00:00Z', 404]]) {
    assert.equal((await h.send(oldPath, undefined, { headers: { 'x-synthetic-pantry-clock': clock } })).status, status)
  }
  const reissued = await h.send('/api/pantry/command/w9.request', { contactId: v.id, contactRevision: changedVendor.revision, consent: true }, { cookie: h.owner, headers: { 'x-synthetic-pantry-clock': '2026-02-15T13:00:00Z' } })
  assert.equal(reissued.status, 200)
  assert.notEqual(reissued.value.url, expired.value.url)
  assert.equal((await h.send(new URL(reissued.value.url).pathname, undefined, { headers: { 'x-synthetic-pantry-clock': '2026-02-15T13:00:00Z' } })).status, 200)
  assert.equal((await h.send(oldPath)).status, 404)
  assert.ok(!JSON.stringify(await h.view('tax-readiness/2025/package')).includes(details.tin))
  assert.ok(!JSON.stringify(h.mail).includes(details.tin))
  assert.ok(!JSON.stringify(await h.view('activity')).includes(details.tin))
  assert.ok(!JSON.stringify(reissued.value).includes(details.tin))
  assert.ok(!JSON.stringify(logs).includes(details.tin))
  const requests = await h.db.prepare('SELECT token_hash FROM pt_w9_requests WHERE token_hash IS NOT NULL').all()
  assert.ok(requests.results.every(r => !reissued.value.url.includes(r.token_hash)), 'only hashes are stored')

}
export async function readinessJourney(t) {
  const h = await harness()
  t.after(() => h.close())
  const { acct } = await books(h),
    v = await h.command('contact.save', { kind: 'vendor', name: 'Synthetic tax-ready contractor' }),
    customer = await h.command('contact.save', { kind: 'customer', name: 'Synthetic NJ customer' }),
    bank = await h.command('bank-account.save', {
      name: 'Checking',
      institution: 'Example',
      accountId: acct['1000'],
      numberLast4: '0123',
      openingDate: '2025-01-01',
      openingBalance: '0',
    })
  await h.command('payment.record', {
    direction: 'paid',
    contactId: v.id,
    date: '2025-06-01',
    amount: '2400',
    bankAccountId: bank.id,
    method: 'ach',
  })
  const inv = await h.command('invoice.save-draft', {
    customerId: customer.id,
    issueDate: '2025-09-01',
    destinationState: 'NJ',
    lines: [
      {
        description: 'Synthetic services',
        quantity: '1',
        rate: '85000',
        accountId: acct['4000'],
        taxCode: 'exempt',
      },
    ],
  })
  await h.command('invoice.approve', { id: inv.id, revision: inv.revision })
  await h.command('invoice.issue', { id: inv.id })
  const solo = await h.command('tax.deadline', { label: 'Solo owner estimate', dueDate: '2026-01-25', amount: '250' })
  assert.equal((await h.view('tax-readiness?year=2025')).canSetDeadlines, true)
  const accountant = await h.member('synthetic-pantry-cpa@example.test', 'accountant'),
    keeper = await h.member('synthetic-pantry-book@example.test', 'bookkeeper')
  await h.command(
    'tax.deadline',
    { label: 'Accountant estimated tax', dueDate: '2026-01-20', amount: '400' },
    h.owner,
    403,
  )
  const d = await h.command(
    'tax.deadline',
    { label: 'Accountant estimated tax', dueDate: '2026-01-20', amount: '400' },
    accountant,
  )
  const read = async (path, clock = '2026-01-15T12:00:00Z') => {
    const r = await h.send('/api/pantry/' + path, undefined, {
      cookie: accountant,
      headers: { 'x-synthetic-pantry-clock': clock },
    })
    assert.equal(r.status, 200, JSON.stringify(r.value))
    return r.value
  }
  const mailBeforeReadiness = h.mail.length
  const activityBefore = await h.db.prepare('SELECT (SELECT COUNT(*) FROM pt_payments) AS payments,(SELECT COUNT(*) FROM pt_journal_entries) AS entries,(SELECT COUNT(*) FROM pt_w9_requests) AS requests').first()
  const before = await read('tax-readiness?year=2025', '2025-12-20T23:59:59Z')
  assert.equal(before.deadlines.find(x => x.id === d.id).reminder, false)
  for (let repeat = 0; repeat < 2; repeat++) {
    const boundary = await read('tax-readiness?year=2025', '2025-12-21T00:00:00Z')
    assert.equal(boundary.deadlines.filter(x => x.id === d.id && x.reminder).length, 1)
  }
  const r = await read('tax-readiness?year=2025')
  assert.equal(r.canSetDeadlines, true)
  assert.equal((await h.view('tax-readiness?year=2025')).canSetDeadlines, false)
  assert.equal(r.deadlines.find(x => x.id === solo.id).isEstimate, true)
  assert.match(r.note, /never tax advice or a filing/)
  assert.equal(h.mail.length, mailBeforeReadiness)
  assert.deepEqual(await h.db.prepare('SELECT (SELECT COUNT(*) FROM pt_payments) AS payments,(SELECT COUNT(*) FROM pt_journal_entries) AS entries,(SELECT COUNT(*) FROM pt_w9_requests) AS requests').first(), activityBefore)
  assert.equal(r.w9Proposals[0].paid, 240000)
  assert.equal(r.w9Proposals[0].requiresOwnerApproval, true)
  assert.equal(r.nexus.find((s) => s.state === 'NJ').reached, 8500)
  assert.equal(r.deadlines.find((x) => x.id === d.id).amount_cents, 40000)
  assert.equal(r.deadlines.find((x) => x.id === d.id).reminder, true)
  assert.equal(r.deadlines.find((x) => x.id === 'nec-2025').reminder, true)
  await h.view('tax-readiness?year=2025', keeper, 403)
  const entry = await h.command('journal.save-draft', {
    date: '2025-12-31',
    memo: 'Synthetic open question',
    lines: [
      { accountId: acct['6000'], debit: '10' },
      { accountId: acct['1000'], credit: '10' },
    ],
  })
  await h.command('journal.post', { id: entry.id, revision: entry.revision })
  const question = (
    await h.command('question.ask', {
      subjectKind: 'journal',
      subjectId: entry.id,
      question: 'Please review the tax classification.',
      assignee: 'synthetic-pantry-cpa@example.test',
    })
  ).question
  const pack = await read('tax-readiness/2025/package')
  assert.ok(pack.openQuestions.some((q) => q.id === question.id))
  assert.equal(pack.yearEnd.year, 2025)
  assert.equal(pack.accountantPackage.period.id, '2025-12')
  assert.equal(pack.readiness.w9Proposals[0].contactId, v.id)
  await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true }, accountant, 403)
  await h.command('w9.request', { contactId: v.id, contactRevision: 'synthetic-pantry-stale', consent: true }, h.owner, 409)
  const request = await h.command('w9.request', { contactId: v.id, contactRevision: v.revision, consent: true })
  assert.equal(h.mail.length, mailBeforeReadiness + 1, 'only the explicit question action sent mail')
  const settingsAudit = (await h.view('activity')).audit.filter(e => e.action === 'tax.deadline')
  assert.equal(settingsAudit.length, 2)
  await h.command('member.save', { email: 'synthetic-pantry-cpa@example.test', name: 'Synthetic CPA', role: 'accountant', active: false })
  const ownerReadiness = await h.view('tax-readiness?year=2025')
  assert.equal(ownerReadiness.canSetDeadlines, true)
  const current = ownerReadiness.deadlines.find(x => x.id === d.id)
  await h.command('tax.deadline', { id: d.id, revision: current.revision, label: current.label, dueDate: '2026-01-21', amount: '450' })
  await h.command('tax.deadline', { id: d.id, revision: current.revision, label: current.label, dueDate: '2026-01-22', amount: '500' }, h.owner, 409)
  assert.equal((await h.view('activity')).audit.filter(e => e.action === 'tax.deadline').length, 3)
  assert.equal((await h.view('tax-readiness?year=2025')).deadlines.find(x => x.id === d.id).amount_cents, 45000)
  assert.equal((await h.send(new URL(request.url).pathname)).status, 200)
  assert.equal((await h.view('tax-readiness?year=2025')).w9Proposals[0].status, 'requested')
}
