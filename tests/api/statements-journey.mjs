import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'

export async function statementsJourney({ h, customer, day, acct, bank, privateNote }) {
  const body = { customerId: customer.id, mode: 'open-items', from: '2026-01-01', to: day, idempotencyKey: 'synthetic-pantry-statement-1' }
  const before = h.mail.length
  const [statement, replay] = await Promise.all([h.command('statement.send', body), h.command('statement.send', body)])
  assert.equal(statement.id, replay.id)
  assert.equal(h.mail.length - before, 2, 'one message for each billing and copy recipient despite overlapping sends')
  assert.equal(statement.closing_balance_cents, 80000)
  assert.equal(statement.open_invoice_cents, 90000)
  assert.equal(statement.unallocated_payment_cents, 10000)
  assert.ok(statement.rows.some(r => r.kind === 'invoice' && r.balance_cents === 90000))
  assert.ok(statement.rows.some(r => r.kind === 'payment' && r.balance_cents === 10000))
  assert.ok(statement.deliveries.every(d => d.status === 'accepted' && d.provider_message_id))
  for (const m of h.mail.slice(before)) {
    assert.equal(m.html, statement.html)
    assert.doesNotMatch(m.html + m.text, new RegExp(privateNote))
    assert.match(m.text, /800\.00/)
  }
  const retained = await h.send(statement.document_href, undefined, { cookie: h.owner })
  assert.equal(retained.status, 200)
  assert.equal(retained.value, statement.html)
  assert.equal(createHash('sha256').update(retained.value).digest('hex'), statement.sha256)
  assert.equal((await h.send(statement.document_href)).status, 401)
  assert.equal((await h.view('statements/' + statement.id)).closing_balance_cents, 80000)
  await h.command('statement.send', body)
  assert.equal(h.mail.length - before, 2)
  await h.command('statement.send', { ...body, mode: 'transaction-list' }, h.owner, 409)
  const history = await h.view(`customers/${customer.id}?to=${day}`)
  assert.equal(history.sections.statements.available, true)
  assert.equal(history.sections.statements.rows[0].id, statement.id)
  assert.equal(history.deliveries.filter(d => d.kind === 'statement').length, 2)
  assert.ok(history.deliveries.filter(d => d.kind === 'statement').every(d => d.href === statement.document_href))
  for (const mode of ['balance-forward', 'transaction-list']) {
    const s = await h.command('statement.send', { ...body, mode, from: day, idempotencyKey: 'synthetic-pantry-' + mode })
    assert.equal(s.opening_balance_cents + s.rows.reduce((sum, r) => sum + r.amount_cents, 0), s.closing_balance_cents)
    assert.equal(s.closing_balance_cents, 80000)
    assert.deepEqual(s.rows.map(r => r.kind).sort(), ['credit', 'invoice', 'payment'])
  }
  const viewer = await h.member('statement-viewer@example.test', 'viewer')
  assert.equal((await h.send(statement.document_href, undefined, { cookie: viewer })).status, 200)
  await h.command('statement.send', { ...body, idempotencyKey: 'synthetic-pantry-viewer' }, viewer, 403)
  const clerk = await h.member('statement-clerk@example.test', 'payables-clerk')
  await h.view('statements/' + statement.id, clerk, 403)
  const limited = await h.member('statement-limited@example.test', 'bookkeeper', { bankAccounts: [] })
  await h.view('statements/' + statement.id, limited, 403)
  await h.command('statement.send', { ...body, idempotencyKey: 'synthetic-pantry-limited' }, limited, 403)
  // Later settlement changes the live books, never the statement already sent.
  await h.command('payment.record', { direction: 'received', contactId: customer.id, date: day, amount: '900', bankAccountId: bank.id })
  assert.notEqual((await h.view(`customers/${customer.id}?to=${day}`)).summary.open_balance_cents, statement.closing_balance_cents)
  assert.equal((await h.send(statement.document_href, undefined, { cookie: h.owner })).value, statement.html)
}
