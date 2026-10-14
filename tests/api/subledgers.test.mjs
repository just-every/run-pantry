import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

async function setup(h) {
  const { acct } = await books(h)
  const tax = await h.command('tax-code.save', { name: 'New York City', rate: '8.875', accountId: acct['2200'] })
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Willow Services', termsDays: 30 })
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Brightline Software', termsDays: 15 })
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-08-31', openingBalance: '0.00' })
  return { acct, tax, customer, vendor, bank }
}
const journalOf = async (h, id) => at((await h.view('journal')).entries, e => e.id === id)

test('PAN-04 invoices are drafted, approved and issued; unknown tax stops approval; credits reduce what is owed', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, tax, customer } = await setup(h)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  let inv = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-02', lines: [
    { description: 'Brand workshop', quantity: '8', rate: '175.00', accountId: acct['4000'], taxCode: 'exempt' },
    { description: 'Printed style guides', quantity: '2', rate: '200.00', accountId: acct['4000'], taxCode: '' }] }, bea)
  assert.equal(inv.due_date, '2026-10-02')
  const refused = await h.send('/api/pantry/command/invoice.approve', { id: inv.id, revision: inv.revision }, { cookie: ann })
  assert.equal(refused.status, 409); assert.match(refused.value.error, /Tax treatment needed before approval: line 2/)
  inv = await h.command('invoice.save-draft', { id: inv.id, revision: inv.revision, customerId: customer.id, issueDate: '2026-09-02', lines: [
    { description: 'Brand workshop', quantity: '8', rate: '175.00', accountId: acct['4000'], taxCode: 'exempt' },
    { description: 'Printed style guides', quantity: '2', rate: '200.00', accountId: acct['4000'], taxCode: tax.id }] }, bea)
  assert.deepEqual([inv.subtotal_cents, inv.tax_cents, inv.total_cents], [180000, 3550, 183550])
  await h.command('invoice.approve', { id: inv.id, revision: inv.revision }, bea, 403)
  const approved = await h.command('invoice.approve', { id: inv.id, revision: inv.revision }, ann)
  await h.command('invoice.issue', { id: inv.id }, h.owner, 200)
  const issued = at((await h.view('sales')).invoices, i => i.id === inv.id)
  assert.equal(issued.status, 'issued'); assert.equal(issued.open_cents, 183550); assert.equal(approved.approved_by, 'ann@example.test')
  const je = await journalOf(h, issued.journal_id)
  assert.deepEqual(je.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['1200', 183550, 0], ['4000', 0, 140000], ['4000', 0, 40000], ['2200', 0, 3550]])
  await h.command('invoice.save-draft', { id: inv.id, revision: issued.revision, customerId: customer.id, issueDate: '2026-09-02', lines: [{ description: 'x', quantity: '1', rate: '1.00', accountId: acct['4000'], taxCode: 'exempt' }] }, bea, 409)
  // A credit for part of it, approved and issued, applies to the invoice.
  const credit = await h.command('invoice.save-draft', { kind: 'credit', creditFor: inv.id, customerId: customer.id, issueDate: '2026-09-20', lines: [{ description: 'Workshop hour not delivered', quantity: '1', rate: '175.00', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  const ca = await h.command('invoice.approve', { id: credit.id, revision: credit.revision }, ann)
  await h.command('invoice.issue', { id: ca.id }, bea)
  const after = at((await h.view('sales')).invoices, i => i.id === inv.id)
  assert.equal(after.open_cents, 183550 - 17500)
  const ar = await h.view('reports/receivables?to=2026-09-30')
  assert.equal(ar.itemsTotal, 166050); assert.ok(ar.agrees, 'receivables agree to the control account')
  // Editing an approved invoice returns it to draft; approval covered the old version.
  let second = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-25', lines: [{ description: 'Retainer', quantity: '1', rate: '500.00', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  second = await h.command('invoice.approve', { id: second.id, revision: second.revision }, ann)
  second = await h.command('invoice.save-draft', { id: second.id, revision: second.revision, customerId: customer.id, issueDate: '2026-09-25', lines: [{ description: 'Retainer', quantity: '1', rate: '5000.00', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  assert.equal(second.status, 'draft')
  await h.command('invoice.issue', { id: second.id }, bea, 409)
  // Whoever last changed an invoice is its preparer and cannot approve that version.
  second = await h.command('invoice.save-draft', { id: second.id, revision: second.revision, customerId: customer.id, issueDate: '2026-09-25', lines: [{ description: 'Retainer', quantity: '1', rate: '9000.00', accountId: acct['4000'], taxCode: 'exempt' }] }, ann)
  assert.equal(second.prepared_by, 'ann@example.test')
  await h.command('invoice.approve', { id: second.id, revision: second.revision }, ann, 403)
})

test('PAN-05 bills post to payables with their evidence; a bill without evidence is a close exception until resolved', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, vendor } = await setup(h)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const bill = await h.command('bill.save', { vendorId: vendor.id, reference: 'INV-88', billDate: '2026-09-01', lines: [{ description: 'Design suite', accountId: acct['6200'], amount: '540.00' }, { description: 'Seats', accountId: acct['6200'], amount: '100.00' }], post: true }, bea)
  assert.equal(bill.status, 'posted'); assert.equal(bill.due_date, '2026-09-16'); assert.equal(bill.open_cents, 64000)
  await h.command('bill.save', { vendorId: vendor.id, reference: 'INV-88', billDate: '2026-09-02', lines: [{ description: 'Again', accountId: acct['6200'], amount: '640.00' }], post: true }, bea, 409)
  const je = await journalOf(h, bill.journal_id)
  assert.deepEqual(je.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['6200', 54000, 0], ['6200', 10000, 0], ['2000', 0, 64000]])
  const evidence = async () => at((await h.view('close/2026-09')).checks, c => c.key === 'evidence')
  assert.equal((await evidence()).ok, false); assert.equal((await evidence()).items[0].id, bill.id)
  await h.command('document.upload', { name: 'inv-88.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 INV-88').toString('base64'), linkedKind: 'bill', linkedId: bill.id }, bea)
  assert.equal((await evidence()).ok, true)
  const draft = await h.command('bill.save', { vendorId: vendor.id, reference: 'INV-91', billDate: '2026-09-12', lines: [{ description: 'Fonts', accountId: acct['6200'], amount: '80.00' }] }, bea)
  assert.equal(draft.status, 'draft'); assert.equal(draft.journal_id, null)
  const recorded = await h.command('bill.record', { id: draft.id, revision: draft.revision }, bea)
  assert.equal((await evidence()).ok, false)
  await h.command('bill.waive-evidence', { id: recorded.id, revision: recorded.revision, reason: 'Vendor portal receipt unavailable' }, bea, 403)
  await h.command('bill.waive-evidence', { id: recorded.id, revision: recorded.revision, reason: 'Vendor portal receipt unavailable' }, ann)
  assert.equal((await evidence()).ok, true)
  const ap = await h.view('reports/payables?to=2026-09-30')
  assert.equal(ap.itemsTotal, 72000); assert.ok(ap.agrees)
})

test('PAN-06 payments made outside Pantry are recorded and allocated to open items without moving money', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct, customer, vendor, bank } = await setup(h)
  const bea = await h.member('bea@example.test', 'bookkeeper'), ann = await h.member('ann@example.test', 'accountant', { canPost: true })
  const inv = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-09-02', lines: [{ description: 'Workshop', quantity: '1', rate: '1000.00', accountId: acct['4000'], taxCode: 'exempt' }] }, bea)
  await h.command('invoice.approve', { id: inv.id, revision: inv.revision }, ann)
  await h.command('invoice.issue', { id: inv.id }, bea)
  await h.command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-09-10', amount: '600.00', bankAccountId: bank.id, allocations: [{ targetId: inv.id, amount: '700.00' }] }, bea, 400)
  const pay = await h.command('payment.record', { direction: 'received', contactId: customer.id, date: '2026-09-10', amount: '1200.00', bankAccountId: bank.id, reference: 'ACH 5521', allocations: [{ targetId: inv.id, amount: '400.00' }] }, bea)
  const je = await journalOf(h, pay.journal_id)
  assert.deepEqual(je.lines.map(l => [l.account_code, l.debit_cents, l.credit_cents]), [['1000', 120000, 0], ['1200', 0, 120000]])
  let ar = await h.view('reports/receivables?to=2026-09-30')
  assert.deepEqual([ar.itemsTotal, ar.unapplied, ar.subledger], [60000, 80000, -20000]); assert.ok(ar.agrees, 'unapplied cash keeps the control account in agreement')
  await h.command('payment.allocate', { paymentId: pay.id, date: '2026-09-11', allocations: [{ targetId: inv.id, amount: '700.00' }] }, bea, 400)
  await h.command('payment.allocate', { paymentId: pay.id, date: '2026-09-11', allocations: [{ targetId: inv.id, amount: '600.00' }] }, bea)
  assert.equal(at((await h.view('sales')).invoices, i => i.id === inv.id).open_cents, 0)
  ar = await h.view('reports/receivables?to=2026-09-30')
  assert.deepEqual([ar.itemsTotal, ar.unapplied], [0, 20000]); assert.ok(ar.agrees)
  // Paying a vendor, then reversing that payment, reopens the bill.
  const bill = await h.command('bill.save', { vendorId: vendor.id, reference: 'INV-88', billDate: '2026-09-01', lines: [{ description: 'Suite', accountId: acct['6200'], amount: '640.00' }], post: true }, bea)
  const out = await h.command('payment.record', { direction: 'paid', contactId: vendor.id, date: '2026-09-12', amount: '640.00', bankAccountId: bank.id, allocations: [{ targetId: bill.id, amount: '640.00' }] }, bea)
  assert.equal(at((await h.view('sales')).bills, b => b.id === bill.id).open_cents, 0)
  await h.command('journal.reverse', { id: out.journal_id, date: '2026-09-13', memo: 'Payment bounced' }, ann)
  assert.equal(at((await h.view('sales')).bills, b => b.id === bill.id).open_cents, 64000)
  assert.ok((await h.view('reports/payables?to=2026-09-30')).agrees)
})
