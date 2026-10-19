import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, fixture, harness } from './harness.mjs'
import { fakePlaid } from './plaid.mjs'
import { closeReady, importStatements, matchSeptember, september } from './scenario.mjs'

const late = 'DEBIT,09/29/2026,"ADOBE *CREATIVE CLD 408-536-6000 CA",-54.99,DEBIT_CARD,27742.03,\n'
const november = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,11/02/2026,"ADOBE *CREATIVE CLD 408-536-6000 CA",-54.99,DEBIT_CARD,28568.52,\nDEBIT,11/04/2026,"BLUE BOTTLE COFFEE",-6.50,DEBIT_CARD,28562.02,\n'

test('RULE-002 bank rules that file routine lines', async t => {
  const plaid = await fakePlaid()
  const h = await harness({ bindings: plaid.bindings, outbound: plaid.outbound }); t.after(() => h.close())
  const s = await september(h), st = await importStatements(h, s)
  await matchSeptember(h, s, st); await closeReady(h, s, st)
  await h.command('period.lock', { period: '2026-09' })
  const oct = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking-2026-10.csv', content: await fixture('bank/operating-checking-2026-10.csv'), opening: '27797.02', closing: '28623.51', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
  assert.deepEqual([oct.added, oct.filedByRule], [9, 0])
  const lines = async () => (await h.view('bank/lines')).lines
  const line = async (description, date) => at(await lines(), l => l.description.startsWith(description) && l.posted_date === date)

  // A person files Adobe to Software three times; Pantry suggests a rule.
  for (const [d, date] of [['ADOBE *CREATIVE', '2026-10-02'], ['ADOBE *ACROPRO', '2026-10-06'], ['ADOBE *STOCK', '2026-10-13']]) {
    const l = await line(d, date)
    await h.command('match.approve', { bankLineIds: [l.id], create: [{ type: 'fee', direction: 'out', amount: (-l.amount_cents / 100).toFixed(2), accountId: s.acct['6200'] }] })
  }
  const suggested = at((await h.view('bank/rules')).suggestions, x => x.payee === 'Adobe')
  assert.deepEqual([suggested.accountId, suggested.direction, suggested.count], [s.acct['6200'], 'out', 3])

  // Two more real, manually filed charges give the creation preview six historical matches.
  const csv = rows => 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\n' + rows.map(([date, description, amount]) => `DEBIT,${date},"${description}",-${amount},DEBIT_CARD,,`).join('\n') + '\n'
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'adobe-history.csv', content: csv([['10/20/2026', 'ADOBE ARCHIVE', '1.00'], ['10/21/2026', 'ADOBE ARCHIVE', '1.00']]), opening: '100.00', closing: '98.00', start: '2026-10-20', end: '2026-10-21', confirmLast4: '4821' })
  for (const date of ['2026-10-20', '2026-10-21']) await h.command('match.approve', { bankLineIds: [(await line('ADOBE ARCHIVE', date)).id], create: [{ type: 'fee', direction: 'out', amount: '1.00', accountId: s.acct['6200'] }] })

  // Preview before saving shows exactly the open line it would file; saving with "file these" files it, marked by rule.
  const adobe = { name: 'Adobe', payee: suggested.payee, direction: 'out', accountId: s.acct['6200'], memo: 'Adobe subscription' }
  const preview = await h.command('bank-rule.preview', adobe)
  assert.deepEqual(preview.files.map(l => l.posted_date), ['2026-10-29'])
  assert.deepEqual(preview.earlier.map(l => l.posted_date), ['2026-10-29', '2026-10-21', '2026-10-20', '2026-10-13', '2026-10-06', '2026-10-02'])
  const saved = await h.command('bank-rule.save', { ...adobe, fileExisting: true })
  assert.equal(saved.filed, 1)
  const filed = await line('ADOBE *CREATIVE', '2026-10-29')
  assert.deepEqual([filed.rule_name, filed.filed_to], ['Adobe', ['Software and subscriptions']])
  assert.equal((await h.view('bank/rules')).suggestions.length, 0, 'a payee with a rule is no longer suggested')

  // A late September line arrives in an overlapping download: the month is locked and reconciled, so no rule files it.
  const sepFile = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking-sep-late.csv', content: (await fixture('bank/operating-checking-2026-09.csv')) + late, opening: '24813.52', closing: '27742.03', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  assert.deepEqual([sepFile.added, sepFile.filedByRule], [1, 0])
  const held = await h.command('bank-rule.preview', { ...adobe, id: saved.rule.id })
  assert.deepEqual([held.files.length, held.held.length, held.held[0].posted_date], [0, 1, '2026-09-29'])
  assert.match(held.held[0].reason, /2026-09 is locked/)
  assert.equal((await line('ADOBE *CREATIVE', '2026-09-29')).match_id, null)

  // A split with a tax code: the tax code's share goes to its account, the rest splits 60/40.
  const comcast = await h.command('bank-rule.save', { name: 'Comcast internet', payee: 'Comcast', direction: 'out', splits: [{ accountId: s.acct['6200'], percent: '60' }, { accountId: s.acct['6100'], percent: '40' }], taxCodeId: s.tax.id, contactId: s.c['Brightline Software'].id, fileExisting: true })
  assert.equal(comcast.filed, 1)
  const entry = at((await h.view('journal')).entries, e => e.memo.endsWith('by rule Comcast internet'))
  assert.deepEqual(entry.lines.map(l => `${l.account_code}:${l.debit_cents}:${l.credit_cents}`).sort(), ['1000:0:12900', '2200:1052:0', '6100:4739:0', '6200:7109:0'])

  // New lines that match are filed as they arrive; undo reverses the entry and leaves the line to a person.
  const nov = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking-2026-11.csv', content: november, opening: '28623.51', closing: '28562.02', start: '2026-11-01', end: '2026-11-30', confirmLast4: '4821' })
  assert.deepEqual([nov.added, nov.filedByRule], [2, 1])
  const arrived = await line('ADOBE *CREATIVE', '2026-11-02')
  assert.equal(arrived.rule_name, 'Adobe')
  assert.equal((await line('BLUE BOTTLE', '2026-11-04')).match_id, null)
  const undone = await h.command('bank-rule.undo', { matchId: arrived.match_id })
  const after = await line('ADOBE *CREATIVE', '2026-11-02')
  assert.deepEqual([after.match_id, after.rules_off], [null, 1])
  const reversal = at((await h.view('journal')).entries, e => e.id === undone.reversal)
  assert.equal(reversal.status, 'posted'); assert.ok(reversal.reverses_id)
  assert.ok(!(await h.command('bank-rule.preview', { ...adobe, id: saved.rule.id })).files.some(l => l.id === arrived.id), 'an undone line stays out of rules')

  // The person chooses priority; a higher-priority suggestion holds the line even with an automatic rule behind it.
  const coffee = { name: 'Coffee review', descriptionContains: 'BLUE BOTTLE COFFEE', descriptionMode: 'equals', direction: 'out', bankAccountId: s.checking.id, mode: 'suggest', priority: 0, accountId: s.acct['6100'] }
  for (const priority of [-1, 0.5]) await h.command('bank-rule.save', { ...coffee, priority }, h.owner, 400)
  const suggest = await h.command('bank-rule.save', { ...coffee, fileExisting: true })
  assert.equal(suggest.filed, 0)
  const autoCoffee = await h.command('bank-rule.save', { ...coffee, name: 'Coffee automatically', mode: 'automatic', priority: 1, fileExisting: true })
  assert.equal(autoCoffee.filed, 0)
  const coffeePreview = await h.command('bank-rule.preview', { ...coffee, id: suggest.rule.id })
  assert.deepEqual([coffeePreview.count, coffeePreview.suggested.length], [0, 1])
  assert.ok((await h.view('bank/rules')).suggestedLines.some(l => l.ruleId === suggest.rule.id))
  const coffeeImport = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'coffee-modes.csv', content: csv([['11/05/2026', 'BLUE BOTTLE COFFEE', '6.50'], ['11/06/2026', 'BLUE BOTTLE COFFEE EXTRA', '6.50']]), opening: '100.00', closing: '87.00', start: '2026-11-05', end: '2026-11-06', confirmLast4: '4821' })
  assert.equal(coffeeImport.filedByRule, 0, 'suggestion never posts; equals excludes the longer description')
  const contains = await h.command('bank-rule.preview', { ...coffee, descriptionMode: 'contains', id: suggest.rule.id })
  assert.equal(contains.suggested.length, 3)
  const reordered = await h.command('bank-rule.save', { ...coffee, id: suggest.rule.id, revision: suggest.rule.revision, priority: 2, fileExisting: true })
  assert.equal(reordered.filed, 0)
  const promoted = await h.command('bank-rule.save', { ...coffee, id: autoCoffee.rule.id, revision: autoCoffee.rule.revision, name: 'Coffee automatically', mode: 'automatic', priority: 0, fileExisting: true })
  assert.equal(promoted.filed, 2)
  assert.equal((await line('BLUE BOTTLE COFFEE EXTRA', '2026-11-06')).match_id, null)

  // Amount splits must total the gross statement line exactly. A mismatch holds, with no fallthrough.
  const amountRule = { name: 'Coffee amount split', descriptionContains: 'BLUE BOTTLE COFFEE EXTRA', descriptionMode: 'equals', priority: 0, splitMode: 'amount', splits: [{ accountId: s.acct['6200'], amount: '4.00' }, { accountId: s.acct['6100'], amount: '2.00' }] }
  const mismatch = await h.command('bank-rule.save', { ...amountRule, fileExisting: true })
  assert.equal(mismatch.filed, 0)
  const fallback = await h.command('bank-rule.save', { name: 'Later coffee category', descriptionContains: amountRule.descriptionContains, descriptionMode: 'equals', priority: 1, accountId: s.acct['6100'], fileExisting: true })
  assert.equal(fallback.filed, 0, 'the first matching rule holds an amount mismatch instead of falling through')
  assert.match((await h.command('bank-rule.preview', { ...amountRule, id: mismatch.rule.id })).held[0].reason, /equal the statement line/)
  const exact = await h.command('bank-rule.save', { ...amountRule, id: mismatch.rule.id, revision: mismatch.rule.revision, splits: [{ accountId: s.acct['6200'], amount: '4.00' }, { accountId: s.acct['6100'], amount: '2.50' }], fileExisting: true })
  assert.equal(exact.filed, 1)
  const amountLine = await line('BLUE BOTTLE COFFEE EXTRA', '2026-11-06')
  const amountEntry = at((await h.view('journal')).entries, e => e.source_id === amountLine.id)
  assert.deepEqual(amountEntry.lines.filter(l => l.debit_cents).map(l => l.debit_cents).sort((a, b) => a - b), [250, 400])

  // A feed arrival uses the saved revision, and later edits/retirement cannot change its evidence or postings.
  const feedAdobe = plaid.recorded['transactions-sync-1'].added[0]
  Object.assign(feedAdobe, { date: '2026-12-01', authorized_date: '2026-12-01', transaction_id: 'rule-adobe-feed-december' })
  Object.assign(plaid.recorded['transactions-sync-1'], { added: [feedAdobe], has_more: false })
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-public-sandbox-b0e2c4ee-a763-4df5-bfe9-46a46bce993d', institution: { institution_id: 'ins_109508', name: 'First Platypus Bank' } })
  const mapped = await h.command('feed.map', { itemId: connection.id, accounts: connection.accounts.map(a => ({ id: a.id, bankAccountId: a.mask === '0000' ? s.checking.id : '' })) })
  assert.equal(mapped.sync.filed, 1)
  const fed = await line('ADOBE', '2026-12-01')
  assert.equal(fed.rule_id, saved.rule.id)
  const evidence = async id => at((await h.view('bank/rules')).filings, f => f.bank_line_id === id)
  const retained = await evidence(fed.id)
  assert.equal(retained.rule_revision, saved.rule.revision)
  assert.equal(retained.rule_snapshot.memo, adobe.memo)
  const beforeEntries = (await h.view('journal')).entries.filter(e => [fed.id, filed.id].includes(e.source_id))
  const edited = await h.command('bank-rule.save', { ...adobe, id: saved.rule.id, revision: saved.rule.revision, name: 'Adobe changed', accountId: s.acct['6100'], memo: 'Changed after filing' })
  assert.deepEqual(await evidence(fed.id), retained)
  assert.deepEqual([(await line('ADOBE', '2026-12-01')).rule_name, (await line('ADOBE', '2026-12-01')).rule_revision], [adobe.name, retained.rule_revision])
  await h.command('bank-rule.retire', { id: edited.rule.id, revision: edited.rule.revision })
  assert.deepEqual(await evidence(fed.id), retained)
  assert.deepEqual((await h.view('journal')).entries.filter(e => [fed.id, filed.id].includes(e.source_id)), beforeEntries)

  // Ties use creation time and then ID consistently in the saved order, preview and import.
  const tied = { descriptionContains: 'TIE PURCHASE', descriptionMode: 'equals', direction: 'out', priority: 5 }
  const tieA = await h.command('bank-rule.save', { ...tied, name: 'First tied category', accountId: s.acct['6200'] })
  const tieB = await h.command('bank-rule.save', { ...tied, name: 'Second tied category', accountId: s.acct['6100'] })
  const expected = [tieA.rule, tieB.rule].sort((a, b) => a.created_at < b.created_at ? -1 : a.created_at > b.created_at ? 1 : a.id < b.id ? -1 : 1)
  assert.deepEqual((await h.view('bank/rules')).rules.filter(r => expected.some(e => e.id === r.id)).map(r => r.id), expected.map(r => r.id))
  await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'tied-rules.csv', content: csv([['12/02/2026', 'TIE PURCHASE', '7.00']]), opening: '100.00', closing: '93.00', start: '2026-12-02', end: '2026-12-02', confirmLast4: '4821' })
  assert.equal((await line('TIE PURCHASE', '2026-12-02')).rule_id, expected[0].id)

  // Only people who record may make rules, and the books still balance.
  const viewer = await h.member('vic@example.test', 'viewer')
  await h.command('bank-rule.save', { ...adobe, name: 'Adobe again' }, viewer, 403)
  assert.ok((await h.view('reports/trial-balance?to=2026-11-30&basis=accrual')).balanced)
})


test('RULE-003 learned line suggestions follow human corrections and show decision rates for history, vendors and documents without posting', async t => {
  const reading = { receipt: true, vendor: 'DOC MERCHANT', date: '2026-09-09', total: '64.18', currency: 'USD', category: '6200', note: '' }
  const h = await harness({ outbound: async request => {
    assert.equal(new URL(request.url).hostname, 'api.anthropic.com')
    return Response.json({ content: [{ type: 'text', text: JSON.stringify(reading) }], stop_reason: 'end_turn' })
  } }); t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-08-31', openingBalance: '10000.00' })
  const rows = [...[1,2,3,4,5,6,7].map(day => [`09/0${day}/2026`, 'ADOBE', '-20.00']), ['09/08/2026', 'Willow Office', '-35.00'], ['09/09/2026', 'DOC MERCHANT', '-64.18']]
  await h.command('statement.import', { bankAccountId: bank.id, fileName: 'learned-lines.csv', content: 'Posting Date,Description,Amount\n' + rows.map(r => r.join(',')).join('\n') + '\n', opening: '10000.00', closing: '9760.82', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  const queue = () => h.view('bank/lines')
  const file = (line, accountId) => h.command('match.approve', { bankLineIds: [line.id], create: [{ type: 'fee', amount: (Math.abs(line.amount_cents) / 100).toFixed(2), direction: 'out', accountId }] })
  let q = await queue()
  const adobe = q.lines.filter(l => l.description === 'ADOBE').sort((a,b) => a.posted_date.localeCompare(b.posted_date))
  assert.equal(Object.keys(q.suggestions).length, 0)
  for (const line of adobe.slice(0,5)) await file(line, acct['6200'])
  q = await queue()
  const sixth = q.suggestions[adobe[5].id]
  assert.equal(sixth.accountId, acct['6200']); assert.equal(sixth.source, 'history'); assert.equal(sixth.evidenceCount, 5)
  assert.ok(sixth.reason.includes(sixth.payee) && sixth.reason.includes(sixth.accountName))
  assert.ok(sixth.confidence > 0 && sixth.confidence < 100)
  assert.equal(q.lines.find(l => l.id === adobe[5].id).match_id, null, 'advice never posts')
  await file(adobe[5], acct['6300'])
  q = await queue()
  assert.equal(q.suggestions[adobe[6].id].accountId, acct['6300'], 'latest changed choice guides the next line instead of an older majority')
  const history = q.suggestionRates.find(r => r.source === 'history')
  assert.deepEqual([history.accepted, history.changed], [4,1])
  assert.equal(history.acceptanceRate, Math.round(100 * history.accepted / history.total))
  assert.equal(history.changeRate, Math.round(100 * history.changed / history.total))
  const historyEvents = (await h.view('activity?kind=bank-line')).audit.filter(a => a.action === 'suggestion.decision')
  assert.equal(historyEvents.length, 5)
  assert.ok(historyEvents.every(a => a.actor_kind === 'person'))

  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Willow Office', termsDays: 30, defaultAccountId: acct['6300'] })
  q = await queue()
  const willow = q.lines.find(l => l.description === vendor.name), defaultSuggestion = q.suggestions[willow.id]
  assert.deepEqual([defaultSuggestion.source, defaultSuggestion.contactId, defaultSuggestion.accountId], ['vendor', vendor.id, acct['6300']])
  await file(willow, acct['6100'])
  assert.deepEqual((await queue()).suggestionRates.filter(r => r.source === 'vendor').map(r => [r.accepted, r.changed]), [[0,1]])

  await h.command('reader.save', { provider: 'anthropic', model: 'claude-sonnet-5-5', key: 'synthetic-reader-key' })
  const form = new FormData(); form.set('file', new Blob(['Documented software receipt $64.18'], { type: 'text/plain' }), 'software-receipt.txt')
  const captured = await fetch(`${h.origin}/api/pantry/receipts/capture`, { method: 'POST', headers: { origin: h.origin, cookie: h.owner }, body: form })
  assert.equal(captured.status, 200)
  const capturedId = (await captured.json()).id
  const receipt = (await h.view('receipts')).review.find(r => r.id === capturedId)
  const docVendor = await h.command('contact.save', { kind: 'vendor', name: reading.vendor, termsDays: 30 })
  const bill = await h.command('bill.save', { vendorId: docVendor.id, reference: 'DOC-64', billDate: '2026-09-09', lines: [{ description: 'Documented software', accountId: acct['6200'], amount: '64.18' }], post: true })
  await h.command('receipt.attach', { id: receipt.id, revision: receipt.revision, targetKind: 'bill', targetId: bill.id })
  q = await queue()
  const documented = q.lines.find(l => l.description === reading.vendor)
  assert.deepEqual([q.suggestions[documented.id].source, q.suggestions[documented.id].accountId], ['document', acct['6200']])
  assert.ok(q.suggestions[documented.id].reason.includes('software-receipt.txt'))
  assert.equal(q.suggestions[documented.id].billId, bill.id)
  await h.command('match.approve', { bankLineIds: [documented.id], create: [{ type: 'payment', contactId: docVendor.id, amount: '64.18', allocations: [{ targetId: bill.id, amount: '64.18' }] }] })
  assert.equal((await h.view('sales')).bills.find(b => b.id === bill.id).open_cents, 0)
  assert.equal((await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=accrual')).expenses.find(a => a.id === acct['6200']).amount, 16418, 'payment settles the bill without posting its expense twice')
  assert.deepEqual((await queue()).suggestionRates.filter(r => r.source === 'document').map(r => [r.accepted, r.changed]), [[1,0]])
  await h.command('bank-rule.save', { name: 'Adobe owner review', payee: 'Adobe', accountId: acct['6200'], mode: 'suggest' })
  q = await queue()
  assert.equal(q.suggestions[adobe[6].id], undefined, 'a covering rule owns this line in either mode')
  assert.equal(q.lines.find(l => l.id === adobe[6].id).match_id, null)
  assert.ok((await h.view('reports/trial-balance?to=2026-09-30&basis=accrual')).balanced)
})
