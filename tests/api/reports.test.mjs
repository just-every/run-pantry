import test from 'node:test'
import assert from 'node:assert/strict'
import { at, books, harness } from './harness.mjs'

// Juniper Lane Design's October 2026, the worked example in docs/REPORTS.md:
// INV-0001 $1,053.25 (600.00 design + 8.875% NYC tax, 400.00 workshop) half paid in
// October and the rest in November; INV-0002 $2,000.00 paid in November; a $640.00
// software bill paid by check in October; $1,300.00 rent unpaid; a $12.00 bank fee.
async function october(h) {
  const { acct } = await books(h)
  acct['4100'] = (await h.command('account.save', { code: '4100', name: 'Workshop revenue', type: 'income' })).id
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-09-30', openingBalance: '10000.00' })
  const opening = await h.command('journal.save-draft', { date: '2026-09-30', memo: 'Opening balances', lines: [{ accountId: acct['1000'], debit: '10000.00' }, { accountId: acct['3000'], credit: '10000.00' }] })
  await h.command('journal.post', { id: opening.id, revision: opening.revision })
  const nyc = await h.command('tax-code.save', { name: 'New York City', rate: '8.875', accountId: acct['2200'], state: 'NY' })
  const c = {}
  for (const [kind, name] of [['customer', 'Cedar Studio'], ['customer', 'Northstar Consulting'], ['customer', 'Willow Services'], ['vendor', 'Brightline Software'], ['vendor', 'Harbor Office Rentals']])
    c[name] = await h.command('contact.save', { kind, name, termsDays: 30 })
  const issue = async (customer, issueDate, lines, extra = {}) => {
    const d = await h.command('invoice.save-draft', { customerId: c[customer].id, issueDate, lines, ...extra })
    await h.command('invoice.approve', { id: d.id, revision: d.revision })
    return h.command('invoice.issue', { id: d.id })
  }
  const a = await issue('Cedar Studio', '2026-10-05', [
    { description: 'Website design', quantity: '1', rate: '600.00', accountId: acct['4000'], taxCode: nyc.id },
    { description: 'Brand workshop', quantity: '1', rate: '400.00', accountId: acct['4100'], taxCode: 'exempt' }])
  assert.equal(a.total_cents, 105325)
  const b = await issue('Northstar Consulting', '2026-10-10', [{ description: 'Quarterly retainer', quantity: '1', rate: '2000.00', accountId: acct['4000'], taxCode: 'exempt' }])
  const bill = (vendor, reference, date, account, amount) => h.command('bill.save', { vendorId: c[vendor].id, reference, billDate: date, lines: [{ description: reference, accountId: acct[account], amount }], post: true })
  const x = await bill('Brightline Software', 'BL-1042', '2026-10-02', '6200', '640.00'), y = await bill('Harbor Office Rentals', 'R-1026', '2026-10-01', '6100', '1300.00')
  const pay = (direction, contact, date, amount, targetId, method) => h.command('payment.record', { direction, contactId: c[contact].id, date, amount, bankAccountId: bank.id, method, reference: `${method.toUpperCase()} ${date}`, allocations: [{ targetId, amount }] })
  const paid = { a1: await pay('received', 'Cedar Studio', '2026-10-20', '500.00', a.id, 'ach'), x: await pay('paid', 'Brightline Software', '2026-10-15', '640.00', x.id, 'check'),
    a2: await pay('received', 'Cedar Studio', '2026-11-03', '553.25', a.id, 'ach'), b: await pay('received', 'Northstar Consulting', '2026-11-05', '2000.00', b.id, 'wire') }
  const fee = await h.command('journal.save-draft', { date: '2026-10-31', memo: 'Monthly service fee', lines: [{ accountId: acct['6400'], debit: '12.00' }, { accountId: acct['1000'], credit: '12.00' }] })
  await h.command('journal.post', { id: fee.id, revision: fee.revision })
  return { acct, bank, nyc, c, inv: { a, b }, bills: { x, y }, paid, issue }
}

const lineOf = (report, code) => [...(report.income ?? []), ...(report.expenses ?? []), ...(report.assets ?? []), ...(report.liabilities ?? []), ...(report.equity ?? [])].find(r => r.code === code)?.amount ?? 0
const OCT = 'from=2026-10-01&to=2026-10-31'

test('REPORT-002 cash or accrual: one switch reads the same books both ways, partial payments split across lines and tax', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  const accrual = await h.view(`reports/profit-and-loss?${OCT}&basis=accrual`), cash = await h.view(`reports/profit-and-loss?${OCT}&basis=cash`)
  assert.deepEqual([accrual.basis, cash.basis], ['accrual', 'cash'])
  assert.deepEqual([lineOf(accrual, '4000'), lineOf(accrual, '4100'), accrual.totalIncome, accrual.totalExpenses, accrual.netIncome], [260000, 40000, 300000, 195200, 104800])
  // $500.00 of $1,053.25 spread by largest remainder: 284.83 design, 189.89 workshop, 25.28 tax.
  assert.deepEqual([lineOf(cash, '4000'), lineOf(cash, '4100'), lineOf(cash, '6100'), lineOf(cash, '6200'), lineOf(cash, '6400')], [28483, 18989, 0, 64000, 1200])
  assert.deepEqual([cash.totalIncome, cash.totalExpenses, cash.netIncome], [47472, 65200, -17728])
  assert.deepEqual(cash.bridge, { accrualNetIncome: 104800, recordedInRange: 106000, settledInRange: -16528, cashNetIncome: -17728, ties: true })
  // November recognises the rest of INV-0001 (exact lines once fully paid) and all of INV-0002.
  const nov = await h.view('reports/profit-and-loss?from=2026-11-01&to=2026-11-30&basis=cash')
  assert.deepEqual([lineOf(nov, '4000'), lineOf(nov, '4100')], [60000 - 28483 + 200000, 40000 - 18989])
  // Balance sheets: receivables, payables and unpaid tax leave on the cash basis; both balance.
  const bsA = await h.view('reports/balance-sheet?to=2026-10-31&basis=accrual'), bsC = await h.view('reports/balance-sheet?to=2026-10-31&basis=cash')
  assert.ok(bsA.balanced && bsC.balanced)
  assert.deepEqual([lineOf(bsA, '1000'), lineOf(bsA, '1200'), lineOf(bsA, '2000'), lineOf(bsA, '2200'), bsA.totalAssets, bsA.totalEquity], [984800, 255325, 130000, 5325, 1240125, 1104800])
  assert.deepEqual([lineOf(bsC, '1000'), lineOf(bsC, '1200'), lineOf(bsC, '2000'), lineOf(bsC, '2200'), bsC.totalAssets, bsC.totalLiabilities, bsC.totalEquity], [984800, 0, 0, 2528, 984800, 2528, 982272])
  // Every export names its basis; the ledger itself is unchanged by reading it on cash.
  const csv = await h.send(`/api/pantry/package/2026-10/general-ledger.csv?basis=cash`, undefined, { cookie: h.owner })
  assert.match(csv.headers.get('content-disposition'), /pantry-general-ledger-2026-10-cash\.csv/)
  const rows = csv.value.trim().split('\r\n')
  assert.match(rows[0], /,Basis$/); assert.ok(rows.slice(1).every(r => r.endsWith(',Cash basis')))
  assert.ok(rows.some(r => r.includes('INV-0001') && r.includes('500.00 of 1053.25 paid')))
  const pkg = await h.view('package/2026-10?basis=cash')
  assert.deepEqual([pkg.basis, pkg.profitAndLoss.period.netIncome, pkg.balanceSheet.balanced], ['Cash basis', -17728, true])
  assert.equal((await h.view(`reports/profit-and-loss?${OCT}`)).netIncome, 104800, 'accrual stays the default')
  await h.view(`reports/profit-and-loss?${OCT}&basis=modified`, h.owner, 400)
})

test('REPORT-005 every P&L and balance sheet figure opens to its records, documents and bank lines, and ties to the figure', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  await h.command('document.upload', { name: 'brightline-bl-1042.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 Brightline BL-1042 $640.00\n').toString('base64'), linkedKind: 'bill', linkedId: s.bills.x.id })
  const statement = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/16/2026,"CHECK 1001 BRIGHTLINE",-640.00,CHECK_PAID,9360.00,1001\nCREDIT,10/21/2026,"DEPOSIT CEDAR STUDIO ACH",500.00,ACH_CREDIT,9860.00,\n'
  const imported = await h.command('statement.import', { bankAccountId: s.bank.id, fileName: 'checking-2026-10.csv', content: statement, opening: '10000.00', closing: '9860.00', start: '2026-10-01', end: '2026-10-30', confirmLast4: '4821' })
  const r = await h.view(`reconciliation/${imported.statement.id}`)
  await h.command('match.approve', { bankLineIds: [at(r.lines, l => l.description.includes('BRIGHTLINE')).id], journalLineIds: [at(r.postings, p => p.memo.includes('Payment to Brightline')).id] })

  for (const basis of ['accrual', 'cash']) {
    const pl = await h.view(`reports/profit-and-loss?${OCT}&basis=${basis}`), bs = await h.view(`reports/balance-sheet?to=2026-10-31&basis=${basis}`)
    const figures = [...[...pl.income, ...pl.expenses].map(r => ['profit-and-loss', r.id, r.amount]), ['profit-and-loss', 'income', pl.totalIncome], ['profit-and-loss', 'expenses', pl.totalExpenses], ['profit-and-loss', 'net-income', pl.netIncome],
      ...[...bs.assets, ...bs.liabilities, ...bs.equity].map(r => ['balance-sheet', r.id, r.amount]), ['balance-sheet', 'assets', bs.totalAssets], ['balance-sheet', 'liabilities', bs.totalLiabilities], ['balance-sheet', 'equity', bs.totalEquity], ['balance-sheet', 'liabilities-and-equity', bs.totalLiabilities + bs.totalEquity]]
    for (const [report, line, amount] of figures) {
      const d = await h.view(`reports/detail?report=${report}&line=${line}&${OCT}&basis=${basis}`)
      assert.equal(d.figure, amount, `${basis} ${report} ${line} figure`)
      assert.equal(d.rows.reduce((t, r) => t + r.amount, 0), amount, `${basis} ${report} ${line} rows add up to the figure`)
      assert.ok(d.ties)
    }
  }
  // Software expense on the accrual basis: the bill, its document, the payment and the cleared check.
  const software = await h.view(`reports/detail?report=profit-and-loss&line=${s.acct['6200']}&${OCT}`)
  const row = at(software.rows, x => x.record.kind === 'bill')
  assert.deepEqual([row.amount, row.record.id, row.record.label], [64000, s.bills.x.id, 'Bill BL-1042 · Brightline Software'])
  assert.deepEqual(row.documents.map(d => d.name), ['brightline-bl-1042.pdf'])
  assert.deepEqual(row.bank.map(b => [b.date, b.description, b.amount]), [['2026-10-16', 'CHECK 1001 BRIGHTLINE', -64000]])
  // Design revenue on the cash basis: the share of INV-0001 the October payment settled, and that payment.
  const design = await h.view(`reports/detail?report=profit-and-loss&line=${s.acct['4000']}&${OCT}&basis=cash`)
  assert.deepEqual(design.rows.map(x => [x.date, x.amount, x.record.id, x.settlement.by.id, x.settlement.share]), [['2026-10-20', 28483, s.inv.a.id, s.paid.a1.id, '500.00 of 1053.25 settled']])
  // The record opens with its lines, journal entry, payments, documents and bank lines, each linking onward.
  const record = await h.view(`reports/record/bill/${s.bills.x.id}`)
  assert.deepEqual([record.total, record.open, record.documents[0].name, record.links[0].kind, record.links[0].id], [64000, 0, 'brightline-bl-1042.pdf', 'payment', s.paid.x.id])
  assert.deepEqual(record.entries[0].lines.map(l => [l.account.slice(0, 4), l.debit, l.credit]), [['6200', 64000, 0], ['2000', 0, 64000]])
  const payment = await h.view(`reports/record/payment/${s.paid.x.id}`)
  assert.deepEqual([payment.method, payment.links[0].id, payment.bank[0].description], ['check', s.bills.x.id, 'CHECK 1001 BRIGHTLINE'])
  const doc = await h.send(`/api/pantry/documents/${record.documents[0].id}`, undefined, { cookie: h.owner })
  assert.equal(doc.status, 200)
  await h.view('reports/detail?report=profit-and-loss&line=nothing&' + OCT, h.owner, 404)
})

test('SALESTAX-002 sales tax by state and code for a period, from invoice lines, tied to the sales tax liability', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  const nj = await h.command('tax-code.save', { name: 'New Jersey', rate: '6.625', accountId: s.acct['2200'], state: 'NJ' })
  const c = await s.issue('Willow Services', '2026-10-12', [{ description: 'Signage design', quantity: '1', rate: '200.00', accountId: s.acct['4000'], taxCode: nj.id }])
  assert.equal(c.total_cents, 21325)
  await s.issue('Willow Services', '2026-10-25', [{ description: 'Signage revision not delivered', quantity: '1', rate: '50.00', accountId: s.acct['4000'], taxCode: nj.id }], { kind: 'credit', creditFor: c.id })
  const accrual = await h.view(`reports/sales-tax?${OCT}&basis=accrual`)
  const code = (r, id) => r.states.flatMap(x => x.codes).find(x => x.id === id)
  assert.deepEqual(accrual.states.map(x => [x.state, x.taxable, x.charged, x.collected, x.owed]), [['NJ', 15000, 994, 0, 994], ['NY', 60000, 5325, 2528, 5325]])
  assert.deepEqual([code(accrual, s.nyc.id).rate, accrual.exempt, accrual.totals.owed], [8875, 240000, 6319])
  assert.deepEqual(accrual.ledger.accounts.map(a => [a.code, a.opening, a.fromSales, a.other, a.closing, a.ties]), [['2200', 0, 6319, 0, 6319, true]])
  assert.ok(accrual.ledger.ties)
  // Cash basis: only what customers paid; the credit applied to the NJ invoice settles it without cash.
  const cash = await h.view(`reports/sales-tax?${OCT}&basis=cash`)
  assert.deepEqual(cash.states.map(x => [x.state, x.taxable, x.collected, x.owed]), [['NJ', 0, 0, 0], ['NY', 28483, 2528, 2528]])
  assert.deepEqual([cash.exempt, cash.ledger.accounts[0].fromSales, cash.ledger.accounts[0].closing, cash.ledger.ties], [18989, 2528, 2528, true])
  // A remittance to the state shows as other movement; the tie still holds.
  const remit = await h.command('journal.save-draft', { date: '2026-10-30', memo: 'NY sales tax paid', lines: [{ accountId: s.acct['2200'], debit: '25.28' }, { accountId: s.acct['1000'], credit: '25.28' }] })
  await h.command('journal.post', { id: remit.id, revision: remit.revision })
  const after = await h.view(`reports/sales-tax?${OCT}&basis=accrual`)
  assert.deepEqual([after.ledger.accounts[0].fromSales, after.ledger.accounts[0].other, after.ledger.accounts[0].closing, after.ledger.ties], [6319, -2528, 3791, true])
  await h.command('tax-code.save', { name: 'Nowhere', rate: '5', accountId: s.acct['2200'], state: 'XX' }, h.owner, 400)
})

test('TAXFORM-002 1099 contractors: cash payments per calendar year by the IRS rules Pantry can apply, flagged at the threshold, forms and CSV in January', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const bank = await h.command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2024-12-31', openingBalance: '0.00' })
  const v = {}
  for (const name of ['Ada Okafor', 'Ben Ruiz Design', 'Cal Supply Co']) v[name] = await h.command('contact.save', { kind: 'vendor', name, termsDays: 30 })
  const pay = (name, date, amount, method) => h.command('payment.record', { direction: 'paid', contactId: v[name].id, date, amount, bankAccountId: bank.id, method })
  await pay('Ada Okafor', '2025-03-04', '400.00', 'check'); await pay('Ada Okafor', '2025-06-10', '250.00', 'ach'); await pay('Ada Okafor', '2025-08-01', '300.00', 'card')
  await pay('Ben Ruiz Design', '2025-05-05', '500.00', 'check'); await pay('Ben Ruiz Design', '2025-09-09', '700.00', 'payment-network')
  await pay('Cal Supply Co', '2025-04-01', '900.00', 'check')
  await pay('Ada Okafor', '2026-02-02', '1500.00', 'ach')
  const later = await pay('Ada Okafor', '2026-07-07', '600.00')
  const bea = await h.member('bea@example.test', 'bookkeeper')
  await h.command('contractor.save', { contactId: v['Ada Okafor'].id, is1099: true }, bea)
  await h.command('contractor.save', { contactId: v['Ben Ruiz Design'].id, is1099: true, legalName: 'Benjamin Ruiz', tinKind: 'ssn', tin: '12345678', address: '1 Main St', city: 'Albany', state: 'NY', zip: '12207' }, bea, 400)

  let y25 = await h.view('reports/contractors?year=2025', bea)
  assert.deepEqual([y25.threshold, y25.yearEnded], [60000, true])
  assert.deepEqual(y25.contractors.map(x => [x.name, x.box1, x.excluded, x.overThreshold]), [['Ada Okafor', 65000, 30000, true]])
  assert.deepEqual(y25.unmarked.map(x => [x.name, x.box1]), [['Cal Supply Co', 90000]])
  // A form over the threshold without its TIN and address is not filing-ready.
  assert.equal((await h.send('/api/pantry/reports/contractors/2025/1099-nec.csv', undefined, { cookie: h.owner })).status, 409)
  await h.command('contractor.save', { contactId: v['Ada Okafor'].id, is1099: true, legalName: 'Adaeze Okafor', tinKind: 'ssn', tin: '123-45-6789', address: '22 Elm St Apt 4', city: 'Brooklyn', state: 'ny', zip: '11201' }, bea)
  await h.command('contractor.save', { contactId: v['Ben Ruiz Design'].id, is1099: true, legalName: 'Benjamin Ruiz', tinKind: 'ein', tin: '98-7654321', address: '1 Main St', city: 'Albany', state: 'NY', zip: '12207' }, bea)
  y25 = await h.view('reports/contractors?year=2025', bea)
  assert.deepEqual(y25.contractors.map(x => [x.name, x.box1, x.excluded, x.overThreshold, x.tax.tin]), [['Ada Okafor', 65000, 30000, true, '•••-••-6789'], ['Ben Ruiz Design', 50000, 70000, false, '••-•••4321']])
  assert.deepEqual(y25.forms, [{ id: v['Ada Okafor'].id, name: 'Adaeze Okafor', tin: '•••-••-6789', box1: 65000, box4: 0, ready: true }])
  assert.ok(!JSON.stringify(y25).includes('123456789') && !JSON.stringify(await h.view('state', bea)).includes('123456789'), 'views never carry the full TIN')
  // The filing CSV carries the full TIN: owner or the posting grant only, and audited.
  assert.equal((await h.send('/api/pantry/reports/contractors/2025/1099-nec.csv', undefined, { cookie: bea })).status, 403)
  const csv = await h.send('/api/pantry/reports/contractors/2025/1099-nec.csv', undefined, { cookie: h.owner })
  assert.equal(csv.status, 200)
  const lines = csv.value.trim().split('\r\n')
  assert.equal(lines.length, 2)
  assert.equal(lines[1], `2025,1099-NEC,Juniper Lane Design LLC,NY,${v['Ada Okafor'].id},Adaeze Okafor,SSN,123-45-6789,22 Elm St Apt 4,Brooklyn,NY,11201,650.00,0.00`)
  const activity = await h.view('activity')
  assert.ok(activity.audit.some(a => a.action === 'contractor.1099-csv'))
  assert.ok(!JSON.stringify(activity).includes('123456789') && !JSON.stringify(activity).includes('123-45-6789'), 'the audit trail never carries the full TIN')
  // 2026: $2,000 threshold; a payment with no recorded method is shown apart until a person sets it.
  let y26 = await h.view('reports/contractors?year=2026', bea)
  assert.deepEqual([y26.threshold, y26.yearEnded], [200000, false])
  assert.deepEqual(y26.contractors.map(x => [x.name, x.box1, x.unrecorded, x.overThreshold, x.mayReach]), [['Ada Okafor', 150000, 60000, false, true], ['Ben Ruiz Design', 0, 0, false, false]])
  await h.command('payment.set-method', { id: later.id, method: 'check' }, bea)
  y26 = await h.view('reports/contractors?year=2026', bea)
  assert.deepEqual(y26.contractors.map(x => [x.name, x.box1, x.overThreshold]), [['Ada Okafor', 210000, true], ['Ben Ruiz Design', 0, false]])
  assert.equal((await h.send('/api/pantry/reports/contractors/2026/1099-nec.csv', undefined, { cookie: h.owner })).status, 409)
})
