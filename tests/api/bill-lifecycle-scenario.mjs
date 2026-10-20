import assert from 'node:assert/strict'
import { at, books } from './harness.mjs'

// Public doors only; shared by the HTTP and built-screen journeys.
export async function billLifecycleScenario(h, { step = async () => {}, recurring } = {}) {
  const { acct } = await books(h)
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Harbor Studio Rentals', termsDays: 15 })
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-08-31', openingBalance: '0.00' })
  const form = new FormData(); form.set('source', 'upload'); form.set('file', new Blob(['%PDF-1.4 Harbor Studio September rent $1000'], { type: 'application/pdf' }), 'harbor-rent.pdf')
  const capture = await h.capture(form)
  let receipt = at((await h.view('receipts')).review, r => r.id === capture.id)
  assert.ok((await h.view('sales')).capturedBills.some(r => r.id === receipt.id))
  const aging = async expected => { const a = await h.view('reports/payables?to=2026-12-31'); assert.equal(a.itemsTotal, expected); assert.ok(a.agrees) }
  await aging(0); await step('Captured', { receipt, vendor, bank, acct })
  await h.command('receipt.vendor-confirm', { id: receipt.id, revision: receipt.revision, vendorId: vendor.id, vendorRevision: vendor.revision, confirm: true })
  receipt = at((await h.view('receipts')).review, r => r.id === receipt.id)
  let d = (await h.command('receipt.draft-save', { id: receipt.id, revision: receipt.revision, kind: 'bill', date: '2026-09-01', total: '1000.00', tax: '0', invoiceNumber: 'HARBOR-SEPT', termsDays: 15, lines: [{ description: 'September studio rent', accountId: acct['6100'], amount: '1000.00' }] })).saved
  const billId = d.bill_id
  const current = async () => at((await h.view('sales')).bills, b => b.id === billId)
  const stage = async name => { const b = await current(); assert.equal(b.lifecycle.stage, name); assert.ok(b.lifecycle.nextActor); assert.equal(b.due_date, '2026-09-16'); return b }
  await stage('Draft'); await aging(0); await step('Draft', { bill: await current(), receipt, vendor, bank, acct })
  if ((await current()).lifecycle.stage === 'Draft') await h.command('bill.submit', { id: billId, revision: (await current()).revision, captureRevision: d.revision })
  await stage('Awaiting approval'); await aging(0); await step('Awaiting approval', { bill: await current(), receipt, vendor, bank, acct })
  await h.command('capture-draft.approve', { id: d.id, revision: d.revision })
  await stage('Approved'); await aging(0); await step('Approved draft', { bill: await current(), receipt, vendor, bank, acct })
  await h.command('capture-draft.post', { id: d.id, revision: d.revision })
  await stage('Approved'); await aging(100000); await step('Approved', { bill: await current(), receipt, vendor, bank, acct })
  if ((await current()).lifecycle.stage !== 'Scheduled') await h.command('bill.schedule', { id: billId, revision: (await current()).revision, date: '2026-09-12', note: 'Pay by bank transfer outside Pantry' })
  await stage('Scheduled'); await aging(100000); await step('Scheduled', { bill: await current(), receipt, vendor, bank, acct })
  const credit = await h.command('vendor-credit.record', { vendorId: vendor.id, reference: 'HARBOR-CREDIT', date: '2026-09-05', amount: '150.00', accountId: acct['6100'], allocations: [{ targetId: billId, amount: '150.00' }] })
  await aging(85000); assert.equal((await current()).open_cents, 85000); assert.ok(credit.id)
  const pay = await h.command('payment.record', { direction: 'paid', contactId: vendor.id, date: '2026-09-12', amount: '850.00', bankAccountId: bank.id, reference: 'HARBOR-RENT', method: 'ach', allocations: [{ targetId: billId, amount: '850.00' }] })
  await stage('Paid'); await aging(0); await step('Paid', { bill: await current(), receipt, vendor, bank, acct })
  const statement = (await h.command('statement.import', { bankAccountId: bank.id, fileName: 'september.csv', confirmLast4: '4821', start: '2026-09-01', end: '2026-09-30', opening: '0.00', closing: '-850.00', content: 'Date,Description,Amount,Reference\n2026-09-12,Harbor rent,-850.00,HARBOR-RENT\n' })).statement
  let r = await h.view(`reconciliation/${statement.id}`)
  if (!r.lines[0].match_id) await h.command('match.approve', { bankLineIds: [r.lines[0].id], journalLineIds: [at(r.postings, p => p.entry_id === pay.journal_id).id], create: [] })
  await h.command('reconciliation.complete', { statementId: statement.id })
  await stage('Reconciled'); await aging(0); await step('Reconciled', { bill: await current(), receipt, vendor, bank, acct })
  // Undo must make the label reflect the active proof rather than a saved badge.
  const preview = (await h.view(`reconciliation/${statement.id}`)).undo
  await h.command('reconciliation.undo', { statementId: statement.id, reason: 'Check retained proof behavior', reconciliationIds: preview.reconciliations.map(r => r.id) })
  await stage('Paid')
  await h.command('reconciliation.complete', { statementId: statement.id })
  await stage('Reconciled')
  const fields = { name: 'Monthly studio rent', vendorId: vendor.id, startDate: '2026-07-31', endDate: '2026-09-30', termsDays: 15, unit: 'month', every: 1, lines: [{ description: 'Studio rent', accountId: acct['6100'], amount: '1200.00' }] }
  if (recurring) await recurring(fields)
  else await h.command('recurring-bill.save', fields)
  await h.command('recurring-bill.generate', { through: '2026-09-30' })
  let sales = await h.view('sales'), template = at(sales.recurringBills, r => r.name === fields.name)
  assert.equal(template.history.length, 3); assert.deepEqual(template.history.map(r => r.occurrence).sort(), ['2026-07-31', '2026-08-31', '2026-09-30'])
  const ids = template.history.map(r => r.bill_id)
  for (const id of ids) { const b = at(sales.bills, b => b.id === id); assert.equal(b.status, 'draft'); assert.equal(b.total_cents, 120000); assert.equal(b.lifecycle.stage, 'Draft') }
  await h.command('recurring-bill.generate', { through: '2026-09-30' })
  sales = await h.view('sales'); assert.equal(sales.bills.filter(b => ids.includes(b.id)).length, 3); await aging(0)
  await step('Recurring drafts', { bill: await current(), receipt, vendor, bank, acct, template })
  return { billId, template, bank, vendor, acct }
}
