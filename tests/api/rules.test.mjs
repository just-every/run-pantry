import test from 'node:test'
import assert from 'node:assert/strict'
import { at, fixture, harness } from './harness.mjs'
import { closeReady, importStatements, matchSeptember, september } from './scenario.mjs'

const late = 'DEBIT,09/29/2026,"ADOBE *CREATIVE CLD 408-536-6000 CA",-54.99,DEBIT_CARD,27742.03,\n'
const november = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,11/02/2026,"ADOBE *CREATIVE CLD 408-536-6000 CA",-54.99,DEBIT_CARD,28568.52,\nDEBIT,11/04/2026,"BLUE BOTTLE COFFEE",-6.50,DEBIT_CARD,28562.02,\n'

test('Bank rules: a suggested rule previews, files routine lines by rule with undo, splits with tax, and never touches a locked month', async t => {
  const h = await harness(); t.after(() => h.close())
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

  // Preview before saving shows exactly the open line it would file; saving with "file these" files it, marked by rule.
  const adobe = { name: 'Adobe', payee: suggested.payee, direction: 'out', accountId: s.acct['6200'], memo: 'Adobe subscription' }
  const preview = await h.command('bank-rule.preview', adobe)
  assert.deepEqual(preview.files.map(l => l.posted_date), ['2026-10-29'])
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
  const entry = await h.db.prepare("SELECT GROUP_CONCAT(a.code || ':' || l.debit_cents || ':' || l.credit_cents, ' ') AS lines FROM pt_journal_lines l JOIN pt_accounts a ON a.id = l.account_id JOIN pt_journal_entries e ON e.id = l.entry_id WHERE e.memo LIKE '%by rule Comcast internet' ORDER BY l.line_no").first()
  assert.deepEqual(entry.lines.split(' ').sort(), ['1000:0:12900', '2200:1052:0', '6100:4739:0', '6200:7109:0'])

  // New lines that match are filed as they arrive; undo reverses the entry and leaves the line to a person.
  const nov = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking-2026-11.csv', content: november, opening: '28623.51', closing: '28562.02', start: '2026-11-01', end: '2026-11-30', confirmLast4: '4821' })
  assert.deepEqual([nov.added, nov.filedByRule], [2, 1])
  const arrived = await line('ADOBE *CREATIVE', '2026-11-02')
  assert.equal(arrived.rule_name, 'Adobe')
  assert.equal((await line('BLUE BOTTLE', '2026-11-04')).match_id, null)
  const undone = await h.command('bank-rule.undo', { matchId: arrived.match_id })
  const after = await line('ADOBE *CREATIVE', '2026-11-02')
  assert.deepEqual([after.match_id, after.rules_off], [null, 1])
  const reversal = await h.db.prepare('SELECT status, reverses_id FROM pt_journal_entries WHERE id = ?').bind(undone.reversal).first()
  assert.equal(reversal.status, 'posted'); assert.ok(reversal.reverses_id)
  assert.ok(!(await h.command('bank-rule.preview', { ...adobe, id: saved.rule.id })).files.some(l => l.id === arrived.id), 'an undone line stays out of rules')

  // Only people who record may make rules, and the books still balance.
  const viewer = await h.member('vic@example.test', 'viewer')
  await h.command('bank-rule.save', { ...adobe, name: 'Adobe again' }, viewer, 403)
  assert.ok((await h.view('reports/trial-balance?to=2026-11-30')).balanced)
})
