import assert from 'node:assert/strict'

export async function approvedWriteOffJourney({ h, acct, customer, bea, ann, bank }) {
  const receivables = async () => { const r = await h.send('/api/pantry/reports/receivables?to=2026-10-30', undefined, { cookie: h.owner }); assert.equal(r.status, 200); return r.value }
  bea = await h.member('writeoff-bookkeeper@example.test', 'bookkeeper', { canPost: true })
  const badDebt = await h.command('account.save', { code: '6950', name: 'Bad debts', type: 'expense' })
  const makeInvoice = async (amount, self = false) => {
    let inv = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-01', dueDate: '2026-09-30', lines: [{ description: 'Uncollectible design work', quantity: '1', rate: amount, accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
    if (self) return h.command('invoice.approve-issue', { id: inv.id, revision: inv.revision, limitRevision: (await h.view('state', bea)).settings.issuingLimits.effective.revision }, bea)
    inv = await h.command('invoice.approve', { id: inv.id, revision: inv.revision }, ann)
    return h.command('invoice.issue', { id: inv.id }, bea)
  }
  const source = await makeInvoice('120.00')
  const body = { invoiceId: source.id, date: '2026-10-30', accountId: badDebt.id, reason: 'Customer closed the business' }
  await h.command('write-off.bulk', { kind: 'invoice', ceiling: '120', date: body.date, accountId: badDebt.id, ids: [source.id] }, ann, 403)
  await h.command('write-off.prepare', { ...body, accountId: acct['1200'] }, bea, 409)
  await h.command('write-off.prepare', { ...body, date: '2026-08-31' }, bea, 409)
  const credit = await h.command('write-off.prepare', body, bea)
  assert.deepEqual([credit.kind, credit.status, credit.write_off, credit.early_discount, credit.total_cents, credit.tax_cents], ['credit', 'draft', 1, 0, 12000, 0])
  assert.equal(credit.lines[0].account_id, badDebt.id)
  await h.command('invoice.save-draft', { id: credit.id, revision: credit.revision }, bea, 409)
  await h.command('invoice.issue', { id: credit.id }, bea, 409)
  await h.command('invoice.approve', { id: credit.id, revision: credit.revision }, bea, 403)
  await h.command('issuing-limit.save', { id: 'role:bookkeeper', issuing: '1000', credit: '100' })
  const limit = async () => (await h.view('state', bea)).settings.issuingLimits.effective
  await h.command('invoice.approve-issue', { id: credit.id, revision: credit.revision, limitRevision: (await limit()).revision }, bea, 403)
  const approved = await h.command('invoice.approve', { id: credit.id, revision: credit.revision }, ann)
  const noPost = await h.member('writeoff-clerk@example.test', 'bookkeeper')
  await h.command('invoice.issue', { id: approved.id }, noPost, 403)
  const before = await receivables()
  const issued = await h.command('invoice.issue', { id: approved.id }, ann)
  assert.equal(issued.write_off, 1)
  const after = await receivables()
  assert.equal(after.itemsTotal, before.itemsTotal - 12000); assert.equal(after.agrees, true)
  const entry = (await h.view('journal')).entries.find(e => e.id === issued.journal_id)
  assert.deepEqual(entry.lines.map(l => [l.account_id, l.debit_cents, l.credit_cents]), [[acct['1200'], 0, 12000], [badDebt.id, 12000, 0]])
  await h.command('invoice.issue', { id: issued.id }, ann, 409)
  // A permitted preparer's own credit still cannot correct their self-approved invoice.
  await h.command('issuing-limit.save', { id: 'role:bookkeeper', issuing: '1000', credit: '200', revision: (await limit()).revision })
  const own = await makeInvoice('120', true)
  const ownCredit = await h.command('write-off.prepare', { ...body, invoiceId: own.id }, bea)
  await h.command('invoice.approve-issue', { id: ownCredit.id, revision: ownCredit.revision, limitRevision: (await limit()).revision }, bea, 403)
  await h.command('invoice.approve', { id: ownCredit.id, revision: ownCredit.revision }, bea, 403)
  await h.command('invoice.approve', { id: ownCredit.id, revision: ownCredit.revision }, ann)
  await h.command('invoice.issue', { id: ownCredit.id }, ann)
  const within = await makeInvoice('120')
  const withinCredit = await h.command('write-off.prepare', { ...body, invoiceId: within.id }, bea)
  const self = await h.command('invoice.approve-issue', { id: withinCredit.id, revision: withinCredit.revision, limitRevision: (await limit()).revision }, bea)
  assert.equal(self.status, 'issued'); assert.equal(JSON.parse(self.self_approval).limit, 20000)
  // A payment after approval must refuse the old reviewed balance, atomically.
  const stale = await makeInvoice('120')
  const staleCredit = await h.command('write-off.prepare', { ...body, invoiceId: stale.id }, bea)
  await h.command('invoice.approve', { id: staleCredit.id, revision: staleCredit.revision }, ann)
  await h.command('payment.record', { direction: 'received', contactId: customer.id, date: body.date, amount: '20', bankAccountId: bank.id, allocations: [{ targetId: stale.id, amount: '20' }] })
  await h.command('invoice.issue', { id: staleCredit.id }, ann, 409)
  assert.equal((await h.view('sales')).invoices.find(i => i.id === staleCredit.id).journal_id, null)
  assert.equal((await receivables()).agrees, true)
}
