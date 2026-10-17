import test from 'node:test'
import assert from 'node:assert/strict'
import { at, fixture, harness } from './harness.mjs'
import { importStatements, matchSeptember, september } from './scenario.mjs'

const count = async (h, sql) => Number((await h.db.prepare(sql).first()).n)

test('PAN-07 CSV and OFX statements import against the right bank account, and repeats create no duplicates', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await september(h)
  const csv = await fixture('bank/operating-checking-2026-09.csv'), ofx = await fixture('bank/savings-2026-09.ofx')
  const base = { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-09.csv', content: csv, opening: '24813.52', closing: '27797.02', start: '2026-09-01', end: '2026-09-30' }
  await h.command('statement.import', { ...base, confirmLast4: '9999' }, h.owner, 409)
  const first = await h.command('statement.import', { ...base, confirmLast4: '4821' })
  assert.deepEqual([first.added, first.duplicates, first.fileBalances.agrees], [7, 0, true])
  const again = await h.command('statement.import', { ...base, confirmLast4: '4821' })
  assert.equal(again.duplicate, true); assert.equal(again.added, 0)
  // A later download overlapping the same days adds only what is new.
  const extended = csv + 'DEBIT,09/30/2026,"MONTHLY SERVICE FEE",-12.00,FEE_TRANSACTION,27785.02,\n'
  const overlap = await h.command('statement.import', { ...base, fileName: 'checking-sep-full.csv', content: extended, closing: '27785.02', confirmLast4: '4821' })
  assert.deepEqual([overlap.added, overlap.duplicates], [1, 7])
  assert.equal(await count(h, 'SELECT COUNT(*) AS n FROM pt_bank_lines'), 8)
  // OFX names its account: the savings statement is refused for checking and accepted for savings.
  const wrong = await h.send('/api/pantry/command/statement.import', { bankAccountId: s.checking.id, fileName: 'savings-2026-09.ofx', content: ofx }, { cookie: h.owner })
  assert.equal(wrong.status, 409); assert.match(wrong.value.error, /ending 7730/)
  const sav = await h.command('statement.import', { bankAccountId: s.reserve.id, fileName: 'savings-2026-09.ofx', content: ofx })
  assert.deepEqual([sav.added, sav.statement.closing_cents, sav.statement.opening_cents, sav.statement.end_date], [2, 200125, 0, '2026-09-30'])
  await h.command('statement.import', { bankAccountId: s.reserve.id, fileName: 'savings.csv', content: 'Date,Description,Amount\n09/15/2026,Transfer,2000.00\n', opening: '0', closing: '2000', confirmLast4: '7730' }, h.owner, 409)
  // Statements are evidence, not postings, and the exact file is kept.
  assert.equal(await count(h, "SELECT COUNT(*) AS n FROM pt_journal_entries WHERE source_kind = 'bank'"), 0)
  const doc = await h.db.prepare('SELECT CAST(content AS TEXT) AS text FROM pt_documents WHERE id = ?').bind(first.statement.document_id).first()
  assert.equal(doc.text, csv)
  await h.command('statement.import', { ...base, fileName: 'bad.csv', content: 'When,What\n09/01/2026,x\n', confirmLast4: '4821' }, h.owner, 400)
})

test('PAN-08 statement lines match to the books through splits, fees, transfers and partial settlements, never posting a recorded payment twice', async t => {
  const h = await harness(); t.after(() => h.close())
  const entries = () => count(h, "SELECT COUNT(*) AS n FROM pt_journal_entries WHERE status = 'posted'")
  const s = await september(h), before = await entries(), st = await importStatements(h, s)
  const r = await h.view(`reconciliation/${st.checking.id}`)
  const ln = text => at(r.lines, l => l.description.includes(text))
  // The Cedar payment recorded on 3 September meets its bank line, which names Cedar, as the statement arrives: no new posting.
  const cedar = at(r.postings, p => p.memo.includes('Payment from Cedar Studio') && p.entry_date === '2026-09-03')
  assert.ok(ln('CEDAR STUDIO').automatic); assert.equal(ln('CEDAR STUDIO').match_id, cedar.match_id)
  assert.equal(await entries(), before)
  await h.command('match.approve', { bankLineIds: [ln('CEDAR STUDIO').id], journalLineIds: [cedar.id] }, h.owner, 409)
  const unbalanced = await h.send('/api/pantry/command/match.approve', { bankLineIds: [ln('SERVICE FEE').id], create: [{ type: 'fee', amount: '10.00', accountId: s.acct['6400'] }] }, { cookie: h.owner })
  assert.equal(unbalanced.status, 400); assert.match(unbalanced.value.error, /does not balance/)
  // A fee and a vendor payment the books lack, a partial customer receipt, a transfer, a split deposit and a cheque.
  await matchSeptember(h, s, st)
  const after = await h.view(`reconciliation/${st.checking.id}`)
  assert.equal(after.lines.filter(l => !l.match_id).length, 0, 'every checking line is matched')
  const fee = await h.db.prepare("SELECT e.memo, l.debit_cents FROM pt_journal_entries e JOIN pt_journal_lines l ON l.entry_id = e.id JOIN pt_accounts a ON a.id = l.account_id WHERE e.source_kind = 'bank' AND a.code = '6400'").first()
  assert.equal(fee.debit_cents, 1200)
  const northstar = at((await h.view('sales')).invoices, i => i.id === s.inv.northstar.id)
  assert.equal(northstar.open_cents, 385000 - 150000, 'a partial settlement leaves the rest open')
  const square = at(after.lines, l => l.description.includes('SQUARE'))
  assert.equal(await count(h, `SELECT COUNT(*) AS n FROM pt_match_postings mp JOIN pt_match_bank_lines mb ON mb.match_id = mp.match_id WHERE mb.bank_line_id = '${square.id}' AND mp.active = 1`), 2, 'one deposit splits across two receipts')
  const sav = await h.view(`reconciliation/${st.savings.id}`)
  assert.equal(sav.lines.filter(l => !l.match_id).length, 0, 'the transfer clears on both accounts')
  const tb = await h.view('reports/trial-balance?to=2026-09-30')
  assert.ok(tb.balanced)
  assert.equal(at(tb.rows, x => x.code === '1010').net, 200125)
})

test('PAN-09 a statement reconciles only when its balances are proven, and every difference is explained first', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await september(h)
  // A statement whose stated closing does not follow from its lines is blocked.
  const csv = await fixture('bank/operating-checking-2026-09.csv')
  const bad = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking.csv', content: csv, opening: '24813.52', closing: '27800.00', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  let r = await h.view(`reconciliation/${bad.statement.id}`)
  assert.ok(r.blockers.some(b => b.kind === 'statement' && b.amount === 298)); assert.ok(r.blockers.some(b => b.kind === 'unmatched'))
  assert.equal(r.ready, false)
  await h.command('reconciliation.complete', { statementId: bad.statement.id }, h.owner, 409)
  await h.command('statement.correct-balances', { id: bad.statement.id, opening: '24813.52', closing: '27797.02', reason: 'Closing balance mistyped from the PDF statement' })
  const st = { checking: bad.statement, savings: (await h.command('statement.import', { bankAccountId: s.reserve.id, fileName: 'savings-2026-09.ofx', content: await fixture('bank/savings-2026-09.ofx') })).statement }
  await matchSeptember(h, s, st)
  r = await h.view(`reconciliation/${st.checking.id}`)
  assert.deepEqual([r.difference, r.cleared, r.ready], [0, 2779702, true])
  const done = await h.command('reconciliation.complete', { statementId: st.checking.id })
  assert.equal(done.completed.closing_cents, 2779702)
  // Its matches are now part of the proof.
  const match = await h.db.prepare('SELECT id FROM pt_matches WHERE reconciliation_id IS NOT NULL').first()
  await h.command('match.undo', { id: match.id }, h.owner, 409)
  await h.command('reconciliation.complete', { statementId: st.checking.id }, h.owner, 409)
  // A posting not yet on any statement is an outstanding item, not a difference.
  await h.command('payment.record', { direction: 'paid', contactId: s.c['Harbor Office Rentals'].id, date: '2026-09-29', amount: '50.00', bankAccountId: s.checking.id })
  const savingsState = await h.view(`reconciliation/${st.savings.id}`)
  assert.equal(savingsState.ready, true)
  const next = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'checking-oct.csv', content: 'Posting Date,Description,Amount\n10/02/2026,CHECK 2053,-50.00\n', opening: '27797.02', closing: '27747.02', start: '2026-10-01', end: '2026-10-31', confirmLast4: '4821' })
  r = await h.view(`reconciliation/${next.statement.id}`)
  assert.ok(r.blockers.some(b => b.kind === 'unmatched'))
  await h.command('match.approve', { bankLineIds: [r.lines[0].id], journalLineIds: [at(r.postings, p => p.memo.includes('Payment to Harbor') && p.entry_date === '2026-09-29').id] })
  assert.equal((await h.view(`reconciliation/${next.statement.id}`)).ready, true)
})

test('PAN-08 a payment recorded from its bank line is applied to its bill, and a payment recorded first meets its own bank line', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await september(h)
  // The starter chart's credit card is a bank or card account from the start.
  const card = await h.command('bank-account.save', { name: 'Business card', institution: 'Chase', accountId: s.acct['2100'], numberLast4: '5555', routing: '', openingDate: '2026-08-31', openingBalance: '0.00' })
  const acme = await h.command('contact.save', { kind: 'vendor', name: 'Acme Contractors', termsDays: 30 })
  const bill = await h.command('bill.save', { vendorId: acme.id, reference: 'A-778', billDate: '2026-09-10', lines: [{ description: 'Contract design', accountId: s.acct['6000'], amount: '1500.00' }], post: true })
  // Recorded before the statement arrives: the check meets its line by itself, with nothing posted twice.
  const check = await h.command('payment.record', { direction: 'paid', contactId: s.c['Harbor Office Rentals'].id, date: '2026-09-25', amount: '75.00', bankAccountId: card.id, reference: '2061', method: 'check' })
  const csv = 'Posting Date,Description,Amount\n09/24/2026,ACH DEBIT ACME CONTRACTORS A-778,-1500.00\n09/26/2026,CHECK 2061,-75.00\n'
  const imported = await h.command('statement.import', { bankAccountId: card.id, fileName: 'card-2026-09.csv', content: csv, opening: '0', closing: '-1575.00', start: '2026-09-01', end: '2026-09-30', confirmLast4: '5555' })
  assert.deepEqual(imported.recorded.map(m => [m.payment, m.amount]), [[check.id, -7500]])
  const r = await h.view(`reconciliation/${imported.statement.id}`)
  assert.ok(at(r.lines, l => l.description === 'CHECK 2061').automatic)
  // Paid from the bank line without saying what it pays, as a person might: the bill stays open and close says so.
  const acmeLine = at(r.lines, l => l.description.includes('ACME'))
  await h.command('match.approve', { bankLineIds: [acmeLine.id], create: [{ type: 'payment', amount: '1500.00', contactId: acme.id }] })
  let close = await h.view('close/2026-09')
  const unapplied = at(close.checks, c => c.key === 'unapplied')
  assert.equal(unapplied.ok, false); assert.match(unapplied.detail, /\$1,500\.00 paid to Acme Contractors/)
  const cashBefore = await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')
  assert.equal(cashBefore.expenses.find(e => e.code === '6000'), undefined, 'an unapplied payment pays no expense yet')
  // Applied afterwards from Payments: the bill is paid and the cash basis counts it in September.
  const payment = at((await h.view('sales')).payments, p => p.contact_id === acme.id)
  await h.command('payment.allocate', { paymentId: payment.id, allocations: [{ targetId: bill.id, amount: '1500.00' }] })
  assert.equal(at((await h.view('sales')).bills, b => b.id === bill.id).open_cents, 0)
  const cash = await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')
  assert.equal(at(cash.expenses, e => e.code === '6000').amount, 150000)
  assert.equal(cash.netIncome, cashBefore.netIncome - 150000)
  close = await h.view('close/2026-09')
  assert.equal(at(close.checks, c => c.key === 'unapplied').ok, true)
  assert.ok(!(await h.view('reports/payables?to=2026-09-30')).items.some(i => i.ref === 'A-778'), 'A-778 leaves the payables aging')
})
