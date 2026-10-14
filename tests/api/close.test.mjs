import test from 'node:test'
import assert from 'node:assert/strict'
import { at, harness } from './harness.mjs'
import { closeReady, importStatements, matchSeptember, september } from './scenario.mjs'

async function reconciledSeptember(h) {
  const s = await september(h), st = await importStatements(h, s)
  await matchSeptember(h, s, st)
  return { s, st }
}

test('PAN-12 trial balance, general ledger, profit and loss, balance sheet and ageing all come from the same ledger', async t => {
  const h = await harness(); t.after(() => h.close())
  await reconciledSeptember(h)
  const lines = (await h.db.prepare("SELECT a.code, a.type, SUM(l.debit_cents - l.credit_cents) AS net FROM pt_journal_lines l JOIN pt_journal_entries e ON e.id = l.entry_id JOIN pt_accounts a ON a.id = l.account_id WHERE e.status = 'posted' AND e.entry_date <= '2026-09-30' GROUP BY a.code").all()).results
  const net = code => Number(lines.find(l => l.code === code)?.net ?? 0)
  const tb = await h.view('reports/trial-balance?to=2026-09-30')
  assert.ok(tb.balanced)
  for (const row of tb.rows) assert.equal(row.net, net(row.code), `${row.code} matches its posted lines`)
  const pl = await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30')
  const income = -lines.filter(l => l.type === 'income').reduce((s, l) => s + Number(l.net), 0), expense = lines.filter(l => l.type === 'expense').reduce((s, l) => s + Number(l.net), 0)
  assert.deepEqual([pl.totalIncome, pl.totalExpenses, pl.netIncome], [income, expense, income - expense])
  assert.equal(pl.totalIncome, 2400 * 100 + 385000 + 180000 + 120000 + 125, 'September revenue plus savings interest')
  const bs = await h.view('reports/balance-sheet?to=2026-09-30')
  assert.ok(bs.balanced); assert.equal(at(bs.equity, e => e.id === 'current-earnings').amount, pl.netIncome)
  const gl = await h.view(`reports/general-ledger?from=2026-09-01&to=2026-09-30`)
  const checking = at(gl.accounts, a => a.code === '1000')
  assert.equal(checking.opening, 2481352); assert.equal(checking.closing, net('1000')); assert.equal(checking.closing, 2779702, 'book cash equals the reconciled statement')
  const ar = await h.view('reports/receivables?to=2026-09-30'), ap = await h.view('reports/payables?to=2026-09-30')
  assert.deepEqual([ar.itemsTotal, ar.control.balance, ar.agrees], [235000, net('1200'), true])
  assert.deepEqual([ap.itemsTotal, ap.control.balance, ap.agrees], [0, -net('2000') || 0, true])
  assert.equal(at(ar.items, i => i.contact === 'Northstar Consulting').open, 235000)
})

test('PAN-13 a period closes through its checklist and lock; locked dates refuse people and agents; reopening needs an approved request', async t => {
  const h = await harness(); t.after(() => h.close())
  const { s, st } = await reconciledSeptember(h)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true, canReopen: true })
  let close = await h.view('close/2026-09')
  assert.deepEqual(close.checks.filter(c => !c.ok).map(c => c.key).sort(), ['bank', 'evidence'])
  await h.command('period.lock', { period: '2026-09' }, h.owner, 409)
  close = await closeReady(h, s, st)
  assert.ok(close.checks.every(c => c.ok)); assert.ok(close.ready)
  await h.command('period.lock', { period: '2026-09' }, bea, 403)
  const locked = await h.command('period.lock', { period: '2026-09' })
  assert.equal(locked.status, 'locked')
  // People: postings, drafts, payments and matches dated in September are refused.
  const draft = await h.send('/api/pantry/command/journal.save-draft', { date: '2026-09-20', memo: 'Late accrual', lines: [{ accountId: s.acct['6500'], debit: '10.00' }, { accountId: s.acct['3000'], credit: '10.00' }] }, { cookie: bea })
  assert.equal(draft.status, 409); assert.match(draft.value.error, /locked/)
  await h.command('payment.record', { direction: 'paid', contactId: s.c['Harbor Office Rentals'].id, date: '2026-09-29', amount: '5.00', bankAccountId: s.checking.id }, bea, 409)
  await h.command('journal.reverse', { id: s.paid.harbor.journal_id, date: '2026-09-30' }, ann, 409)
  const lateLine = [{ description: 'Late work', quantity: '1', rate: '40.00', accountId: s.acct['4000'], taxCode: 'exempt' }]
  await h.command('invoice.save-draft', { customerId: s.c['Cedar Studio'].id, issueDate: '2026-09-15', lines: lateLine }, bea, 409)
  const october = await h.command('invoice.save-draft', { customerId: s.c['Cedar Studio'].id, issueDate: '2026-10-02', lines: lateLine }, bea)
  await h.command('invoice.save-draft', { id: october.id, revision: october.revision, customerId: s.c['Cedar Studio'].id, issueDate: '2026-09-15', lines: lateLine }, bea, 409)
  await h.command('bill.save', { vendorId: s.c['Harbor Office Rentals'].id, reference: 'LATE-1', billDate: '2026-09-15', lines: [{ description: 'Late bill', accountId: s.acct['6500'], amount: '40.00' }] }, bea, 409)
  // The database refuses too, whatever the caller.
  await assert.rejects(h.db.batch([h.db.prepare("INSERT INTO pt_journal_entries (id, entry_date, memo, source_kind, status, prepared_by, prepared_kind, revision, created_at) VALUES ('x', '2026-09-15', 'x', 'manual', 'draft', 'x', 'person', 'r', 'now')")]), /PANTRY_PERIOD_LOCKED/)
  // Agents: a proposal dated in the locked month is refused when filed.
  const agent = await h.agent()
  const doc = await h.command('document.upload', { name: 'late.txt', mediaType: 'text/plain', base64: Buffer.from('Late invoice dated 2026-09-28, $40').toString('base64') })
  await agent.call('proposals', { kind: 'journal', summary: 'Late accrual', payload: { date: '2026-09-28', memo: 'Late accrual', documentId: doc.id, passages: ['$40'], lines: [{ accountId: s.acct['6500'], debit: '40.00' }, { accountId: s.acct['3000'], credit: '40.00' }] } }, 409)
  // October stays open.
  await h.command('journal.save-draft', { date: '2026-10-01', memo: 'October accrual', lines: [{ accountId: s.acct['6500'], debit: '10.00' }, { accountId: s.acct['3000'], credit: '10.00' }] }, bea)
  // Reopening: requested with a reason, approved by someone else with the grant.
  await h.command('period.decide-reopen', { id: 'none', decision: 'approve' }, bea, 403)
  const requested = await h.command('period.request-reopen', { period: '2026-09', reason: 'Vendor credit for September arrived late' }, bea)
  const request = requested.requests[0]
  await h.command('period.request-reopen', { period: '2026-09', reason: 'again' }, bea, 409)
  const reopened = await h.command('period.decide-reopen', { id: request.id, decision: 'approve', note: 'Approved for the vendor credit' }, ann)
  assert.equal(reopened.status, 'open')
  assert.deepEqual(reopened.approvals.map(a => [a.action, a.decision, a.actor_email]), [['reopen', 'approved', 'ann@example.test'], ['lock', 'approved', 'owner@example.test']])
  await h.command('journal.save-draft', { date: '2026-09-20', memo: 'Vendor credit', lines: [{ accountId: s.acct['2000'], debit: '10.00' }, { accountId: s.acct['6200'], credit: '10.00' }] }, bea, 400)
  await h.command('journal.save-draft', { date: '2026-09-20', memo: 'Late accrual', lines: [{ accountId: s.acct['6500'], debit: '10.00' }, { accountId: s.acct['3000'], credit: '10.00' }] }, bea)
})

test('PAN-14 the accountant package holds the period\'s reports, reconciliations, approvals and reversal history', async t => {
  const h = await harness(); t.after(() => h.close())
  const { s, st } = await reconciledSeptember(h)
  const fix = await h.command('journal.save-draft', { date: '2026-09-29', memo: 'Equipment', lines: [{ accountId: s.acct['1500'], debit: '300.00' }, { accountId: s.acct['3000'], credit: '300.00' }] })
  const posted = await h.command('journal.post', { id: fix.id, revision: fix.revision })
  await h.command('journal.reverse', { id: posted.id, date: '2026-09-30', memo: 'Belonged to October' })
  await closeReady(h, s, st)
  await h.command('period.lock', { period: '2026-09' })
  const viewer = await h.member('acct@example.test', 'viewer')
  const response = await fetch(`${h.origin}/api/pantry/package/2026-09`, { headers: { cookie: viewer } })
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /pantry-close-2026-09\.json/)
  const pkg = await response.json()
  assert.equal(pkg.entity.legalName, 'Juniper Lane Design LLC'); assert.equal(pkg.close.status, 'locked')
  assert.ok(pkg.trialBalance.balanced); assert.ok(pkg.balanceSheet.balanced); assert.ok(pkg.receivables.agrees)
  assert.deepEqual(pkg.reconciliations.map(r => [r.bank, r.closing_cents]).sort(), [['Operating checking', 2779702], ['Savings', 200125]])
  assert.deepEqual(pkg.reversals.map(r => r.reverses_number), [posted.number])
  assert.ok(pkg.approvals.some(a => a.subject_kind === 'period' && a.action === 'lock'))
  assert.ok(pkg.documents.some(d => d.name === 'brightline-inv-88.pdf' && d.sha256.length === 64))
  const csv = await (await fetch(`${h.origin}/api/pantry/package/2026-09/general-ledger.csv`, { headers: { cookie: viewer } })).text()
  assert.match(csv.split('\r\n')[0], /^Account code,Account,Date,Entry/)
  assert.ok(csv.includes('Belonged to October'))
  assert.equal((await fetch(`${h.origin}/api/pantry/package/2026-09`)).status, 401)
})
