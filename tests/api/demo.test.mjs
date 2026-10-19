// "Try the demo": the real Worker behind Base's demo door seeds Juniper Lane's
// books on the first request, and every moment the homepage sells is there to
// open, through the same views the app reads. No provider is called.
import test from 'node:test'
import assert from 'node:assert/strict'
import { at, harness } from './harness.mjs'

test('DEMO-001 the demo opens on the homepage\'s moments: a question with its answer and net-income change, receipts, a recurring and a sent invoice, a 1099 contractor, a split payout and this month\'s revenue', async t => {
  const h = await harness({ entry: 'tests/api/demo-worker.ts', bindings: { RER_DEMO: '1' }, outbound: request => assert.fail(`the demo called ${request.method} ${request.url}`) })
  t.after(h.close)

  const questions = await h.view('questions')
  const waiting = at(questions.open, q => q.status === 'confirm')
  assert.equal(waiting.subject_kind, 'bank-line')
  assert.match(waiting.pending.effect, /net income \$[\d,.]+ → \$[\d,.]+/, 'the owner\'s answer shows what it does to net income')
  assert.ok(waiting.messages.some(m => m.body === waiting.pending.read), 'the owner\'s own words are in the thread')
  at(questions.settled, q => q.status === 'filed' && q.result_kind === 'document')

  const receipts = await h.view('receipts')
  at(receipts.review, r => r.read_status === 'read' && r.candidates.length > 0)
  at(receipts.attached, r => r.rule_id && r.linked_kind === 'journal')

  const sales = await h.view('sales'), month = new Date().toISOString().slice(0, 7)
  const recurring = at(sales.recurring, r => r.every === 1 && r.unit === 'month' && r.status === 'active')
  const occurrence = at(recurring.runs_list, r => r.invoice_number)
  assert.equal(at(sales.invoices, i => i.number === occurrence.invoice_number).status, 'issued')
  const sent = at(sales.invoices, i => i.sent_at && i.viewed_at)
  at(sales.deliveries, d => d.invoice_id === sent.id && d.status === 'accepted')

  const tax = await h.view(`reports/contractors?year=${month.slice(0, 4)}`)
  assert.ok(tax.forms.some(f => f.ready && f.box1 >= tax.threshold), 'a contractor is over the 1099-NEC threshold with her W-9 on file')

  const { payouts } = await h.view('connected')
  const payout = at(payouts.payouts, p => p.status === 'booked')
  assert.ok(payout.charges > 1 && payout.fee_cents > 0 && payout.gross_cents - payout.fee_cents === payout.amount_cents, 'split into sales and fees')
  assert.ok(payout.match, 'matched to its deposit')

  const pnl = await h.view(`reports/profit-and-loss?from=${month}-01&to=${new Date().toISOString().slice(0, 10)}&basis=accrual`)
  assert.ok(pnl.totalIncome > 0, 'this month has revenue')

  const feeds = await h.view('bank/feeds')
  assert.ok(feeds.connections.length && feeds.connections.flatMap(c => c.accounts).every(a => a.balance_cents > 0), 'every connected account carries a balance')
})
