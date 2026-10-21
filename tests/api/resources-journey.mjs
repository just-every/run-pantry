import assert from 'node:assert/strict'
import { at, fixture, harness } from './harness.mjs'
import { closeReady, importStatements, matchSeptember, september } from './scenario.mjs'

/** One public HTTP journey; only the Plaid/Gusto network edges are faked. */
export async function journey(t) {
  const payrolls = JSON.parse(await fixture('gusto/payrolls.json'))
  let sync = 0
  const feedAccount = { account_id: 'synthetic-pantry-10', name: 'Operating checking', mask: '4821', type: 'depository', subtype: 'checking', balances: { current: 27795.02, iso_currency_code: 'USD' } }
  const transaction = (id, date, amount, name) => ({ account_id: feedAccount.account_id, transaction_id: id, date, amount, name, merchant_name: name, pending: false, iso_currency_code: 'USD' })
  const outbound = async request => {
    const url = new URL(request.url)
    if (url.hostname === 'sandbox.plaid.com') {
      if (url.pathname === '/item/public_token/exchange') return Response.json({ access_token: 'synthetic-pantry-3', item_id: 'synthetic-pantry-4' })
      if (url.pathname === '/accounts/get') return Response.json({ accounts: [feedAccount], item: { institution_id: 'synthetic-pantry-5' } })
      if (url.pathname === '/transactions/sync') {
        sync++
        return Response.json({ accounts: [feedAccount], added: sync === 1 ? [transaction('synthetic-pantry-11', '2025-12-31', 1, 'Prior-year observation'), transaction('synthetic-pantry-12', '2026-10-01', 2, 'synthetic-pantry-20')] : [], modified: sync === 2 ? [transaction('synthetic-pantry-12', '2026-10-01', 3, 'synthetic-pantry-20')] : [], removed: [], has_more: false, next_cursor: 'synthetic-pantry-6', transactions_update_status: 'HISTORICAL_UPDATE_COMPLETE' })
      }
    }
    if (url.hostname === 'api.gusto-demo.com') {
      if (url.pathname === '/oauth/token') return Response.json({ access_token: 'synthetic-pantry-7', refresh_token: 'synthetic-pantry-8', expires_in: 3600, token_type: 'Bearer' })
      if (url.pathname === '/v1/token_info') return Response.json({ scope: 'companies:read payrolls:read', resource: { type: 'Company', uuid: 'synthetic-pantry-9' } })
      if (url.pathname === '/v1/companies/synthetic-pantry-9') return Response.json({ uuid: 'synthetic-pantry-9', name: 'Juniper Lane Design LLC' })
      if (url.pathname === '/v1/companies/synthetic-pantry-9/payrolls') return Response.json(url.searchParams.get('page') === '1' ? payrolls : [])
    }
    throw new Error(`Unexpected network edge ${url.hostname}${url.pathname}`)
  }
  const h = await harness({ outbound, bindings: { PLAID_CLIENT_ID: 'synthetic-pantry-1', PLAID_SECRET: 'synthetic-pantry-2', PLAID_ENV: 'sandbox', GUSTO_CLIENT_ID: 'synthetic-pantry-13', GUSTO_CLIENT_SECRET: 'synthetic-pantry-14', GUSTO_ENV: 'demo' } })
  let closed = false
  t.after(async () => { if (!closed) await h.close() })
  const s = await september(h), statements = await importStatements(h, s)
  await matchSeptember(h, s, statements)
  await closeReady(h, s, statements)
  await h.command('period.lock', { period: '2026-09' })
  await h.command('period.request-reopen', { period: '2026-09', reason: 'Review late source evidence' })
  const customer = s.c['Cedar Studio'], vendor = s.c['Brightline Software']
  const accountant = await h.member('synthetic-pantry-1@example.test', 'accountant', { canPost: true })
  await h.command('nexus.decide', { state: 'CA', decision: 'monitor', note: 'Review destination sales monthly' }, accountant)
  await h.command('item.save', { name: 'Design hour', kind: 'service', rate: '150.00', accountId: s.acct['4000'], taxCategory: 'non-taxable' })
  await h.command('contractor.save', { contactId: vendor.id, is1099: true, legalName: 'Brightline Software LLC', tinKind: 'ein', tin: '000000042', address: '1 Example Street', city: 'Albany', state: 'NY', zip: '12207' })
  await h.command('exemption.save', { customerId: customer.id, states: ['CA'], validFrom: '2026-01-01', expiresOn: '2099-12-31', certificateNumber: 'synthetic-pantry-15', name: 'certificate.txt', mediaType: 'text/plain', base64: Buffer.from('Synthetic resale evidence').toString('base64') })
  await h.command('invoice.send', { id: s.inv.northstar.id,to:['synthetic-pantry-24@example.test'] })
  const agent = await h.agent('synthetic-pantry-16')
  const proposal = await agent.call('proposals', { kind: 'close-packet', summary: 'October review', payload: { period: '2026-10', exceptions: ['Confirm insurance renewal'], notes: 'Prepared from the recorded books.' } })
  await h.command('proposal.decide', { id: proposal.id, revision: proposal.revision, decision: 'approve' })
  const recurringLine = { description: 'Monthly design', quantity: '1', rate: '100.00', accountId: s.acct['4000'], taxCode: 'exempt' }
  await h.command('recurring.save', { customerId: customer.id, startDate: '2026-10-01', endDate: '2026-10-01', every: 1, unit: 'month', mode: 'draft', lines: [recurringLine] })
  await h.command('recurring-bill.save', { name: 'Monthly software', vendorId: vendor.id, startDate: '2026-10-01', endDate: '2026-10-01', every: 1, unit: 'month', lines: [{ description: 'Subscription', accountId: s.acct['6200'], amount: '40.00' }] })
  await h.command('recurring-journal.save', { name: 'Monthly allocation', memo: 'Software allocation', mode: 'draft', startDate: '2026-10-01', endDate: '2026-10-01', cadence: 'month', every: 1, lines: [{ accountId: s.acct['6200'], debit: '10.00' }, { accountId: s.acct['3000'], credit: '10.00' }] })
  const prepaid = await h.command('account.save', { code: '1400', name: 'Prepaid insurance', type: 'asset' })
  let funding = await h.command('journal.save-draft', { date: '2026-10-01', memo: 'Insurance funding', lines: [{ accountId: prepaid.id, debit: '120.00' }, { accountId: s.acct['3000'], credit: '120.00' }] })
  funding = await h.command('journal.post', { id: funding.id, revision: funding.revision })
  await h.command('question.ask', { subjectKind: 'journal', subjectId: funding.id, question: 'Confirm this insurance funding.', assignee: 'synthetic-pantry-1@example.test' })
  const recognition = await h.command('recognition.save', { name: 'Insurance recognition', kind: 'prepaid', amount: '120.00', startDate: '2026-10-01', months: 3, balanceAccountId: prepaid.id, recognitionAccountId: s.acct['6200'], sourceJournalId: funding.id })
  await h.command('recognition.approve', { id: recognition.id, revision: recognition.revision })
  await h.command('budget.save', { name: 'October plan', startMonth: '2026-01', basis: 'accrual', cells: [{ accountId: s.acct['4000'], month: '2026-10', amount: '5000.00' }] })
  const settings = await h.command('check.settings', { bankAccountId: s.checking.id, nextNumber: 1001, stock: 'voucher', positivePay: { name: 'Synthetic bank layout', account: 'synthetic-pantry-17', columns: ['number', 'amount', 'date', 'status'].map(field => ({ field, header: field })), header: true, delimiter: ',', dateFormat: 'YYYY-MM-DD', amountFormat: 'decimal', issueCode: 'ISSUE', voidCode: 'VOID' } })
  await h.command('check.issue', { bankAccountId: s.checking.id, revision: settings.revision, date: '2026-10-01', items: [{ kind: 'expense', contactId: vendor.id, accountId: s.acct['6200'], description: 'Software supplies', amount: '10.00' }] })
  await h.command('bank-rule.save', { name: 'Routine bank fees', descriptionContains: 'synthetic-pantry-20', accountId: s.acct['6400'], bankAccountId: s.checking.id })
  await h.command('receipt-rule.save', { vendor: vendor.name, accountId: s.acct['6200'], max: '100.00' })
  const capture = new FormData()
  capture.set('source', 'upload'); capture.set('file', new Blob(['%PDF-1.4 Synthetic receipt evidence'], { type: 'application/pdf' }), 'synthetic-pantry-18.pdf')
  const captured = await fetch(h.origin + '/api/pantry/receipts/capture', { method: 'POST', headers: { origin: h.origin, cookie: h.owner }, body: capture })
  assert.equal(captured.status, 200)
  const custom = await h.command('custom-report.save', { definition: { name: 'Private October statement', source: 'profit-and-loss', from: '2026-10-01', to: '2026-10-31', basis: 'cash' }, sharedRoles: [] })
  await h.command('management-package.save', { name: 'Private board pack', cover: 'October management review', reportIds: [custom.id], commentary: ['Review cash collections.'], sharedRoles: [] })
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-pantry-19', institution: { name: 'Synthetic Community Bank' } })
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: connection.accounts[0].id, bankAccountId: s.checking.id }] })
  await h.command('feed.sync', { itemId: connection.id })
  const gusto = new URL((await h.command('gusto.connect', {})).url)
  const callback = await h.send('/api/pantry/gusto/callback?code=synthetic-pantry-21&state=' + encodeURIComponent(gusto.searchParams.get('state')), undefined, { cookie: h.owner })
  assert.equal(callback.status, 303)
  await h.command('gusto.settings', { bankAccountId: s.checking.id, from: '2026-09-01' })
  await h.cron()
  await h.command('continuous-check.run', {})

  const api = '/api/pantry/integration/v1'
  const unrelated = await h.command('integration.create', { name: 'Invoice readback only', scopes: ['invoices:read'] })
  const request = async (token, path, status = 200, body) => {
    const result = await h.send(api + path, body, { headers: { authorization: `Bearer ${token}` } })
    assert.equal(result.status, status, path + ': ' + JSON.stringify(result.value))
    return result.value
  }
  const schema = await request(unrelated.token, '/openapi.json')
  const routes = Object.entries(schema.paths).filter(([, value]) => value.get?.responses?.[200]?.content?.['application/json']?.schema?.properties?.records)
  const credentials = new Map(), seen = new Map()
  const sensitive = new Set(['tin', 'routing', 'routing_number', 'account_number', 'accountNumber', 'number_full', 'access_token', 'refresh_token', 'token', 'tokens', 'secret', 'token_hash', 'key_hint', 'key_sealed', 'access_sealed', 'refresh_sealed', 'link_token', 'feed_snapshot', 'provider_change', 'preserved_line', 'payload', 'refs', 'shared_roles', 'authority_id', 'snapshot', 'proof'])
  const safe = value => {
    if (Array.isArray(value)) return value.forEach(safe)
    if (!value || typeof value !== 'object') return
    for (const [key, child] of Object.entries(value)) { assert.ok(!sensitive.has(key), 'Sensitive field: ' + key); safe(child) }
    assert.ok(!JSON.stringify(value).includes('000000042'), 'Full TIN must never leave')
  }
  for (const [path, operation] of routes) {
    const [scope] = operation.get['x-pantry-scopes']
    if (!credentials.has(scope)) credentials.set(scope, await h.command('integration.create', { name: scope + ' reader', scopes: [scope] }))
    const credential = credentials.get(scope)
    await request(unrelated.token, path, 403)
    let page = await request(credential.token, path + '?limit=100')
    const records = []
    do {
      safe(page); assert.ok(Array.isArray(page.records)); records.push(...page.records)
      if (!page.nextCursor) break
      page = await request(credential.token, path + '?limit=100&cursor=' + encodeURIComponent(page.nextCursor))
    } while (true)
    seen.set(path, records)
    if (records.length) {
      const first = records[0]
      assert.deepEqual(await request(credential.token, path + '/' + encodeURIComponent(first.id)), first)
      assert.deepEqual((await request(credential.token, path + '?id=' + encodeURIComponent(first.id))).records, [first])
    }
  }
  // Meaningful accounting objects and child projections are present through public doors.
  assert.equal(at(seen.get('/bank-accounts'), row => row.id === s.checking.id).number_last4, '4821')
  assert.equal(at(seen.get('/items'), row => row.name === 'Design hour').rate_cents, 15000)
  assert.equal(at(seen.get('/contractors'), row => row.contact_id === vendor.id).tin_masked, '***-**-0042')
  assert.equal(at(seen.get('/budgets'), row => row.name === 'October plan').cells[0].amount_cents, 500000)
  assert.equal(at(seen.get('/custom-reports'), row => row.id === custom.id).definition.basis, 'cash')
  assert.equal(at(seen.get('/management-packages'), row => row.name === 'Private board pack').definition.reportIds[0], custom.id)
  assert.equal(at(seen.get('/recognition-schedules'), row => row.id === recognition.id).plan[0].amount_cents, 4000)
  const invoice = await request(unrelated.token, '/invoices/' + s.inv.cedar.id)
  assert.equal(invoice.open_cents, 0); safe(invoice)
  const viewer = await h.member('synthetic-pantry-2@example.test', 'viewer')
  assert.equal((await h.send('/api/pantry/custom-reports/' + custom.id + '/export.json', undefined, { cookie: viewer })).status, 404, 'Native person sharing stays private after integration delegation')
  for (const path of ['/statements', '/bank-lines', '/matches', '/transfers', '/reconciliations', '/bank-rules', '/recurring-invoices', '/recurring-bills', '/recurring-journals', '/recognition-runs', '/checks', '/check-batches', '/exemptions', '/periods', '/close-tasks', '/findings', '/questions', '/proposals', '/receipts', '/receipt-rules', '/audit-events', '/approvals', '/feed-balances', '/feed-history', '/payrolls', '/contact-history', '/contact-deliveries']) assert.ok(seen.get(path)?.length, path + ' has real recorded activity')
  // Pagination and exact combined filters recover every selected account without duplication.
  const accounts = credentials.get('accounts:read'), found = []
  let cursor = ''
  do {
    const page = await request(accounts.token, '/accounts?limit=2&type=expense&cursor=' + encodeURIComponent(cursor))
    assert.ok(page.records.every(row => row.type === 'expense'))
    found.push(...page.records.map(row => row.id)); cursor = page.nextCursor
  } while (cursor)
  assert.equal(found.length, new Set(found).size)
  assert.equal(found.length, seen.get('/accounts').filter(row => row.type === 'expense').length)
  assert.equal((await request(accounts.token, '/accounts?code=synthetic-pantry-22')).records.length, 0)
  await request(accounts.token, '/accounts?limit=101', 400)
  await request(accounts.token, '/accounts?unexpected=1', 400)
  await request(accounts.token, '/accounts/synthetic-pantry-23', 404)
  await request(accounts.token, '/bank-accounts', 403)
  await request(unrelated.token, '/invoices', 403, { post: true })
  assert.equal((await h.send('/api/pantry/command/period.lock', { period: '2026-10' }, { headers: { authorization: `Bearer ${unrelated.token}` } })).status, 401)
  for (const credential of credentials.values()) await h.command('integration.revoke', { id: credential.id })
  for (const [scope, credential] of credentials) {
    const [path] = routes.find(([, op]) => op.get['x-pantry-scopes'].includes(scope))
    await request(credential.token, path, 401)
  }
  const yearReader = await h.command('integration.create', { name: 'Year-end reader', scopes: ['year-end:read'] })
  const year = await request(yearReader.token, '/year-end/2026')
  assert.equal(year.months.length, 12); assert.equal(year.locked, false); safe(year)
  assert.equal((await h.send('/api/pantry/state', undefined, { headers: { authorization: `Bearer ${yearReader.token}` } })).status, 401)
  await h.close(); closed = true
  const archive = await harness()
  try {
    await archive.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-09-01' })
    const names = { accounts: 'account-list.csv', customers: 'customer-contact-list.csv', vendors: 'vendor-contact-list.csv', trialBalance: 'trial-balance.csv', openInvoices: 'open-invoices.csv', unpaidBills: 'unpaid-bills.csv', generalLedger: 'general-ledger.csv' }
    const files = Object.fromEntries(await Promise.all(Object.entries(names).map(async ([key, name]) => [key, { name, content: await fixture('quickbooks-online/' + name) }])))
    const body = { files, banks: [{ account: 'Operating Checking', institution: 'Chase', last4: '4821', statementBalance: '24813.52' }] }
    const preview = await archive.command('move-in.preview', body)
    await archive.command('move-in.commit', { ...body, fingerprint: preview.fingerprint })
    const credential = await archive.command('integration.create', { name: 'Historical archive reader', scopes: ['cutovers:read'] })
    for (const [path] of routes.filter(([, op]) => op.get['x-pantry-scopes'].includes('cutovers:read'))) {
      const response = await archive.send(api + path, undefined, { headers: { authorization: `Bearer ${credential.token}` } })
      assert.equal(response.status, 200); assert.ok(response.value.records.length); safe(response.value)
    }
  } finally { await archive.close() }
}

