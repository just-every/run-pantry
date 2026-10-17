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
  plaid.state.loginRequired = true
  await h.db.prepare("UPDATE pt_feed_items SET sync_due_at = '2026-01-01T00:00:00Z'").run()
  await h.view('state')
  const relink = await until(async () => { const c = (await h.view('bank/feeds')).connections[0]; return c.status === 'relink' && c }, 'the due sync from an ordinary request')
  assert.equal(relink.error_code, 'ITEM_LOGIN_REQUIRED')
  await h.command('feed.sync', { itemId: connection.id }, h.owner, 409)
  await h.command('feed.link-token', { itemId: connection.id })
  assert.ok(plaid.state.calls.findLast(c => c.path === '/link/token/create').body.access_token, 'update mode names the connection')
  plaid.state.loginRequired = false
  const back = await h.command('feed.relinked', { itemId: connection.id })
  assert.equal(back.connection.status, 'active'); assert.equal(back.sync.error, undefined)
  const expired = await plaid.webhook({ webhook_type: 'ITEM', webhook_code: 'ERROR', error: { error_type: 'ITEM_ERROR', error_code: 'ITEM_LOGIN_REQUIRED', error_message: 'the login details of this item have changed' } })
  await h.send('/api/pantry/feeds/plaid/webhook', JSON.parse(expired.body), { headers: { 'plaid-verification': expired.jwt } })
  assert.equal((await h.view('bank/feeds')).connections[0].status, 'relink')
  assert.ok((await h.view('reports/trial-balance?to=2026-10-31')).balanced)
})
