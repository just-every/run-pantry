// Juniper Lane Design's September 2026, built through the public commands:
// opening balances, customers and vendors, invoices, bills and the payments
// recorded before the bank statements arrive. Statement files are fixtures.
import assert from 'node:assert/strict'
import { at, books, fixture } from './harness.mjs'

const line = (description, rate, accountId, taxCode = 'exempt', quantity = '1') => ({ description, quantity, rate, accountId, taxCode })

export async function september(h) {
  const { acct } = await books(h)
  const savings = await h.command('account.save', { code: '1010', name: 'Savings', type: 'asset', subtype: 'bank' })
  acct['1010'] = savings.id
  const checking = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', routing: '', openingDate: '2026-08-31', openingBalance: '24813.52' })
  const reserve = await h.command('bank-account.save', { name: 'Savings', institution: 'Chase', accountId: acct['1010'], numberLast4: '7730', routing: '021000021', openingDate: '2026-08-31', openingBalance: '0.00' })
  const opening = await h.command('journal.save-draft', { date: '2026-08-31', memo: 'Opening balances', lines: [{ accountId: acct['1000'], debit: '24813.52' }, { accountId: acct['3000'], credit: '24813.52' }] })
  await h.command('journal.post', { id: opening.id, revision: opening.revision })
  const tax = await h.command('tax-code.save', { name: 'New York City', rate: '8.875', accountId: acct['2200'] })
  const c = {}
  for (const [kind, name] of [['customer', 'Cedar Studio'], ['customer', 'Northstar Consulting'], ['customer', 'Willow Services'], ['vendor', 'Brightline Software'], ['vendor', 'Harbor Office Rentals']])
    c[name] = await h.command('contact.save', { kind, name, termsDays: 30 })

  const issue = async (customer, issueDate, lines) => {
    const d = await h.command('invoice.save-draft', { customerId: c[customer].id, issueDate, lines })
    const a = await h.command('invoice.approve', { id: d.id, revision: d.revision })
    return h.command('invoice.issue', { id: a.id })
  }
  const inv = {
    cedar: await issue('Cedar Studio', '2026-09-01', [line('Website refresh', '2400.00', acct['4000'])]),
    northstar: await issue('Northstar Consulting', '2026-09-01', [line('Quarterly retainer', '3850.00', acct['4000'])]),
    willow: await issue('Willow Services', '2026-09-02', [line('Brand workshop', '175.00', acct['4000'], 'exempt', '8'), line('Printed style guides', '200.00', acct['4000'], tax.id, '2')]),
    cedar2: await issue('Cedar Studio', '2026-09-02', [line('Social templates', '1200.00', acct['4000'])]),
  }
  assert.equal(inv.willow.total_cents, 183550)
  const bill = async (vendor, reference, account, amount) => h.command('bill.save', { vendorId: c[vendor].id, reference, billDate: '2026-09-01', lines: [{ description: reference, accountId: acct[account], amount }], post: true })
  const bills = { brightline: await bill('Brightline Software', 'INV-88', '6200', '640.00'), harbor: await bill('Harbor Office Rentals', 'R-0826', '6100', '1300.00') }
  const pay = (direction, contact, date, amount, allocations) => h.command('payment.record', { direction, contactId: c[contact].id, date, amount, bankAccountId: checking.id, allocations })
  const paid = {
    cedar: await pay('received', 'Cedar Studio', '2026-09-03', '2400.00', [{ targetId: inv.cedar.id, amount: '2400.00' }]),
    willow: await pay('received', 'Willow Services', '2026-09-18', '1835.50', [{ targetId: inv.willow.id, amount: '1835.50' }]),
    cedar2: await pay('received', 'Cedar Studio', '2026-09-18', '1200.00', [{ targetId: inv.cedar2.id, amount: '1200.00' }]),
    harbor: await pay('paid', 'Harbor Office Rentals', '2026-09-24', '1300.00', [{ targetId: bills.harbor.id, amount: '1300.00' }]),
  }
  return { acct, checking, reserve, tax, c, inv, bills, paid }
}

export async function importStatements(h, s) {
  const checking = await h.command('statement.import', { bankAccountId: s.checking.id, fileName: 'operating-checking-2026-09.csv', content: await fixture('bank/operating-checking-2026-09.csv'), opening: '24813.52', closing: '27797.02', start: '2026-09-01', end: '2026-09-30', confirmLast4: '4821' })
  const savings = await h.command('statement.import', { bankAccountId: s.reserve.id, fileName: 'savings-2026-09.ofx', content: await fixture('bank/savings-2026-09.ofx') })
  return { checking: checking.statement, savings: savings.statement }
}

/** The bank postings a match may use, by payment. */
export async function postingFor(h, statementId, memo) {
  const r = await h.view(`reconciliation/${statementId}`)
  return at(r.postings, p => p.memo.includes(memo))
}

/** The September lines a person matches; the Cedar deposit, which names its recorded payment, matched itself on import. */
export async function matchSeptember(h, s, st) {
  const r = await h.view(`reconciliation/${st.checking.id}`)
  const ln = text => at(r.lines, l => l.description.includes(text))
  const posting = memo => at(r.postings, p => p.memo.includes(memo))
  await h.command('match.approve', { bankLineIds: [ln('SERVICE FEE').id], create: [{ type: 'fee', amount: '12.00', accountId: s.acct['6400'], direction: 'out', memo: 'Monthly service fee' }] })
  await h.command('match.approve', { bankLineIds: [ln('BRIGHTLINE').id], create: [{ type: 'payment', amount: '640.00', contactId: s.c['Brightline Software'].id, allocations: [{ targetId: s.bills.brightline.id, amount: '640.00' }] }] })
  await h.command('match.approve', { bankLineIds: [ln('NORTHSTAR').id], create: [{ type: 'receipt', amount: '1500.00', contactId: s.c['Northstar Consulting'].id, allocations: [{ targetId: s.inv.northstar.id, amount: '1500.00' }] }] })
  await h.command('match.approve', { bankLineIds: [ln('TRANSFER').id], create: [{ type: 'transfer', amount: '2000.00', otherBankAccountId: s.reserve.id, direction: 'out' }] })
  const square = r.postings.filter(p => p.memo.includes('Willow') || (p.memo.includes('Cedar') && p.entry_date === '2026-09-18'))
  assert.equal(square.length, 2)
  await h.command('match.approve', { bankLineIds: [ln('SQUARE').id], journalLineIds: square.map(p => p.id) })
  await h.command('match.approve', { bankLineIds: [ln('CHECK 2052').id], journalLineIds: [posting('Payment to Harbor').id] })
  const sv = await h.view(`reconciliation/${st.savings.id}`)
  await h.command('match.approve', { bankLineIds: [at(sv.lines, l => l.description.includes('TRANSFER')).id], journalLineIds: [at(sv.postings, p => p.memo.includes('Transfer')).id] })
  await h.command('match.approve', { bankLineIds: [at(sv.lines, l => l.description.includes('INTEREST')).id], create: [{ type: 'income', amount: '1.25', accountId: s.acct['4900'], direction: 'in', memo: 'Interest' }] })
}

export async function closeReady(h, s, st) {
  await h.command('reconciliation.complete', { statementId: st.checking.id })
  await h.command('reconciliation.complete', { statementId: st.savings.id })
  await h.command('document.upload', { name: 'brightline-inv-88.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 Brightline invoice INV-88 for $640.00\n').toString('base64'), linkedKind: 'bill', linkedId: s.bills.brightline.id })
  const harbor = (await h.view('sales')).bills.find(b => b.id === s.bills.harbor.id)
  await h.command('bill.waive-evidence', { id: harbor.id, revision: harbor.revision, reason: 'Lease invoice is the signed lease on file; landlord issues no monthly invoice' })
  let close = await h.command('close.tasks', { period: '2026-09' })
  for (const t of close.tasks) close = await h.command('close.task', { id: t.id, revision: t.revision, done: true, note: 'Reviewed' })
  return close
}
