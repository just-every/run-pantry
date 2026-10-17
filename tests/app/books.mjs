// The stranger's September through the public API, shared by the browser-driven tests.
import assert from 'node:assert/strict'

export /** The stranger's September: a cash-basis business, an invoice, the Acme bill A-778 and the statement that pays it. */
async function books(request, origin) {
  const call = async (op, data) => { const r = await request.post(`${origin}/api/pantry/command/${op}`, { headers: { origin }, data }); assert.equal(r.status(), 200, `${op}: ${await r.text()}`); return r.json() }
  await call('entity.save', { legalName: 'Rivera Design Studio LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01', policies: '' })
  await call('chart.start', {})
  const acct = Object.fromEntries((await (await request.get(`${origin}/api/pantry/state`)).json()).accounts.map(a => [a.code, a.id]))
  const bank = await call('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', routing: '', openingDate: '2026-08-31', openingBalance: '10000.00' })
  const opening = await call('journal.save-draft', { date: '2026-08-31', memo: 'Opening balances', lines: [{ accountId: acct['1000'], debit: '10000.00' }, { accountId: acct['3000'], credit: '10000.00' }] })
  await call('journal.post', { id: opening.id, revision: opening.revision })
  const cedar = await call('contact.save', { kind: 'customer', name: 'Cedar Studio', termsDays: 30 })
  const acme = await call('contact.save', { kind: 'vendor', name: 'Acme Contractors', termsDays: 30 })
  const draft = await call('invoice.save-draft', { customerId: cedar.id, issueDate: '2026-09-02', lines: [{ description: 'Website refresh', quantity: '1', rate: '4685.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  await call('invoice.issue', { id: (await call('invoice.approve', { id: draft.id, revision: draft.revision })).id })
  await call('bill.save', { vendorId: acme.id, reference: 'A-778', billDate: '2026-09-10', lines: [{ description: 'Contract design work', accountId: acct['6000'], amount: '1500.00' }], post: true })
  const csv = 'Posting Date,Description,Amount\n09/14/2026,ADOBE *CREATIVE CLD,-59.99\n09/24/2026,ACH DEBIT ACME CONTRACTORS A-778,-1500.00\n'
  await call('statement.import', { bankAccountId: bank.id, fileName: 'checking-2026-09.csv', content: csv, opening: '10000.00', closing: '8440.01', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
}
