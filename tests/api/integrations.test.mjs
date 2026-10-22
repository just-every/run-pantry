import test from 'node:test'
import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

const financialReports = ['trial-balance', 'general-ledger', 'profit-and-loss', 'balance-sheet', 'sales-by-customer', 'expenses-by-vendor', 'sales-by-item', 'cash-flow', 'sales-tax', 'receivables', 'payables', 'receivables-summary', 'payables-summary', 'open-invoices', 'unpaid-bills', 'customer-balances', 'vendor-balances', 'transactions', 'journal', 'deposits', 'check-detail', 'reconciliations', 'contractor-summary']

test('REPORT-002 / API-001 a scoped sibling posts once, readies its bill, reads payment after owner expiry, and loses access on revocation', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Community Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-10-01', openingBalance: '0.00' })
  const scopes = ['contacts:write', 'bills:write', 'invoices:write', 'journals:write', 'documents:write', 'payments:read', 'payments:write', 'reports:read', 'post']
  const credential = await h.command('integration.create', { name: 'Pier warehouse', scopes })
  const call = async (path, body, key, status = 200, token = credential.token) => {
    const r = await h.send('/api/pantry/integration/v1/' + path, body, { headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) } })
    assert.equal(r.status, status, `${path}: ${JSON.stringify(r.value)}`)
    return r.value
  }
  const vendor = await call('contacts', { externalId: 'harbor-ceramics', kind: 'vendor', name: 'Harbor Ceramics', termsDays: 30 }, 'vendor')
  const updated = await call('contacts', { externalId: 'harbor-ceramics', kind: 'vendor', name: 'Harbor Ceramics LLC', termsDays: 15 }, 'vendor-update')
  assert.equal(updated.id, vendor.id)
  assert.equal(updated.terms_days, 15)
  const body = { vendorId: vendor.id, reference: 'HC-7731', billDate: '2026-10-17', post: true, lines: [{ description: '48 ceramic mugs and inbound freight', accountId: acct['6100'], amount: '482.00' }] }
  const [a, b] = await Promise.all([call('bills', body, 'receipt-7731'), call('bills', { ...body }, 'receipt-7731')])
  assert.equal(a.id, b.id)
  assert.equal(a.status, 'posted')
  assert.equal((await h.view('sales')).bills.length, 1)
  await call('bills', { ...body, reference: 'HC-CHANGED' }, 'receipt-7731', 409)
  await call('bills', body, undefined, 400)
  const ready = await call(`bills/${a.id}/readiness`, { received: true, readyToPay: true }, 'receipt-ready')
  assert.equal(ready.received, 1)
  assert.equal(ready.ready_to_pay, 1)
  assert.equal((await call(`bills/${a.id}/readiness`, { readyToPay: true, received: true }, 'receipt-ready')).id, a.id)
  await call(`bills/${a.id}/readiness`, { received: false, readyToPay: true }, 'bad-readiness', 400)
  const source = Buffer.from('Harbor Ceramics HC-7731\n48 mugs x $9.50 = $456.00; freight $26.00; total $482.00\n')
  const document = await call('documents', { name: 'HC-7731.txt', mediaType: 'text/plain', base64: source.toString('base64'), linkedKind: 'bill', linkedId: a.id }, 'source-invoice')
  const raw = await h.send('/api/pantry/integration/v1/documents/' + document.id, undefined, { headers: { authorization: `Bearer ${credential.token}` } })
  assert.equal(raw.value, source.toString())
  assert.equal(raw.headers.get('x-ratelimit-limit'), '120', 'original-byte downloads retain the API-001 quota headers')
  assert.equal((await call('documents', { name: 'HC-7731.txt', mediaType: 'text/plain', base64: source.toString('base64'), linkedKind: 'bill', linkedId: a.id }, 'source-invoice')).id, document.id)
  const payment = await h.command('payment.record', { direction: 'paid', contactId: vendor.id, date: '2026-10-17', amount: '482.00', method: 'ach', bankAccountId: bank.id, allocations: [{ targetId: a.id, amount: '482.00' }] })
  const payments = await call('payments?billId=' + a.id)
  assert.equal(payments.payments[0].id, payment.id)
  assert.equal(payments.payments[0].allocations[0].target_id, a.id)
  assert.equal((await call('bills?id=' + a.id)).bills[0].open_cents, 0)
  const customer = await call('contacts', { externalId: 'cedar', kind: 'customer', name: 'Cedar Studio' }, 'customer')
  const invoiceBody = { customerId: customer.id, number: 'PIER-01', issueDate: '2026-10-17', post: true, lines: [{ description: 'Mugs', rate: '40.00', quantity: '1', accountId: acct['4000'], taxCode: 'exempt' }] }
  const invoice = await call('invoices', invoiceBody, 'invoice')
  assert.equal(invoice.status, 'issued')
  assert.equal((await call('invoices', invoiceBody, 'invoice')).id, invoice.id)
  for (const basis of ['cash', 'accrual']) {
    const scoped = await call(`reports/trial-balance?to=2026-10-17&basis=${basis}`)
    const native = await h.view(`reports/trial-balance?to=2026-10-17&basis=${basis}`)
    assert.deepEqual(scoped, native, 'scoped and native reports read the same basis and ledger')
    assert.equal(scoped.rows.find(r => r.code === '4000')?.net ?? 0, basis === 'cash' ? 0 : -4000)
  }
  assert.equal((await call('reports/trial-balance?to=2026-10-17')).basis, 'cash', 'scoped report defaults to the declared tax method')
  await call('reports/trial-balance?to=2026-10-17&basis=other', undefined, undefined, 400)
  const writer = await h.command('integration.create', { name: 'Pier Stripe receipts', scopes: ['payments:write', 'post'] })
  const readOnly = await h.command('integration.create', { name: 'Payment readback', scopes: ['payments:read', 'post'] })
  const noPost = await h.command('integration.create', { name: 'Payments without posting', scopes: ['payments:write'] })
  assert.equal((await call('state', undefined, undefined, 200, writer.token)).bankAccounts[0].id, bank.id)
  assert.equal((await call('state', undefined, undefined, 200, readOnly.token)).bankAccounts[0].id, bank.id)
  const receiptBody = { direction: 'received', contactId: customer.id, date: '2026-10-17', amount: '40.00', bankAccountId: bank.id, reference: 'stripe:payment-intent-cedar', allocations: [{ targetId: invoice.id, amount: '40.00' }] }
  await call('payments', receiptBody, 'read-only-payment', 403, readOnly.token)
  await call('payments', receiptBody, 'unapproved-payment', 403, noPost.token)
  await call('payments', { ...receiptBody, post: false }, 'draft-payment', 400, writer.token)
  await call('payments', receiptBody, undefined, 400, writer.token)
  // Parallel delivery and an unchanged replay must not allocate the receipt twice.
  const [receipt, duplicate] = await Promise.all([call('payments', receiptBody, 'stripe-receipt', 200, writer.token), call('payments', receiptBody, 'stripe-receipt', 200, writer.token)])
  assert.equal(duplicate.id, receipt.id)
  assert.equal(receipt.allocations[0].target_id, invoice.id)
  assert.equal(receipt.allocations[0].amount_cents, 4000)
  assert.equal((await call('invoices?id=' + invoice.id)).invoices[0].open_cents, 0)
  assert.equal((await call('payments', receiptBody, 'stripe-receipt', 200, writer.token)).id, receipt.id)
  await call('payments', { ...receiptBody, reference: 'different-payment' }, 'stripe-receipt', 409, writer.token)
  // A caller that lost its response can locate the exact reference without a session.
  const recovered = await call('payments?reference=' + encodeURIComponent(receiptBody.reference), undefined, undefined, 200, writer.token)
  assert.deepEqual(recovered.payments.map(p => p.id), [receipt.id])
  assert.equal(recovered.payments[0].allocations[0].target_id, invoice.id)
  assert.equal((await call('payments?id=' + receipt.id, undefined, undefined, 200, readOnly.token)).payments[0].id, receipt.id)
  assert.equal((await call('payments?reference=stripe%3Apayment-intent', undefined, undefined, 200, writer.token)).payments.length, 0)
  await h.command('integration.revoke', { id: writer.id })
  await call('payments', receiptBody, 'stripe-receipt', 401, writer.token)
  await call('payments', { ...receiptBody, reference: 'revoked-payment' }, 'revoked-receipt', 401, writer.token)
  const journalBody = { date: '2026-10-17', memo: 'Pier COGS', post: true, lines: [{ accountId: acct['6100'], debit: '10.00' }, { accountId: acct['1000'], credit: '10.00' }] }
  const journal = await call('journals', journalBody, 'cogs')
  assert.equal(journal.status, 'posted')
  assert.equal((await call('journals', journalBody, 'cogs')).id, journal.id)
  const limited = await h.command('integration.create', { name: 'Pier replacement without posting', scopes: ['bills:write', 'contacts:write'] })
  assert.equal((await call('state', undefined, undefined, 200, limited.token)).bankAccounts, undefined)
  const linked = await call('contacts', { externalId: 'harbor-ceramics', kind: 'vendor', name: 'Harbor Ceramics LLC' }, 'vendor-link', 200, limited.token)
  assert.equal(linked.id, vendor.id)
  assert.equal(linked.terms_days, 15)
  await call('journals', journalBody, 'forbidden', 403, limited.token)
  await call('bills', body, 'forbidden-post', 403, limited.token)
  const draft = await call('bills', { ...body, reference: 'DRAFT', post: false }, 'draft', 200, limited.token)
  assert.equal(draft.status, 'draft')
  assert.equal((await h.send('/api/pantry/state', undefined, { headers: { authorization: `Bearer ${credential.token}` } })).status, 401)
  assert.equal((await h.send('/api/pantry/command/member.save', { email: 'intruder@example.test' }, { headers: { authorization: `Bearer ${credential.token}` } })).status, 401)
  // Exercise the locked-period refusal without needing an unrelated month's close workflow.
  await h.db.prepare("INSERT INTO pt_periods (id,start_date,end_date,status,revision) VALUES ('2026-11','2026-11-01','2026-11-30','locked','locked')").run()
  const locked = await call('bills', { ...body, billDate: '2026-11-01' }, 'locked', 409)
  assert.match(locked.error, /locked/i)
  await call('payments', { ...receiptBody, date: '2026-11-01' }, 'locked-payment', 409)
  // The bearer remains useful when the same owner's ordinary session has expired.
  await h.db.prepare('UPDATE oa_sessions SET expires_at = 0').run()
  await h.view('state', h.owner, 401)
  assert.equal((await call('payments?billId=' + a.id)).payments[0].id, payment.id)
  assert.equal((await call('bills', body, 'receipt-7731')).open_cents, 0)
  // Restore only the test owner's session to exercise the real owner revocation door.
  await h.db.prepare('UPDATE oa_sessions SET expires_at = ?').bind(Date.now() + 60_000).run()
  const audit = await h.view('integrations')
  assert.ok(audit.calls.some(c => c.path.endsWith('/journals') && c.status === 403))
  assert.ok(audit.calls.some(c => c.path.endsWith('/bills') && c.status === 409))
  assert.equal(audit.credentials[0].token, undefined)
  assert.ok(!JSON.stringify(audit).includes(credential.token))
  await h.command('integration.revoke', { id: credential.id })
  await call('payments', undefined, undefined, 401)
  assert.equal((await h.view('integrations')).calls[0].status, 401)
})

test('API-001 OpenAPI discovery describes the implemented v1 doors and invoice-only credentials create, read, page and replay without journal access', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Maple Street Workshop' })
  const credential = await h.command('integration.create', { name: 'Invoice importer', scopes: ['invoices:write'] })
  const base = '/api/pantry/integration/v1'
  const request = (path, body, key, token = credential.token) => h.send(base + path, body, { headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) } })
  assert.equal((await h.send(base + '/openapi.json')).status, 401)
  assert.equal((await h.send(base + '/openapi.json', undefined, { cookie: h.owner })).status, 401, 'a native session is not an integration credential')
  const schemaResponse = await request('/openapi.json')
  assert.equal(schemaResponse.status, 200)
  assert.match(schemaResponse.headers.get('content-type'), /application\/json/)
  const schema = schemaResponse.value
  const { default: SwaggerParser } = await import('@apidevtools/swagger-parser')
  await SwaggerParser.validate(structuredClone(schema))
  const server = schema.servers[0].url
  assert.equal(server, base)
  assert.equal(schema.openapi, '3.1.0')
  assert.equal(schema.paths['/reports/trial-balance'].get.operationId, 'getTrialBalance', 'existing discovery operation stays compatible')
  assert.deepEqual(schema.security, [{ integrationBearer: [] }])
  // The caller discovers paths and required headers from the public document.
  const invoicePath = Object.keys(schema.paths).find(path => schema.paths[path].post?.operationId === 'createinvoices')
  const journalPath = Object.keys(schema.paths).find(path => schema.paths[path].post?.operationId === 'createjournals')
  assert.ok(invoicePath); assert.ok(journalPath)
  assert.equal(schema.paths[invoicePath].post.parameters.find(p => p.name === 'Idempotency-Key').required, true)
  const body = { customerId: customer.id, issueDate: '2026-10-17', number: 'MAPLE-101', lines: [{ description: 'October services', accountId: acct['4000'], quantity: '2', rate: '125.00', taxCode: 'exempt' }] }
  const [first, duplicate] = await Promise.all([request(invoicePath, body, 'maple-101'), request(invoicePath, body, 'maple-101')])
  assert.equal(first.status, 200, JSON.stringify(first.value))
  assert.equal(duplicate.status, 200, JSON.stringify(duplicate.value))
  assert.equal(first.value.id, duplicate.value.id)
  assert.equal(first.value.status, 'draft')
  assert.equal(first.value.total_cents, 25000)
  const readback = await request(invoicePath + '?id=' + encodeURIComponent(first.value.id))
  assert.equal(readback.status, 200)
  assert.deepEqual(readback.value.invoices.map(i => i.id), [first.value.id])
  assert.equal(readback.value.invoices[0].total_cents, first.value.total_cents)
  assert.equal((await request(invoicePath, { ...body, memo: 'changed' }, 'maple-101')).status, 409)
  assert.equal((await request(invoicePath, body)).status, 400)
  assert.equal((await request(invoicePath, { ...body, number: 'MAPLE-POST', post: true }, 'maple-post')).status, 403)
  assert.equal((await request(journalPath)).status, 403)
  const journalBody = { date: '2026-10-17', memo: 'Restricted journal', lines: [{ accountId: acct['6100'], debit: '25.00' }, { accountId: acct['1000'], credit: '25.00' }] }
  assert.equal((await request(journalPath, journalBody, 'forbidden-journal')).status, 403)
  const second = await request(invoicePath, { ...body, number: 'MAPLE-102' }, 'maple-102')
  assert.equal(second.status, 200)
  const page1 = await request(invoicePath + '?limit=1')
  assert.equal(page1.status, 200)
  assert.equal(page1.value.invoices.length, 1)
  assert.ok(page1.value.nextCursor)
  const page2 = await request(invoicePath + '?limit=1&cursor=' + encodeURIComponent(page1.value.nextCursor))
  assert.equal(page2.status, 200)
  assert.equal(page2.value.invoices.length, 1)
  assert.equal(page2.value.nextCursor, null)
  assert.deepEqual(new Set([...page1.value.invoices, ...page2.value.invoices].map(i => i.id)), new Set([first.value.id, second.value.id]))
  const filtered = await request(invoicePath + '?number=MAPLE-102')
  assert.equal(filtered.status, 200)
  assert.deepEqual(filtered.value.invoices.map(i => i.id), [second.value.id])
  assert.equal((await request(invoicePath + '?number=MAPLE')).value.invoices.length, 0, 'filters match the whole value')
  for (const limit of ['0', '101', '1.5', 'no']) assert.equal((await request(invoicePath + '?limit=' + limit)).status, 400)
  const calls = (await h.view('integrations')).calls
  assert.ok(calls.some(c => c.path === base + '/openapi.json' && c.status === 200))
  assert.ok(calls.some(c => c.path === base + journalPath && c.status === 403))
  assert.equal((await h.view('sales')).invoices.length, 2, 'failed writes and replays add no invoices')
  // Newly introduced native time records inherit granular owner consent. Their
  // scopes read hours and references without exposing service prices or policy.
  const project = await h.command('time-project.save', { customerId: customer.id, name: 'synthetic-pantry-25' })
  const service = await h.command('item.save', { name: 'synthetic-pantry-26', kind: 'service', rate: '125', accountId: acct['4000'], taxCategory: 'non-taxable' })
  const timeBody = { customerId: customer.id, projectId: project.id, itemId: service.id, date: '2026-10-17', hours: '2', note: 'synthetic-pantry-27' }
  const entry = await h.command('time.save', timeBody)
  const otherEntry = await h.command('time.save', { ...timeBody, date: '2026-10-18', hours: '1' })
  const projectReader = await h.command('integration.create', { name: 'synthetic-pantry-28', scopes: ['time-projects:read'] })
  const timeReader = await h.command('integration.create', { name: 'synthetic-pantry-29', scopes: ['time-entries:read'] })
  const readTime = (path, token = timeReader.token, body) => request(path, body, undefined, token)
  assert.deepEqual(schema.paths['/time-entries'].get['x-pantry-scopes'], ['time-entries:read'])
  assert.deepEqual(schema.paths['/time-entries/{id}'].get.responses[200].content['application/json'].schema.properties.minutes.type, ['integer', 'null'])
  assert.equal(schema.paths['/time-entries'].post, undefined)
  assert.equal((await request('/time-entries')).status, 403)
  assert.equal((await readTime('/time-entries/' + entry.id, projectReader.token)).status, 403)
  assert.equal((await readTime('/time-projects/' + project.id)).status, 403)
  assert.equal((await readTime('/time-projects/' + project.id, projectReader.token)).value.name, project.name)
  assert.deepEqual((await readTime('/time-projects?customerId=' + customer.id, projectReader.token)).value.records.map(r => r.id), [project.id])
  const timePage = await readTime('/time-entries?limit=1&projectId=' + project.id)
  assert.equal(timePage.status, 200); assert.ok(timePage.value.nextCursor)
  const nextTime = await readTime('/time-entries?limit=1&projectId=' + project.id + '&cursor=' + encodeURIComponent(timePage.value.nextCursor))
  assert.equal(nextTime.status, 200); assert.equal(nextTime.value.nextCursor, null)
  assert.deepEqual(new Set([...timePage.value.records, ...nextTime.value.records].map(r => r.id)), new Set([entry.id, otherEntry.id]))
  const scopedTime = (await readTime('/time-entries/' + entry.id)).value
  assert.equal(scopedTime.minutes, 120); assert.equal(scopedTime.note, timeBody.note)
  assert.equal(scopedTime.person_email, 'owner@example.test'); assert.equal(scopedTime.recorded_by, 'owner@example.test')
  assert.equal(scopedTime.invoice_id, null)
  assert.equal(/rate|amount|cents|policy|time_people/i.test(JSON.stringify(scopedTime)), false)
  assert.deepEqual((await readTime('/time-entries?customerId=' + customer.id + '&date=2026-10-17')).value.records, [scopedTime])
  assert.equal((await readTime('/items/' + service.id)).status, 403)
  assert.equal((await readTime('/time-entries', timeReader.token, timeBody)).status, 404)
  assert.equal((await h.send('/api/pantry/command/time.save', timeBody, { headers: { authorization: `Bearer ${timeReader.token}` } })).status, 401)
  const timedInvoice = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-18', lines: [] })
  assert.equal((await readTime('/time-entries/' + entry.id)).value.invoice_id, timedInvoice.id)
  assert.equal((await readTime('/time-entries?invoiceId=' + timedInvoice.id)).value.records.length, 2)
  for (const selected of [projectReader, timeReader]) await h.command('integration.revoke', { id: selected.id })
  assert.equal((await readTime('/time-entries')).status, 401)
  assert.equal((await readTime('/time-projects', projectReader.token)).status, 401)
  await h.command('integration.revoke', { id: credential.id })
  assert.equal((await request('/openapi.json')).status, 401)
})

test('API-001 the documented journal door keeps integration work as a draft without the separate post grant and refuses locks', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const credential = await h.command('integration.create', { name: 'Journal preparer', scopes: ['journals:write'] })
  const call = (body, key) => h.send('/api/pantry/integration/v1/journals', body, { headers: { authorization: `Bearer ${credential.token}`, 'idempotency-key': key } })
  const body = { date: '2026-10-17', memo: 'Equipment proposal', lines: [{ accountId: acct['6100'], debit: '150.00' }, { accountId: acct['1000'], credit: '150.00' }] }
  const before = await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
  const draft = await call(body, 'equipment')
  assert.equal(draft.status, 200, JSON.stringify(draft.value))
  assert.equal(draft.value.status, 'draft')
  assert.equal((await call(body, 'equipment')).value.id, draft.value.id)
  assert.equal((await call({ ...body, post: true }, 'attempt-post')).status, 403)
  await h.db.prepare("INSERT INTO pt_periods (id,start_date,end_date,status,revision) VALUES ('2026-11','2026-11-01','2026-11-30','locked','locked')").run()
  assert.equal((await call({ ...body, date: '2026-11-01' }, 'locked-draft')).status, 409)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'), before, 'drafts, replays and refusals leave posted reports unchanged')
})

test('API-001 documented per-credential UTC-minute limits are atomic, durable, isolated and leave throttled writes uncommitted', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Juniper Workshop' })
  const credential = await h.command('integration.create', { name: 'Bounded invoice importer', scopes: ['invoices:write'] })
  const independent = await h.command('integration.create', { name: 'Other invoice importer', scopes: ['invoices:write'] })
  const base = '/api/pantry/integration/v1'
  const request = (path, body, key, token = credential.token) => h.send(base + path, body, { headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) } })
  const budgetRow = () => h.db.prepare('SELECT * FROM pt_integration_rate_limits WHERE credential_id = ?').bind(credential.id).first()
  const awaitMinute = async () => {
    const seconds = (await h.db.prepare("SELECT CAST(strftime('%s','now') AS INTEGER) AS seconds").first()).seconds
    const untilReset = 60 - seconds % 60
    if (untilReset <= 25) await new Promise(resolve => setTimeout(resolve, (untilReset + 1) * 1000))
  }
  await awaitMinute()
  const schema = await request('/openapi.json')
  assert.equal(schema.status, 200)
  assert.deepEqual([schema.headers.get('x-ratelimit-limit'), schema.headers.get('x-ratelimit-remaining')], ['120', '119'])
  assert.equal(Number(schema.headers.get('x-ratelimit-reset')) % 60, 0)
  assert.equal(schema.value['x-pantry-rate-limit'].requests, 120)
  assert.equal(schema.value['x-pantry-rate-limit'].windowSeconds, 60)
  assert.equal(schema.value['x-pantry-rate-limit'].scope, 'credential')
  assert.ok(schema.value.paths['/invoices'].post.responses['429'].headers['Retry-After'])
  assert.ok(schema.value.paths['/invoices'].post.responses['200'].headers['X-RateLimit-Remaining'])
  const body = { customerId: customer.id, issueDate: '2026-10-17', number: 'QUOTA-001', lines: [{ description: 'Design work', accountId: acct['4000'], quantity: '1', rate: '125.00', taxCode: 'exempt' }] }
  const first = await request('/invoices', body, 'quota-invoice')
  assert.equal(first.status, 200, JSON.stringify(first.value))
  assert.equal((await request('/invoices', body, 'quota-invoice')).value.id, first.value.id)
  assert.equal((await request('/journals')).status, 403)
  assert.equal((await request('/invoices', body)).status, 400)
  assert.equal((await request('/not-a-route')).status, 404)
  const used = await budgetRow()
  assert.equal(used.requests, 6, 'discovery, writes, replays, missing scope, invalid bodies and unknown paths count')
  assert.equal((await request('/invoices', undefined, undefined, 'invalid')).status, 401)
  assert.deepEqual(await budgetRow(), used, 'invalid credentials do not consume an identified credential budget')
  // Persisted near-limit state is a fixture, not an in-process counter. Keep the
  // concurrent boundary away from a real wall-clock minute rollover.
  await awaitMinute()
  await h.db.prepare("UPDATE pt_integration_rate_limits SET window_start = CAST(strftime('%s','now') AS INTEGER) / 60 * 60, requests = 117 WHERE credential_id = ?").bind(credential.id).run()
  const contenders = await Promise.all(Array.from({ length: 8 }, () => request('/invoices')))
  assert.equal(contenders.filter(r => r.status === 200).length, 3)
  assert.equal(contenders.filter(r => r.status === 429).length, 5)
  assert.deepEqual(contenders.filter(r => r.status === 200).map(r => Number(r.headers.get('x-ratelimit-remaining'))).sort((a, b) => a - b), [0, 1, 2])
  const throttledBody = { ...body, number: 'QUOTA-002' }
  const denied = await request('/invoices', throttledBody, 'after-reset')
  assert.equal(denied.status, 429)
  assert.deepEqual([denied.headers.get('x-ratelimit-limit'), denied.headers.get('x-ratelimit-remaining')], ['120', '0'])
  const retry = Number(denied.headers.get('retry-after'))
  assert.ok(Number.isInteger(retry) && retry >= 1 && retry <= 60)
  assert.match(denied.value.error, /request limit/)
  assert.equal((await request('/openapi.json')).status, 429, 'schema discovery shares the same exhausted budget')
  assert.equal((await request('/invoices', throttledBody, 'after-reset')).status, 429, 'a later request cannot reset the persisted budget')
  assert.equal((await h.view('sales')).invoices.length, 1)
  assert.equal(await h.db.prepare('SELECT 1 FROM pt_integration_requests WHERE credential_id = ? AND request_key = ?').bind(credential.id, 'after-reset').first(), null)
  const other = await request('/invoices', undefined, undefined, independent.token)
  assert.equal(other.status, 200, 'another credential on the same client has its own budget')
  assert.equal(other.headers.get('x-ratelimit-remaining'), '119')
  const exhausted = await budgetRow()
  assert.equal(exhausted.requests, 120)
  assert.equal(Number(denied.headers.get('x-ratelimit-reset')), exhausted.window_start + 60)
  const audit = await h.view('integrations')
  assert.ok(audit.calls.some(c => c.credential_id === credential.id && c.status === 429 && c.method === 'POST'))
  assert.ok(!JSON.stringify(audit).includes(credential.token))
  // A prior-minute persisted budget rolls over on the next public request.
  await h.db.prepare('UPDATE pt_integration_rate_limits SET window_start = window_start - 60 WHERE credential_id = ?').bind(credential.id).run()
  const resumed = await request('/invoices', throttledBody, 'after-reset')
  assert.equal(resumed.status, 200, JSON.stringify(resumed.value))
  assert.equal(resumed.headers.get('x-ratelimit-remaining'), '119')
  assert.equal((await request('/invoices', throttledBody, 'after-reset')).value.id, resumed.value.id)
  assert.equal((await h.view('sales')).invoices.length, 2, 'throttled creates never reserve a key or create a record')
  await h.command('integration.revoke', { id: credential.id })
  const beforeRevoked = await budgetRow()
  const revoked = await request('/openapi.json')
  assert.equal(revoked.status, 401)
  assert.equal(revoked.headers.get('x-ratelimit-limit'), null, 'revocation precedes quota admission')
  assert.deepEqual(await budgetRow(), beforeRevoked)
})


test('API-001 / REPORT-002 scoped financial reports read native nonzero books, bases, columns and filters with no posting or cross-scope access', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Workshop checking', institution: 'Community Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0.00' })
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Maple Street Workshop' })
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Cedar Office Supplies' })
  const tax = await h.command('tax-code.save', { name: 'NY fixture tax', rate: '10', accountId: acct['2200'], state: 'NY' })
  const invoice = await h.command('invoice.save-draft', { customerId: customer.id, number: 'MAPLE-REPORT-1', issueDate: '2026-10-05', lines: [{ description: 'Workshop design', rate: '1000.00', quantity: '1', accountId: acct['4000'], taxCode: tax.id }] })
  await h.command('invoice.approve', { id: invoice.id, revision: invoice.revision })
  await h.command('invoice.issue', { id: invoice.id })
  await h.command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-10-10', amount: '550.00', method: 'ach', bankAccountId: bank.id, allocations: [{ targetId: invoice.id, amount: '550.00' }] })
  const bill = await h.command('bill.save', { vendorId: vendor.id, reference: 'CEDAR-REPORT-1', billDate: '2026-10-06', post: true, lines: [{ description: 'Supplies', accountId: acct['6300'], amount: '200.00' }] })
  await h.command('payment.record', { direction: 'paid', contactId: vendor.id, date: '2026-10-11', amount: '50.00', method: 'check', bankAccountId: bank.id, allocations: [{ targetId: bill.id, amount: '50.00' }] })
  const journal = await h.command('journal.save-draft', { date: '2026-10-12', memo: 'Workshop bank fee', lines: [{ accountId: acct['6400'], debit: '10.00' }, { accountId: acct['1000'], credit: '10.00' }] })
  await h.command('journal.post', { id: journal.id, revision: journal.revision })
  const reader = await h.command('integration.create', { name: 'Workshop financial reporting', scopes: ['reports:read'] })
  const invoicesOnly = await h.command('integration.create', { name: 'Workshop invoices only', scopes: ['invoices:write'] })
  const base = '/api/pantry/integration/v1'
  const call = (path, token = reader.token) => h.send(base + path, undefined, { headers: { authorization: `Bearer ${token}` } })
  const range = 'from=2026-10-01&to=2026-10-31'
  const before = await h.view('journal')
  const requestCount = await h.db.prepare('SELECT COUNT(*) AS n FROM pt_integration_requests').first()
  for (const kind of financialReports) {
    for (const basis of ['cash', 'accrual', undefined]) {
      const query = range + (basis ? '&basis=' + basis : '')
      const scoped = await call('/reports/' + kind + '?' + query)
      assert.equal(scoped.status, 200, `${kind}/${basis}: ${JSON.stringify(scoped.value)}`)
      assert.deepEqual(scoped.value, await h.view('reports/' + kind + '?' + query), `${kind}/${basis} matches the native public report`)
      assert.equal(scoped.headers.get('x-ratelimit-limit'), '120')
      assert.equal(scoped.headers.get('cache-control'), 'no-store')
      if (kind === 'profit-and-loss') assert.equal(scoped.value.netIncome, basis === 'accrual' ? 79000 : 44000, 'part-paid documents differ on the declared cash default')
      if (kind === 'receivables') assert.equal(scoped.value.basis, 'accrual', 'open items retain their actual semantic basis')
      if (kind === 'contractor-summary') assert.equal(scoped.value.basisLabel, 'Payment basis')
      if (kind === 'reconciliations') assert.equal(scoped.value.basis, 'accrual')
    }
    assert.equal((await call('/reports/' + kind + '?' + range, invoicesOnly.token)).status, 403, kind + ' requires the report scope')
  }
  for (const [kind, query] of [
    ['general-ledger', '&account=' + acct['4000']],
    ['transactions', '&account=' + acct['1000'] + '&payee=' + customer.id],
    ['journal', '&account=' + acct['1000'] + '&payee=' + vendor.id],
    ['profit-and-loss', '&columns=prior-period'],
    ['profit-and-loss', '&columns=customer'],
    ['balance-sheet', '&columns=months'],
  ]) {
    const path = 'reports/' + kind + '?' + range + '&basis=cash' + query
    const scoped = await call('/' + path)
    assert.equal(scoped.status, 200, JSON.stringify(scoped.value))
    assert.deepEqual(scoped.value, await h.view(path), 'filter/column selection survives the scoped door: ' + path)
    if (kind === 'general-ledger') assert.deepEqual(scoped.value.accounts.map(a => a.id), [acct['4000']])
    if (kind === 'transactions' || kind === 'journal') assert.ok(scoped.value.rows.length > 0, 'filtered source rows are present')
  }
  // Date defaults, the declared tax method and an explicit choice use the native rules too.
  assert.deepEqual((await call('/reports/profit-and-loss?to=2026-10-31')).value, await h.view('reports/profit-and-loss?to=2026-10-31'))
  const entity = (await h.view('state')).settings.entity
  await h.command('entity.save', { legalName: entity.legal_name, entityType: entity.entity_type, state: entity.state, fiscalYearStart: entity.fiscal_year_start, taxMethod: 'accrual', booksStart: entity.books_start, policies: entity.policies, revision: entity.revision })
  assert.equal((await call('/reports/profit-and-loss?' + range)).value.netIncome, 79000)
  assert.equal((await call('/reports/profit-and-loss?' + range + '&basis=cash')).value.netIncome, 44000)
  for (const query of ['basis=other', 'to=2026-02-30', 'from=not-a-date', 'columns=unknown']) {
    const params = new URLSearchParams(range), [key, value] = query.split('='); params.set(key, value)
    assert.equal((await call('/reports/profit-and-loss?' + params)).status, 400, query)
  }
  for (const kind of ['audit-log', 'contractors', 'unknown', '__proto__']) assert.equal((await call('/reports/' + kind + '?' + range)).status, 404, 'only listed financial reports: ' + kind)
  assert.equal((await h.send(base + '/reports/profit-and-loss?' + range, undefined, { cookie: h.owner })).status, 401)
  assert.equal((await h.send('/api/pantry/reports/profit-and-loss?' + range, undefined, { headers: { authorization: `Bearer ${reader.token}` } })).status, 401)
  assert.equal((await h.send(base + '/journals', { date: '2026-10-01', memo: 'Report reader cannot write', lines: [] }, { headers: { authorization: `Bearer ${reader.token}`, 'idempotency-key': 'report-reader-write' } })).status, 403)
  assert.deepEqual(await h.view('journal'), before, 'reads never post or change journals')
  assert.deepEqual(await h.db.prepare('SELECT COUNT(*) AS n FROM pt_integration_requests').first(), requestCount, 'reads never claim write idempotency keys')
  const calls = (await h.view('integrations')).calls
  assert.ok(calls.some(c => c.path.endsWith('/reports/profit-and-loss') && c.status === 200))
  assert.ok(calls.some(c => c.path.endsWith('/reports/audit-log') && c.status === 404))
  assert.ok(calls.some(c => c.path.endsWith('/reports/balance-sheet') && c.status === 403))
  await h.command('integration.revoke', { id: reader.id })
  assert.equal((await call('/reports/profit-and-loss?' + range)).status, 401)
  assert.equal((await call('/reports/transactions?' + range)).status, 401)
})


test('API-001 / INVOICE-010 scoped issuance counts the deposit toward the frozen early-payment offer and settles once like native invoices', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const ds=(await h.view('dimensions')).settings
  await h.command('dimensions.settings',{revision:ds.revision,class:true,location:true,project:true})
  for(const [kind,name] of [['class','Scoped studio'],['location','Scoped New York'],['project','Scoped project']])await h.command('dimension.save',{kind,name})
  const coding={className:'Scoped studio',locationName:'Scoped New York',projectName:'Scoped project'}
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Magnolia Design' })
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Community Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0' })
  const discounts = await h.command('account.save', { code: '4950', name: 'Sales discounts', type: 'income' })
  await h.command('discount-settings.save', { discountAccountId: discounts.id })
  const tax = await h.command('tax-code.save', { name: 'California 8.25%', rate: '8.25', accountId: acct['2200'], state: 'CA' })
  await h.command('tax-code.early-treatment', { id: tax.id, revision: tax.revision, treatment: 'reduce' })
  const credential = await h.command('integration.create', { name: 'Invoice terms import', scopes: ['invoices:write', 'payments:write', 'post'] })
  const call = async (path, body, key) => {
    const response = await h.send('/api/pantry/integration/v1/' + path, body, { headers: { authorization: `Bearer ${credential.token}`, ...(key ? { 'idempotency-key': key } : {}) } })
    assert.equal(response.status, 200, JSON.stringify(response.value)); return response.value
  }
  const body = { customerId: customer.id, issueDate: '2026-10-17', dueDate: '2026-11-16', destinationState: 'CA',
    lines: [{ ...coding,description: 'Design services', quantity: '1', rate: '1000.00', accountId: acct['4000'], taxCode: tax.id },
      { ...coding,kind: 'delivery', description: 'Delivery', quantity: '1', rate: '40.00', accountId: acct['4000'], taxCode: tax.id }],
    discounts: [{ type: 'percent', value: '10' }], deposit: { amount: '300.00', method: 'check', bankAccountId: bank.id, reference: '1042' }, earlyPayment: { percent: '2', days: 10 } }
  const nativeDraft = await h.command('invoice.save-draft', { ...body, number: 'NATIVE-TERMS' })
  await h.command('invoice.approve', { id: nativeDraft.id, revision: nativeDraft.revision })
  const native = await h.command('invoice.issue', { id: nativeDraft.id })
  const apiBody = { ...body, number: 'API-TERMS', post: true }
  const [scoped, replay] = await Promise.all([call('invoices', apiBody, 'terms-invoice'), call('invoices', apiBody, 'terms-invoice')])
  assert.equal(scoped.id, replay.id)
  const scopedEntry=(await h.view('journal')).entries.find(e=>e.id===scoped.journal_id)
  assert.ok(scopedEntry.lines.filter(l=>l.account_id!==acct['1200']).every(l=>l.class_name===coding.className&&l.location_name===coding.locationName&&l.project_name===coding.projectName),'scoped posting keeps native source coding on sales, discounts and tax')
  const deposits = await call('payments?invoiceId=' + scoped.id)
  assert.equal(deposits.payments.length, 1)
  assert.equal(deposits.payments[0].allocations[0].early_counted, 1, 'the issue-time deposit counts toward the early-payment offer')
  for (const field of ['destination_state', 'discounts', 'discount_cents', 'tax_cents', 'total_cents', 'deposit', 'early_terms', 'early_offer', 'open_cents'])
    assert.deepEqual(scoped[field], native[field], field)
  assert.deepEqual([scoped.total_cents, scoped.open_cents, scoped.early_offer.discount, scoped.early_offer.reduction, scoped.early_offer.payBy], [101755, 71755, 1880, 155, 69720])
  assert.deepEqual(scoped.lines.map(l => [l.line_kind, l.amount_cents, l.discount_cents, l.tax_cents]), [['item', 100000, 10000, 7425], ['delivery', 4000, 0, 330]])
  const paymentBody = { direction: 'received', contactId: customer.id, date: '2026-10-27', amount: '697.20', bankAccountId: bank.id, reference: 'balance-1042', allocations: [{ targetId: scoped.id, amount: '697.20' }] }
  const [paid, paidReplay] = await Promise.all([call('payments', paymentBody, 'terms-payment'), call('payments', paymentBody, 'terms-payment')])
  assert.equal(paid.id, paidReplay.id)
  await h.command('payment.record', { ...paymentBody, allocations: [{ targetId: native.id, amount: '697.20' }] })
  const scopedAfter = (await call('invoices?id=' + scoped.id)).invoices[0]
  assert.equal(scopedAfter.open_cents, 0, 'deposit plus the early amount settles the invoice')
  assert.equal((await call('invoices', apiBody, 'terms-invoice')).open_cents, 0, 'replay returns the current settled record')
  const scopedCredits = (await call('invoices')).invoices.filter(i => i.credit_for === scoped.id)
  const nativeCredits = (await call('invoices')).invoices.filter(i => i.credit_for === native.id)
  assert.equal(scopedCredits.length, 1); assert.equal(nativeCredits.length, 1)
  for (const field of ['early_discount', 'total_cents', 'tax_cents', 'destination_state']) assert.deepEqual(scopedCredits[0][field], nativeCredits[0][field], field)
  assert.deepEqual([scopedCredits[0].early_discount, scopedCredits[0].total_cents, scopedCredits[0].tax_cents], [1, 2035, 155])
  assert.equal((await call('payments?invoiceId=' + scoped.id)).payments.length, 2, 'replays create no extra deposit or payment')
  for (const basis of ['cash', 'accrual']) {
    const report = await h.view(`reports/sales-tax?from=2026-10-01&to=2026-10-31&basis=${basis}`)
    assert.equal(report.ledger.ties, true, `${basis} sales-tax ledger tie`)
  }
})

test('API-001 scoped drafts and issued invoices retain the same destination and certificate snapshot as native invoices', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Resale Workshop' })
  const tax = await h.command('tax-code.save', { name: 'California 8.25%', rate: '8.25', accountId: acct['2200'], state: 'CA' })
  const certificate = await h.command('exemption.save', { customerId: customer.id, states: ['CA'], validFrom: '2026-01-01', expiresOn: '2099-12-31', certificateNumber: 'RESALE-1042', name: 'Resale certificate.txt', mediaType: 'text/plain', base64: Buffer.from('Synthetic resale certificate for public-door integration proof').toString('base64') })
  const credential = await h.command('integration.create', { name: 'Resale invoices', scopes: ['invoices:write', 'post'] })
  const send = (body, key) => h.send('/api/pantry/integration/v1/invoices', body, { headers: { authorization: `Bearer ${credential.token}`, 'idempotency-key': key } })
  const body = { customerId: customer.id, issueDate: '2026-10-17', destinationState: 'CA', lines: [{ description: 'Design package', rate: '100.00', accountId: acct['4000'], taxCode: tax.id }] }
  const native = await h.command('invoice.save-draft', { ...body, number: 'RESALE-NATIVE' })
  let scopedDraft
  for (const post of [false, true]) {
    const response = await send({ ...body, number: 'RESALE-API-' + post, post }, 'resale-' + post)
    assert.equal(response.status, 200, JSON.stringify(response.value))
    const scoped = response.value
    assert.equal(scoped.destination_state, 'CA')
    assert.deepEqual(JSON.parse(scoped.exemption_evidence), JSON.parse(native.exemption_evidence))
    assert.equal(JSON.parse(scoped.exemption_evidence).id, certificate.id)
    assert.deepEqual([scoped.tax_cents, scoped.total_cents, scoped.lines[0].tax_code, scoped.lines[0].chosen_tax_code], [0, 10000, 'exempt', tax.id])
    assert.equal(scoped.status, post ? 'issued' : 'draft')
    if (!post) scopedDraft = scoped
    assert.equal((await send({ ...body, number: 'RESALE-API-' + post, post }, 'resale-' + post)).value.id, scoped.id)
  }
  await h.command('exemption.retire', { id: certificate.id, reason: 'Customer withdrew this certificate' })
  const after = await send({ ...body, number: 'RESALE-AFTER', post: true }, 'resale-after')
  assert.equal(after.status, 200, JSON.stringify(after.value))
  assert.equal(after.value.exemption_evidence, null)
  assert.equal(after.value.tax_cents, 825, 'a retired certificate cannot exempt a new API invoice')
  const nativeAfter = await h.command('invoice.save-draft', { ...body, number: 'RESALE-AFTER-NATIVE' })
  assert.equal(after.value.tax_cents, nativeAfter.tax_cents)
  await h.command('invoice.approve', { id: native.id, revision: native.revision }, h.owner, 409)
  await h.command('invoice.approve', { id: scopedDraft.id, revision: scopedDraft.revision }, h.owner, 409)
})


test('API-001 / INVOICE-010 scoped discount, delivery, deposit and early-term refusals match native doors without reserving failed keys', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Cedar Consulting' })
  const bank = await h.command('bank-account.save', { name: 'Checking', institution: 'Community Bank', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-01-01', openingBalance: '0' })
  const credential = await h.command('integration.create', { name: 'Invoice import', scopes: ['invoices:write', 'post'] })
  const preparer = await h.command('integration.create', { name: 'Draft import', scopes: ['invoices:write'] })
  const send = (body, key, token = credential.token) => h.send('/api/pantry/integration/v1/invoices', body, { headers: { authorization: `Bearer ${token}`, 'idempotency-key': key } })
  const body = { customerId: customer.id, issueDate: '2026-10-17', dueDate: '2026-11-16', lines: [{ description: 'Services', rate: '100.00', accountId: acct['4000'], taxCode: 'exempt' }] }
  const before = await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
  const failedBody = { ...body, post: true, discounts: [{ type: 'percent', value: '10' }] }
  const missingAccount = await send(failedBody, 'repair-discount-account')
  assert.equal(missingAccount.status, 409)
  assert.match(missingAccount.value.error, /discounts account/i)
  const nativeDraft = await h.command('invoice.save-draft', { ...failedBody, number: 'NATIVE-MISSING-ACCOUNT' })
  await h.command('invoice.approve', { id: nativeDraft.id, revision: nativeDraft.revision }, h.owner, 409)
  const discounts = await h.command('account.save', { code: '4950', name: 'Sales discounts', type: 'income' })
  await h.command('discount-settings.save', { discountAccountId: discounts.id })
  const cases = [
    { discounts: [{ type: 'percent', value: '0' }] },
    { discounts: [{ type: 'amount', value: '100.01' }] },
    { discounts: [{ type: 'percent', value: '10', lines: [2] }] },
    { deposit: { amount: '100.01', method: 'check', bankAccountId: bank.id } },
    { deposit: { amount: '10.00', method: 'barter', bankAccountId: bank.id } },
    { deposit: { amount: '10.00', method: 'check', bankAccountId: bank.id, date: '2026-10-18' } },
    { earlyPayment: { percent: '0', days: 10 } },
    { earlyPayment: { percent: '100', days: 10 } },
    { earlyPayment: { percent: '2.0001', days: 10 } },
    { earlyPayment: { percent: '2', days: 31 } },
    { earlyPayment: { percent: '2', days: 1.5 } },
    { earlyPayment: { percent: '2', days: 10 }, deposit: { amount: '98.00', method: 'check', bankAccountId: bank.id } },
  ]
  for (const [i, bad] of cases.entries()) {
    const response = await send({ ...body, ...bad, post: true }, 'invalid-' + i)
    assert.equal(response.status, 400, JSON.stringify(response.value))
    const native = await h.send('/api/pantry/command/invoice.save-draft', { ...body, ...bad }, { cookie: h.owner })
    assert.equal(native.status, response.status)
    assert.equal(native.value.error, response.value.error)
  }
  const undecidedTax = await h.command('tax-code.save', { name: 'Texas 8.25%', rate: '8.25', accountId: acct['2200'], state: 'TX' })
  const undecidedBody = { ...body, lines: [{ ...body.lines[0], taxCode: undecidedTax.id }], earlyPayment: { percent: '2', days: 10 } }
  const undecided = await send({ ...undecidedBody, post: true }, 'undecided')
  assert.equal(undecided.status, 409); assert.match(undecided.value.error, /treatment/i)
  const undecidedDraft = await h.command('invoice.save-draft', undecidedBody)
  await h.command('invoice.approve', { id: undecidedDraft.id, revision: undecidedDraft.revision }, h.owner, 409)
  assert.equal((await send({ ...body, post: true }, 'no-post', preparer.token)).status, 403)
  const prepared = await send({ ...body, earlyPayment: { percent: '2', days: 10 } }, 'draft-terms', preparer.token)
  assert.equal(prepared.status, 200); assert.equal(prepared.value.status, 'draft')
  assert.equal(prepared.value.early_offer.discount, 200)
  await h.db.prepare("INSERT INTO pt_periods (id,start_date,end_date,status,revision) VALUES ('2026-11','2026-11-01','2026-11-30','locked','locked')").run()
  for (const post of [false, true]) {
    assert.equal((await send({ ...body, issueDate: '2026-11-01', post }, 'locked-' + post)).status, 409)
  }
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'), before, 'drafts and refused inputs post nothing')
  const recovered = await send(failedBody, 'repair-discount-account')
  assert.equal(recovered.status, 200, JSON.stringify(recovered.value))
  assert.equal(recovered.value.total_cents, 9000)
  assert.equal(recovered.value.status, 'issued', 'a failed create did not reserve the idempotency key')
  const changed = await send({ ...failedBody, memo: 'different request' }, 'repair-discount-account')
  assert.equal(changed.status, 409)
})

test('scoped vendor credits share native posting and allocation rules, replay once and preserve balances on refusals', async t => {
  const h = await harness(); t.after(h.close)
  const { acct } = await books(h)
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Harbor Ceramics' })
  const other = await h.command('contact.save', { kind: 'vendor', name: 'Cedar Supplies' })
  const makeBill = (vendorId, reference, post = true) => h.command('bill.save', { vendorId, reference, billDate: '2026-10-17', post, lines: [{ description: 'Ceramics', accountId: acct['6100'], amount: '100.00' }] })
  const bill = await makeBill(vendor.id, 'HC-100'), otherBill = await makeBill(other.id, 'CS-100'), draft = await makeBill(vendor.id, 'HC-DRAFT', false)
  const writer = await h.command('integration.create', { name: 'Pier vendor returns', scopes: ['vendor-credits:write', 'post'] })
  const reader = await h.command('integration.create', { name: 'Vendor credit readback', scopes: ['vendor-credits:read'] })
  const noPost = await h.command('integration.create', { name: 'Unapproved credits', scopes: ['vendor-credits:write'] })
  const unrelated = await h.command('integration.create', { name: 'Invoice importer', scopes: ['invoices:write', 'post'] })
  const request = async (path, body, key, status = 200, token = writer.token) => {
    const r = await h.send('/api/pantry/integration/v1/' + path, body, { headers: { authorization: `Bearer ${token}`, ...(key ? { 'idempotency-key': key } : {}) } })
    assert.equal(r.status, status, path + ': ' + JSON.stringify(r.value)); return r.value
  }
  const body = { vendorId: vendor.id, date: '2026-10-18', amount: '60.00', reference: 'HC-RETURN', accountId: acct['6100'], allocations: [{ targetId: bill.id, amount: '20.00' }] }
  await request('vendor-credits', body, 'read-only', 403, reader.token)
  await request('vendor-credits', body, 'without-post', 403, noPost.token)
  await request('vendor-credits', body, 'unrelated', 403, unrelated.token)
  await request('vendor-credits', { ...body, post: false }, 'draft', 400)
  await request('vendor-credits', body, undefined, 400)
  const [credit, duplicate] = await Promise.all([request('vendor-credits', body, 'return-100'), request('vendor-credits', { ...body }, 'return-100')])
  assert.equal(credit.id, duplicate.id)
  assert.equal(credit.amount_cents, 6000); assert.equal(credit.unallocated_cents, 4000)
  assert.deepEqual(credit.allocations.map(a => [a.target_id, a.amount_cents]), [[bill.id, 2000]])
  const posted = await h.view('reports/trial-balance?to=2026-10-31&basis=accrual')
  assert.equal(posted.rows.find(a => a.code === '6100').net, 14000, 'credit reverses expense exactly once')
  await request('vendor-credits', { ...body, amount: '61.00' }, 'return-100', 409)
  const path = `vendor-credits/${credit.id}/allocations`, apply = { date: '2026-10-19', allocations: [{ targetId: bill.id, amount: '40.00' }] }
  await request(path, apply, 'read-only-apply', 403, reader.token)
  await request(path, apply, 'without-post-apply', 403, noPost.token)
  await request(path, { ...apply, post: false }, 'draft-apply', 400)
  await request(path, { ...apply, date: '2026-10-17' }, 'too-early', 400)
  await request(path, { ...apply, allocations: [] }, 'empty', 400)
  await request(path, { ...apply, allocations: [{ targetId: otherBill.id, amount: '10.00' }] }, 'wrong-vendor', 400)
  await request(path, { ...apply, allocations: [{ targetId: draft.id, amount: '10.00' }] }, 'draft-bill', 400)
  await request(path, { ...apply, allocations: [{ targetId: bill.id, amount: '41.00' }] }, 'too-much', 400)
  const [applied, replay] = await Promise.all([request(path, apply, 'apply-100'), request(path, apply, 'apply-100')])
  assert.equal(applied.id, replay.id); assert.equal(applied.allocations.length, 2); assert.equal(applied.unallocated_cents, 0)
  assert.deepEqual(await request(path, apply, 'apply-100'), applied, 'replay succeeds after credit is fully used')
  await request(path, { ...apply, date: '2026-10-20' }, 'apply-100', 409)
  assert.equal((await h.view('sales')).bills.find(b => b.id === bill.id).open_cents, 4000)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-10-31&basis=accrual'), posted, 'allocations and refusals move no money and add no journals')
  // A failed key is reusable after correcting the request; native records are readable too.
  const native = await h.command('vendor-credit.record', { ...body, reference: 'HC-NATIVE', amount: '10.00', allocations: [] })
  await h.command('vendor-credit.allocate', { creditId: native.id, date: '2026-10-19', allocations: [{ targetId: bill.id, amount: '5.00' }] })
  assert.equal((await request(`vendor-credits/${native.id}`, undefined, undefined, 200, reader.token)).unallocated_cents, 500)
  await request('vendor-credits', { ...body, accountId: acct['1000'], allocations: [] }, 'correctable', 400)
  const next = await request('vendor-credits', { ...body, reference: 'HC-NEXT', amount: '1.00', allocations: [] }, 'correctable')
  assert.equal(next.amount_cents, 100)
  const exact = await request('vendor-credits?reference=HC-RETURN', undefined, undefined, 200, reader.token)
  assert.deepEqual(exact.vendorCredits.map(c => c.id), [credit.id])
  assert.equal((await request('vendor-credits?reference=HC')).vendorCredits.length, 0)
  assert.equal((await request('vendor-credits?vendorId=' + other.id)).vendorCredits.length, 0)
  const found = []
  let cursor = ''
  do {
    const page = await request('vendor-credits?limit=1&vendorId=' + vendor.id + '&cursor=' + encodeURIComponent(cursor), undefined, undefined, 200, reader.token)
    found.push(...page.vendorCredits.map(c => c.id)); cursor = page.nextCursor
  } while (cursor)
  assert.deepEqual(new Set(found), new Set([credit.id, native.id, next.id])); assert.equal(found.length, 3)
  await request('vendor-credits?limit=101', undefined, undefined, 400)
  await request('vendor-credits/synthetic-pantry-1', undefined, undefined, 404)
  await request('vendor-credits', undefined, undefined, 403, unrelated.token)
  await request('journals', undefined, undefined, 403, reader.token)
  const schema = await request('openapi.json')
  assert.equal(schema.paths['/vendor-credits'].post.requestBody.content['application/json'].schema.$ref, '#/components/schemas/VendorCreditInput')
  assert.ok(schema.paths['/vendor-credits/{id}/allocations'].post)
  await h.db.prepare("INSERT INTO pt_periods (id,start_date,end_date,status,revision) VALUES ('2026-11','2026-11-01','2026-11-30','locked','synthetic-pantry-2')").run()
  await request('vendor-credits', { ...body, date: '2026-11-01', allocations: [] }, 'locked-record', 409)
  await request(`vendor-credits/${native.id}/allocations`, { date: '2026-11-01', allocations: [{ targetId: bill.id, amount: '1.00' }] }, 'locked-apply', 409)
  // Independent keys racing to spend a remaining credit cannot over-allocate it.
  const race = await Promise.all(['race-a', 'race-b'].map(key => h.send('/api/pantry/integration/v1/' + `vendor-credits/${native.id}/allocations`, { date: '2026-10-20', allocations: [{ targetId: bill.id, amount: '5.00' }] }, { headers: { authorization: `Bearer ${writer.token}`, 'idempotency-key': key } })))
  assert.equal(race.filter(r => r.status === 200).length, 1)
  assert.ok(race.every(r => [200, 400, 409].includes(r.status)))
  assert.equal((await request(`vendor-credits/${native.id}`)).unallocated_cents, 0)
  const audit = await h.view('integrations')
  assert.ok(audit.calls.some(c => c.path.endsWith('/vendor-credits') && c.status === 403))
  assert.ok(audit.calls.some(c => c.path.endsWith('/allocations') && c.status === 409))
  await h.command('integration.revoke', { id: writer.id })
  await request('vendor-credits', body, 'return-100', 401)
  await request(`vendor-credits/${credit.id}`, undefined, undefined, 401)
  assert.equal((await request(`vendor-credits/${credit.id}`, undefined, undefined, 200, reader.token)).allocations.length, 2)
})


test('API-001 owner-only webhook consent emits atomic thin signed approval, posting, payment, match and lock events',async t=>{
  const {webhookLifecycle}=await import('./webhook-journey.mjs');await webhookLifecycle(t)
})
test('API-001 webhook retries persist every delay, stop after six attempts, rotate for 24 hours and honour disable, delete and erasure',async t=>{
  const {webhookRetries}=await import('./webhook-journey.mjs');await webhookRetries(t)
})


test('API-001 record-type readers expose bounded native records with granular consent and safe projections',async t=>{
 const {journey}=await import('./resources-journey.mjs');await journey(t)
})


test('API-001 webhook transport times out a slow receiver without reading its response',async t=>{
 const {webhookTimeout}=await import('./webhook-journey.mjs');await webhookTimeout(t)
})
