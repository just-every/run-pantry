import assert from 'node:assert/strict'

export async function lateFeeJourney({ h, acct, customer, bea, ann }) {
  const prepared = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-01', dueDate: '2026-09-30', lines: [{ description: 'Unpaid design work', quantity: '1', rate: '1200', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  await h.command('invoice.approve', { id: prepared.id, revision: prepared.revision }, ann)
  const original = await h.command('invoice.issue', { id: prepared.id }, bea)
  let { policy } = await h.view('late-fees')
  assert.equal(policy.enabled, false)
  const request = { invoiceId: original.id, date: '2026-10-30', idempotencyKey: 'synthetic-pantry-fee-1' }
  await h.command('late-fee.prepare', request, bea, 409)
  const settings = { revision: policy.revision, enabled: true, method: 'percentage', percentage: '1.5', graceDays: 30, incomeAccountId: acct['4000'], taxCode: 'exempt' }
  await h.command('late-fee-policy.save', settings, bea, 403)
  await h.command('late-fee-policy.save', settings)
  await h.command('late-fee.prepare', { ...request, date: '2026-10-29' }, bea, 409)
  const receivables = async () => {
    const response = await h.send('/api/pantry/reports/receivables?to=2026-10-30', undefined, { cookie: h.owner })
    assert.equal(response.status, 200); return response.value
  }
  const before = await receivables()
  const [a, b] = await Promise.all([h.command('late-fee.prepare', request, bea), h.command('late-fee.prepare', request, bea)])
  assert.equal(a.invoiceId, b.invoiceId)
  assert.equal(a.draft.status, 'draft')
  assert.equal(a.draft.total_cents, 1800)
  assert.equal(a.draft.customer_id, customer.id)
  assert.equal(a.preparation.basis_cents, 120000)
  assert.match(a.draft.memo, new RegExp(original.number))
  assert.equal((await receivables()).itemsTotal, before.itemsTotal)
  await h.command('invoice.issue', { id: a.invoiceId }, bea, 409)
  await h.command('invoice.approve', { id: a.invoiceId, revision: a.draft.revision }, bea, 403)
  const approved = await h.command('invoice.approve', { id: a.invoiceId, revision: a.draft.revision }, ann)
  const issued = await h.command('invoice.issue', { id: approved.id }, bea)
  assert.equal(issued.total_cents, 1800)
  const after = await receivables()
  assert.equal(after.itemsTotal, before.itemsTotal + 1800)
  assert.equal(after.agrees, true)
  // The owner may choose a flat fee for another original invoice.
  policy = (await h.view('late-fees')).policy
  await h.command('late-fee-policy.save', { ...settings, revision: policy.revision, method: 'flat', flatAmount: '12.50' })
  const second = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-01', dueDate: '2026-09-30', lines: [{ description: 'Second engagement', quantity: '1', rate: '600', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  await h.command('invoice.approve', { id: second.id, revision: second.revision }, ann)
  await h.command('invoice.issue', { id: second.id }, bea)
  const flat = await h.command('late-fee.prepare', { ...request, invoiceId: second.id, idempotencyKey: 'synthetic-pantry-fee-2' }, bea)
  assert.equal(flat.draft.total_cents, 1250)
  await h.command('late-fee.prepare', { ...request, invoiceId: issued.id, date: '2026-12-01', idempotencyKey: 'synthetic-pantry-no-compounding' }, bea, 409)
}
