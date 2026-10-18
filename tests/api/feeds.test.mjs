import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'
import { fakePlaid } from './plaid.mjs'

const csv = rows => 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' + rows.map(r => `${r[2] < 0 ? 'DEBIT' : 'CREDIT'},${r[0]},"${r[1]}",${r[2].toFixed(2)},ACH,,`).join('\n') + '\n'
const until = async (check, what) => { for (let i = 0; i < 100; i++) { const v = await check(); if (v) return v; await new Promise(r => setTimeout(r, 50)) } assert.fail(`timed out waiting for ${what}`) }

test('Bank and card feeds: connect once, choose accounts, and transactions arrive by sync, webhook and schedule exactly once, beside imported files, with re-link', async t => {
  // On RER Managed there is no egress for seed integrations yet: one plain line, no provider call.
  const managed = await harness({ bindings: { PLAID_CLIENT_ID: 'x', PLAID_SECRET: 'y', RER_INSTALLATION_ID: 'inst_1', RER_MANAGEMENT_ORIGIN: 'https://runeditrun.com' }, outbound: () => assert.fail('no provider call on Managed') })
  t.after(() => managed.close())
  assert.match((await managed.view('bank/feeds')).availability.reason, /not available yet on RER Managed/)
  await managed.command('feed.link-token', {}, managed.owner, 503)

  const plaid = await fakePlaid()
  const h = await harness({ bindings: plaid.bindings, outbound: plaid.outbound }); t.after(() => h.close())
  const { acct } = await books(h)
  const card = await h.command('account.save', { code: '2150', name: 'Business card', type: 'liability', subtype: 'bank' })
  const checking = await h.command('bank-account.save', { name: 'Operating checking', institution: 'First Platypus Bank', accountId: acct['1000'], numberLast4: '0000', openingDate: '2026-09-30', openingBalance: '1000.00' })
  await h.command('bank-rule.save', { name: 'Adobe', payee: 'Adobe', direction: 'out', accountId: acct['6200'] })
  // A statement file already holds Staples on Oct 4; the feed will bring the same transaction.
  const before = await h.command('statement.import', { bankAccountId: checking.id, fileName: 'checking-early-oct.csv', content: csv([['10/01/2026', 'CHECK 2053', -300], ['10/04/2026', 'STAPLES 00123 BROOKLYN NY', -86.4]]), opening: '1000.00', closing: '613.60', start: '2026-10-01', end: '2026-10-04', confirmLast4: '0000' })
  assert.equal(before.added, 2)

  // Connect: Link token, public token exchange, then the person chooses where each account goes.
  const link = await h.command('feed.link-token', {})
  assert.equal(link.linkToken, plaid.recorded['link-token-create'].link_token)
  assert.deepEqual(at(plaid.state.calls, c => c.path === '/link/token/create').body.products, ['transactions'])
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-public-sandbox-b0e2c4ee-a763-4df5-bfe9-46a46bce993d', institution: { institution_id: 'ins_109508', name: 'First Platypus Bank' } })
  assert.deepEqual(connection.accounts.map(a => a.mask).sort(), ['0000', '1111', '3333'])
  const stored = await h.db.prepare('SELECT access_token FROM pt_feed_items WHERE id = ?').bind(connection.id).first()
  assert.ok(!stored.access_token.includes('access-sandbox'), 'the access token rests encrypted')
  const byMask = m => at(connection.accounts, a => a.mask === m)
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: byMask('3333').id, bankAccountId: checking.id }] }, h.owner, 400)
  const mapped = await h.command('feed.map', { itemId: connection.id, accounts: [
    { id: byMask('0000').id, bankAccountId: checking.id },
    { id: byMask('3333').id, bankAccountId: 'new', new: { name: 'Business card', accountId: card.id, openingDate: '2026-09-30', openingBalance: '0.00' } },
    { id: byMask('1111').id, bankAccountId: '' },
  ] })
  assert.deepEqual([mapped.sync.added, mapped.sync.pending, mapped.sync.filed], [4, 1, 1])
  let { lines, pending } = await h.view('bank/lines')
  const line = (d, date) => at(lines, l => l.description.startsWith(d) && l.posted_date === date)
  assert.deepEqual([line('ADOBE', '2026-10-02').rule_name, line('ADOBE', '2026-10-02').amount_cents], ['Adobe', -5499])
  assert.equal(line('STRIPE TRANSFER', '2026-10-03').amount_cents, 125000)
  assert.equal(line('UNITED AIRLINES', '2026-10-05').bank_name, 'Business card')
  assert.equal(lines.filter(l => l.posted_date === '2026-10-04' && l.amount_cents === -8640).length, 1, 'the feed adopts the file line instead of repeating it')
  assert.ok(line('STAPLES', '2026-10-04').feed_txn_id)
  assert.ok(!lines.some(l => l.description.startsWith('KNOTT') || l.description.startsWith('INTEREST')), 'nothing before the opening date, nothing from an account left out')
  assert.deepEqual(pending.map(p => [p.description, p.amount_cents]), [['UBER *TRIP', -1875]])
  const shown = (await h.view('bank/feeds')).connections[0]
  assert.ok(Date.parse(shown.sync_due_at) > Date.now())
  assert.ok(at(shown.accounts, a => a.mask === '0000').last_synced_at)
  assert.equal(at(shown.accounts, a => a.mask === '1111').last_synced_at, null)

  // A file downloaded after the feed: its Stripe line is the feed's, not a second one.
  const after = await h.command('statement.import', { bankAccountId: checking.id, fileName: 'checking-oct-3.csv', content: csv([['10/03/2026', 'STRIPE TRANSFER ST-X7Y2', 1250]]), opening: '613.60', closing: '1863.60', start: '2026-10-03', end: '2026-10-03', confirmLast4: '0000' })
  assert.deepEqual([after.added, after.fromFeed], [0, 1])

  // A signed webhook says updates are available: the pending ride posts, a fee is removed, a name changes.
  for (const bad of [{ jwt: '' }, { ...(await plaid.webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' }, { tamper: true })) }]) {
    const r = await h.send('/api/pantry/feeds/plaid/webhook', bad.body ? JSON.parse(bad.body) : {}, { headers: { 'plaid-verification': bad.jwt } })
    assert.equal(r.status, 401)
  }
  plaid.state.updatesArrived = true
  const hook = await plaid.webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE', initial_update_complete: true, historical_update_complete: true })
  assert.equal((await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(hook.body), { headers: { 'plaid-verification': hook.jwt } })).status, 200)
  ;({ lines, pending } = await until(async () => { const v = await h.view('bank/lines'); return v.pending.length === 0 && v }, 'the webhook sync'))
  assert.equal(line('UBER', '2026-10-07').amount_cents, -1875)
  assert.ok(!lines.some(l => l.description === 'MONTHLY SERVICE FEE'), 'a transaction the bank removed leaves')
  assert.ok(line('UNITED AIRLINES 0162345678', '2026-10-05'))

  // Syncing again from the start (accounts re-chosen) and the schedule add nothing twice.
  const count = async () => Number((await h.db.prepare('SELECT COUNT(*) AS n FROM pt_bank_lines').first()).n)
  const settled = await count()
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: byMask('0000').id, bankAccountId: checking.id }] })
  await h.db.prepare("UPDATE pt_feed_items SET sync_due_at = '2026-01-01T00:00:00Z'").run()
  await h.cron()
  assert.equal(await count(), settled)
  assert.equal(Number((await h.db.prepare("SELECT COUNT(*) AS n FROM pt_feed_syncs WHERE trigger = 'schedule' AND error_code = ''").first()).n), 1)

  // The bank asks the owner to sign in again: the connection says so plainly, and Re-link opens Link in update mode.
  await h.db.prepare("UPDATE pt_feed_accounts SET last_synced_at = '2026-09-30T12:00:00.000Z' WHERE bank_account_id IS NOT NULL").run()
  plaid.state.loginRequired = true
  await h.db.prepare("UPDATE pt_feed_items SET sync_due_at = '2026-01-01T00:00:00Z'").run()
  await h.view('state')
  const relink = await until(async () => { const c = (await h.view('bank/feeds')).connections[0]; return c.status === 'relink' && c }, 'the due sync from an ordinary request')
  assert.equal(relink.error_code, 'ITEM_LOGIN_REQUIRED')
  const health = (await h.view('bank/feeds')).health[0]
  assert.equal(health.kind, 'broken'); assert.equal(health.requiresRelink, true)
  await until(() => h.mail.find(m => m.subject.startsWith('Pantry:') && m.text.includes('sign in again')), 'owner feed alert')
  const alerts = () => h.mail.filter(m => m.subject.startsWith('Pantry:'))
  assert.ok(alerts().every(m => [m.to].flat().includes('owner@example.test')))
  assert.ok((await h.view('state')).overview.feedHealth.some(n => n.itemId === connection.id))
  const gap = (await h.view('close/2026-10')).checks.find(c => c.key === 'feeds')
  assert.equal(gap.ok, false); assert.ok(gap.items.some(i => i.id === checking.id))

  await h.command('feed.sync', { itemId: connection.id }, h.owner, 409)
  await h.command('feed.link-token', { itemId: connection.id })
  assert.ok(plaid.state.calls.findLast(c => c.path === '/link/token/create').body.access_token, 'update mode names the connection')
  plaid.state.loginRequired = false
  const back = await h.command('feed.relinked', { itemId: connection.id })
  assert.equal(back.connection.status, 'active'); assert.equal(back.sync.error, undefined)
  assert.equal((await h.view('bank/feeds')).health.length, 0)
  const coveredMonth = new Date(Date.now() - 32 * 86400000).toISOString().slice(0, 7)
  assert.equal((await h.view(`close/${coveredMonth}`)).checks.find(c => c.key === 'feeds').ok, true)

  const expired = await plaid.webhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details of this item have changed' } })
  await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(expired.body), { headers: { 'plaid-verification': expired.jwt } })
  assert.equal((await h.view('bank/feeds')).connections[0].status, 'relink')
  const alertCount = alerts().length
  await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(expired.body), { headers: { 'plaid-verification': expired.jwt } })
  assert.equal(alerts().length, alertCount, 'a repeated signed webhook does not repeat the owner email')
  await h.command('feed.relinked', { itemId: connection.id })

  // US consent warnings leave the live feed running; successful pulls cannot erase consent that the owner has not renewed.
  const warning = await plaid.webhook({ webhook_type: 'ITEM', webhook_code: 'PENDING_DISCONNECT', disconnect_time: new Date(Date.now() + 7 * 86400000).toISOString() })
  await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(warning.body), { headers: { 'plaid-verification': warning.jwt } })
  let warned = await h.view('bank/feeds')
  assert.equal(warned.connections[0].status, 'active'); assert.equal(warned.health[0].kind, 'expiring')
  assert.ok(alerts().some(m => m.text.includes('consent expires')))
  await h.command('feed.sync', { itemId: connection.id })
  assert.equal((await h.view('bank/feeds')).health[0].kind, 'expiring')
  await h.command('feed.relinked', { itemId: connection.id })
  assert.equal((await h.view('state')).overview.feedHealth.length, 0)

  // A scheduler outage is visible even without a provider error. Disconnecting clears the alert and retains received lines.
  await h.db.prepare("UPDATE pt_feed_accounts SET last_synced_at = '2026-01-01T00:00:00Z' WHERE bank_account_id IS NOT NULL").run()
  await h.db.prepare("UPDATE pt_feed_items SET sync_due_at = '9999-12-31T00:00:00Z'").run()
  await h.cron()
  assert.equal((await h.view('bank/feeds')).health[0].kind, 'stale')
  assert.ok(alerts().some(m => m.text.includes('Transactions may be missing')))
  const retained = await count()
  await h.command('feed.disconnect', { itemId: connection.id })
  assert.equal(await count(), retained)
  assert.equal((await h.view('state')).overview.feedHealth.length, 0)
  assert.ok((await h.view('reports/trial-balance?to=2026-10-31')).balanced)

})

test('BANK-003 continuous sync of pending and posted lines', async t => {
  const plaid = await fakePlaid()
  // Only the provider edge is controlled. Every books action and observation
  // below goes through the Worker's authenticated command and view routes.
  let page, sequence = 0
  const outbound = async request => {
    if (new URL(request.url).pathname !== '/transactions/sync') return plaid.outbound(request)
    assert.equal(new URL(request.url).origin, 'https://sandbox.plaid.com')
    const body = await request.json()
    if (!page) return Response.json({ accounts: [], added: [], modified: [], removed: [], has_more: false, next_cursor: body.cursor ?? '' })
    const delivered = page; page = undefined
    return Response.json({ accounts: [], added: [], modified: [], removed: [], ...delivered, has_more: false, next_cursor: `transaction-change-${++sequence}` })
  }
  const h = await harness({ bindings: plaid.bindings, outbound }); t.after(() => h.close())
  const { acct } = await books(h)
  const checking = await h.command('bank-account.save', { name: 'Operating checking', institution: 'First Platypus Bank', accountId: acct['1000'], numberLast4: '0000', openingDate: '2026-09-30', openingBalance: '0.00' })
  const cardLedger = await h.command('account.save', { code: '2150', name: 'Business card', type: 'liability', subtype: 'bank' })
  await h.command('bank-rule.save', { name: 'Adobe', payee: 'Adobe', direction: 'out', accountId: acct['6200'] })
  const imported = await h.command('statement.import', { bankAccountId: checking.id, fileName: 'checking-oct-4.csv', content: csv([['10/04/2026', 'STAPLES 00123 BROOKLYN NY', -86.4]]), opening: '0.00', closing: '-86.40', start: '2026-10-01', end: '2026-10-04', confirmLast4: '0000' })
  const first = plaid.recorded['transactions-sync-1'], second = plaid.recorded['transactions-sync-2']
  const adobe = { ...first.added.find(x => x.merchant_name === 'Adobe'), date: '2026-10-05' }
  const staples = second.added.find(x => x.merchant_name === 'Staples')
  const united = second.added.find(x => x.name === 'UNITED AIRLINES')
  const fee = second.added.find(x => x.name === 'MONTHLY SERVICE FEE')
  const authorisation = second.added.find(x => x.pending)
  const withdrawn = { ...fee, transaction_id: `${fee.transaction_id}-withdrawn`, name: 'TEMPORARY BANK CHARGE', date: '2026-10-08', amount: 8 }
  page = { added: [adobe, staples, united, fee, withdrawn, authorisation] }
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-public-sandbox-b0e2c4ee-a763-4df5-bfe9-46a46bce993d', institution: { name: 'First Platypus Bank' } })
  await h.command('feed.map', { itemId: connection.id, accounts: [
    { id: at(connection.accounts, x => x.mask === '0000').id, bankAccountId: checking.id },
    { id: at(connection.accounts, x => x.mask === '3333').id, bankAccountId: 'new', new: { name: 'Business card', accountId: cardLedger.id, openingDate: '2026-09-30', openingBalance: '0.00' } },
  ] })
  let received = await h.view('bank/lines')
  const byTransaction = (view, id) => at(view.lines, x => x.feed_txn_id === id)
  const adopted = byTransaction(received, staples.transaction_id)
  assert.equal(adopted.source, 'file')
  assert.equal(received.pending[0].amount_cents, -1875)
  await h.command('match.approve', { bankLineIds: [authorisation.transaction_id], create: [{ type: 'fee', amount: '18.75', accountId: acct['6200'] }] }, h.owner, 404)
  const pendingPreview = await h.command('bank-rule.preview', { name: 'Uber', payee: 'Uber', direction: 'out', accountId: acct['6200'] })
  assert.equal(pendingPreview.files.length, 0, 'pending authorisations cannot be categorised by rules')
  await h.command('match.approve', { bankLineIds: [byTransaction(received, united.transaction_id).id], create: [{ type: 'fee', amount: '412.50', accountId: acct['6200'] }] })
  await h.command('match.approve', { bankLineIds: [adopted.id], create: [{ type: 'fee', amount: '86.40', accountId: acct['6200'] }] })
  const reconciled = await h.command('reconciliation.complete', { statementId: imported.statement.id })
  assert.ok(reconciled.completed)
  received = await h.view('bank/lines')
  const preserved = [adobe, united, staples].map(x => byTransaction(received, x.transaction_id))
  const journal = await h.view('journal')
  assert.equal((await h.view('bank/feeds')).exceptions.length, 0, 'adopting a differently described file line is not a bank modification')

  const postedRide = { ...plaid.recorded['transactions-sync-3'].added[0], amount: authorisation.amount + 4.18 }
  page = {
    added: [postedRide],
    modified: [{ ...fee, amount: 14, name: 'CORRECTED MONTHLY SERVICE FEE' }, { ...adobe, amount: 55.99 }, { ...staples, amount: 88.4 }],
    removed: [{ transaction_id: united.transaction_id }, { transaction_id: withdrawn.transaction_id }, { transaction_id: authorisation.transaction_id }],
  }
  const hook = await plaid.webhook({ webhook_type: 'TRANSACTIONS', webhook_code: 'SYNC_UPDATES_AVAILABLE' })
  assert.equal((await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(hook.body), { headers: { 'plaid-verification': hook.jwt } })).status, 200)
  received = await until(async () => { const value = await h.view('bank/lines'); return value.pending.length === 0 && value }, 'posted card authorisation')
  assert.equal(byTransaction(received, postedRide.transaction_id).amount_cents, -2293, 'the posted amount includes the $4.18 tip')
  assert.equal(byTransaction(received, fee.transaction_id).amount_cents, -1400, 'an unposted line follows the bank modification')
  assert.ok(!received.lines.some(x => x.feed_txn_id === withdrawn.transaction_id), 'an unposted line the bank removes leaves the queue')
  let exceptions = (await h.view('bank/feeds')).exceptions
  assert.deepEqual(exceptions.map(x => [x.kind, x.protection]).sort(), [['modified', 'categorised'], ['modified', 'reconciled'], ['removed', 'matched']])
  assert.equal(at(exceptions, x => x.bank_line_id === adopted.id).providerChange.amountCents, -8840)
  assert.ok(exceptions.every(x => x.name && x.preservedLine.description && x.bank_name), 'each exception names the bank change and preserved line')
  assert.deepEqual(preserved.map(x => byTransaction(received, x.feed_txn_id)), preserved, 'categorised, matched and file-adopted reconciled lines remain intact')
  assert.deepEqual(await h.view('journal'), journal, 'the webhook never rewrites or adds ledger postings')
  assert.deepEqual((await h.view(`reconciliation/${imported.statement.id}`)).completed, reconciled.completed, 'the completed proof is untouched')

  // Manual and scheduled paths cover the opposite changes on all protected states.
  const changes = { modified: [{ ...united, amount: 422.5 }], removed: [{ transaction_id: adobe.transaction_id }, { transaction_id: staples.transaction_id }] }
  page = { modified: changes.modified }
  await h.command('feed.sync', { itemId: connection.id })
  assert.equal((await h.view('bank/feeds')).exceptions.length, 4)
  page = { removed: changes.removed }
  // Only advance the saved due time; the actual Worker's Cron handler performs the sync.
  await h.db.prepare('UPDATE pt_feed_items SET sync_due_at = ? WHERE id = ?').bind('2026-01-01T00:00:00Z', connection.id).run()
  await h.cron()
  received = await h.view('bank/lines')
  exceptions = (await h.view('bank/feeds')).exceptions
  assert.deepEqual(exceptions.map(x => [x.kind, x.protection]).sort(), [['modified', 'categorised'], ['modified', 'matched'], ['modified', 'reconciled'], ['removed', 'categorised'], ['removed', 'matched'], ['removed', 'reconciled']])
  assert.equal(byTransaction(received, staples.transaction_id).feed_txn_id, adopted.feed_txn_id, 'removing an adopted statement line retains its provider identity')
  assert.deepEqual(preserved.map(x => byTransaction(received, x.feed_txn_id)), preserved)
  assert.deepEqual(await h.view('journal'), journal, 'manual refresh and the schedule also preserve the ledger')
  assert.deepEqual((await h.view(`reconciliation/${imported.statement.id}`)).completed, reconciled.completed)
  page = changes
  await h.command('feed.sync', { itemId: connection.id })
  assert.deepEqual((await h.view('bank/feeds')).exceptions, exceptions, 'replayed observations do not repeat named exceptions')
  await h.command('feed.disconnect', { itemId: connection.id })
  assert.deepEqual((await h.view('bank/feeds')).exceptions, exceptions, 'disconnecting retains unresolved bank discrepancies')
})

// Opt-in provider proof. Only credentials explicitly injected by name are used.
// The disposable receiver sees sandbox Item callbacks only; all tokens stay in memory.
test('BANK-004 real Plaid sandbox: login failure and signed consent webhook reach owner, dashboard and close', { skip: process.env.PLAID_LIVE_PROOF !== '1', timeout: 180000 }, async t => {
  const clientId = process.env.PLAID_CLIENT_ID, secret = process.env.PLAID_SANDBOX_SECRET
  assert.ok(clientId && secret, 'inject the named sandbox credentials for this proof')
  const call = async (path, data) => {
    const r = await fetch(`https://sandbox.plaid.com${path}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ client_id: clientId, secret, ...data }) })
    const value = await r.json()
    if (!r.ok) throw new Error(`Plaid ${path} refused (${r.status}, ${value.error_code ?? 'unknown'})`)
    return value
  }
  const receiverResponse = await fetch('https://webhook.site/token', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ default_status: 200, default_content: 'Received' }) })
  assert.equal(receiverResponse.status, 201, 'disposable sandbox webhook receiver created')
  const receiver = (await receiverResponse.json()).uuid
  t.after(async () => { await fetch(`https://webhook.site/token/${receiver}`, { method: 'DELETE' }) })
  let accessToken
  t.after(async () => { if (accessToken) await call('/item/remove', { access_token: accessToken }) })
  const created = await call('/sandbox/public_token/create', { institution_id: 'ins_109508', initial_products: ['transactions'], options: { webhook: `https://webhook.site/${receiver}` } })
  // The same sandbox public token can be exchanged only once, so capture its
  // result while forwarding Pantry's genuine exchange, without changing it.
  const outbound = async request => {
    assert.equal(new URL(request.url).origin, 'https://sandbox.plaid.com')
    const r = await fetch(request.url, { method: request.method, headers: { 'content-type': 'application/json', 'plaid-version': '2020-09-14' }, body: await request.text() })
    const content = await r.text()
    if (new URL(request.url).pathname === '/item/public_token/exchange' && r.ok) accessToken = JSON.parse(content).access_token
    return new Response(content, { status: r.status, headers: { 'content-type': 'application/json' } })
  }
  const h = await harness({ bindings: { PLAID_CLIENT_ID: clientId, PLAID_SECRET: secret, PLAID_ENV: 'sandbox' }, outbound })
  t.after(() => h.close())
  const { acct } = await books(h)
  const account = await h.command('bank-account.save', { name: 'Sandbox checking', institution: 'First Platypus Bank', accountId: acct['1000'], numberLast4: '0000', openingDate: '2026-01-01', openingBalance: '0.00' })
  const connection = await h.command('feed.connect', { publicToken: created.public_token, institution: { name: 'First Platypus Bank' } })
  const checking = connection.accounts.find(a => a.mask === '0000')
  assert.ok(checking, 'real sandbox checking account received')
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: checking.id, bankAccountId: account.id }] })
  // US consent expiry uses PENDING_DISCONNECT. Plaid supplies the body and the
  // signature; Pantry retrieves Plaid's real signing key before accepting it.
  const fired = await call('/sandbox/item/fire_webhook', { access_token: accessToken, webhook_type: 'ITEM', webhook_code: 'PENDING_DISCONNECT' })
  assert.equal(fired.webhook_fired, true)
  let callback
  for (let i = 0; i < 45 && !callback; i++) {
    const r = await fetch(`https://webhook.site/token/${receiver}/requests?sorting=newest`)
    if (r.ok) callback = (await r.json()).data.find(x => { try { return JSON.parse(x.content).webhook_code === 'PENDING_DISCONNECT' } catch { return false } })
    if (!callback) await new Promise(resolve => setTimeout(resolve, 1000))
  }
  assert.ok(callback, 'received the actual Plaid sandbox consent callback')
  const header = Object.entries(callback.headers).find(([name]) => name.toLowerCase() === 'plaid-verification')?.[1]
  const jwt = Array.isArray(header) ? header[0] : header
  assert.ok(jwt, 'Plaid signed its callback')
  const received = await h.send('/api/pantry/feeds/plaid/webhook', undefined, { raw: callback.content, headers: { 'plaid-verification': jwt } })
  assert.equal(received.status, 200)
  const notices = (await h.view('state')).overview.feedHealth
  assert.equal(notices[0].kind, 'expiring')
  assert.ok(h.mail.some(m => m.subject.startsWith('Pantry:') && m.text.includes('consent expires')))
  const mailCount = h.mail.length
  assert.equal((await h.send('/api/pantry/feeds/plaid/webhook', undefined, { raw: callback.content, headers: { 'plaid-verification': jwt } })).status, 200)
  assert.equal(h.mail.length, mailCount, 'real callback replay sends no duplicate alert')
  await call('/sandbox/item/reset_login', { access_token: accessToken })
  await h.db.prepare("UPDATE pt_feed_accounts SET last_synced_at = '2026-09-30T12:00:00Z' WHERE bank_account_id IS NOT NULL").run()
  const failed = await h.command('feed.sync', { itemId: connection.id })
  assert.equal(failed.sync.error, 'ITEM_LOGIN_REQUIRED')
  assert.equal((await h.view('bank/feeds')).health[0].kind, 'broken')
  assert.ok(h.mail.some(m => m.subject.startsWith('Pantry:') && m.text.includes('sign in again')))
  assert.equal((await h.view('close/2026-10')).checks.find(c => c.key === 'feeds').ok, false)
  await h.command('feed.link-token', { itemId: connection.id })

  t.diagnostic('Real Plaid sandbox: create/exchange/accounts/sync; reset_login -> ITEM_LOGIN_REQUIRED; update-mode Link token; signed PENDING_DISCONNECT delivered and verified with live provider key; owner emails accepted at mail network edge; dashboard/close/replay checks passed. Sandbox Item and disposable receiver removed.')
})
