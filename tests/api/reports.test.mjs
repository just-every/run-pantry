import test from 'node:test'
import assert from 'node:assert/strict'
import { fakePlaid } from './plaid.mjs'
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
  assert.equal((await h.view(`reports/profit-and-loss?${OCT}`)).netIncome, -17728, 'the declared cash tax method picks the default')
  await h.view(`reports/profit-and-loss?${OCT}&basis=modified`, h.owner, 400)
  const before = (await h.db.prepare("SELECT * FROM pt_journal_entries ORDER BY id").all()).results
  for (const basis of ['cash', 'accrual']) {
    const pl = await h.view(`reports/profit-and-loss?${OCT}&basis=${basis}`)
    const sales = await h.view(`reports/sales-by-customer?${OCT}&basis=${basis}`), costs = await h.view(`reports/expenses-by-vendor?${OCT}&basis=${basis}`)
    assert.equal(sales.total, pl.totalIncome); assert.equal(costs.total, pl.totalExpenses)
    assert.equal(costs.rows.find(r => r.id === 'unassigned').amount, 1200, 'direct postings stay in totals')
    assert.equal(sales.rows.find(r => r.id === s.c['Cedar Studio'].id).amount, basis === 'cash' ? 47472 : 100000)
    assert.equal(costs.rows.find(r => r.id === s.c['Brightline Software'].id).amount, 64000)
    for (const kind of ['trial-balance', 'general-ledger', 'profit-and-loss', 'balance-sheet', 'sales-tax', 'sales-by-customer', 'sales-by-item', 'expenses-by-vendor']) {
      const pdf = await h.send(`/api/pantry/reports/${kind}/export?${OCT}&basis=${basis}`, undefined, { cookie: h.owner })
      assert.equal(pdf.status, 200, pdf.value); assert.equal(pdf.headers.get('content-type'), 'application/pdf')
      const pages = pdf.value.match(/\/Type \/Page\b/g).length
      assert.equal((pdf.value.match(new RegExp(basis === 'cash' ? 'Cash basis' : 'Accrual basis', 'g')) ?? []).length, pages, 'each PDF page declares its basis')
      const csv = await h.send(`/api/pantry/reports/${kind}/export?${OCT}&basis=${basis}&format=csv`, undefined, { cookie: h.owner })
      assert.equal(csv.status, 200); assert.match(csv.value, new RegExp(basis === 'cash' ? 'Cash basis' : 'Accrual basis'))
    }
    const pdf = await h.send(`/api/pantry/reports/profit-and-loss/export?${OCT}&basis=${basis}`, undefined, { cookie: h.owner })
    assert.ok(pdf.value.includes(basis === 'cash' ? '-$177.28' : '$1,048.00'), 'PDF includes the calculated P&L total')
  }
  assert.deepEqual((await h.db.prepare("SELECT * FROM pt_journal_entries ORDER BY id").all()).results, before, 'switching and exporting never changes the ledger')
  const archiveResponse = await fetch(`${h.origin}/api/pantry/package/2026-10/accountant-package.zip?basis=cash`, { headers: { cookie: h.owner } })
  assert.equal(archiveResponse.status, 200)
  const archive = Buffer.from(await archiveResponse.arrayBuffer())
  let offset = 0, count = 0
  while (archive.readUInt32LE(offset) === 0x04034b50) {
    const size = archive.readUInt32LE(offset + 18), nameSize = archive.readUInt16LE(offset + 26), extraSize = archive.readUInt16LE(offset + 28)
    const name = archive.subarray(offset + 30, offset + 30 + nameSize).toString(), dataAt = offset + 30 + nameSize + extraSize
    if (name.endsWith('.csv')) {
      const body = archive.subarray(dataAt, dataAt + size).toString()
      const label = name.includes('aging') ? 'Open items · accrual basis' : name.endsWith('cash-flow.csv') ? 'Indirect method · starts from accrual net income' : 'Cash basis'
      assert.equal(body.split('\r\n')[0], `Basis,${label}`, `export declares actual semantics: ${name}`); count++
    }
    offset = dataAt + size
  }
  assert.ok(count >= 8, 'every report inside the downloaded package was examined')
  assert.equal((await h.view(`reports/sales-by-customer?${OCT}`)).basis, 'cash')
  assert.equal((await h.view(`reports/receivables?${OCT}&basis=cash`)).basis, 'accrual', 'ageing honestly describes open items')
  assert.equal((await h.view('reports/contractors?year=2025')).basis, 'payment')
  assert.match((await h.send(`/api/pantry/reports/cash-flow.csv?${OCT}`, undefined, { cookie: h.owner })).value, /Indirect method · starts from accrual net income/)
  const d = await s.issue('Willow Services', '2026-10-18', [
    { description: 'Design', quantity: '1', rate: '600.00', accountId: s.acct['4000'], taxCode: 'exempt' },
    { description: 'Workshop', quantity: '1', rate: '400.00', accountId: s.acct['4100'], taxCode: 'exempt' }])
  await h.command('payment.record', { direction: 'received', contactId: s.c['Willow Services'].id, date: '2026-11-18', amount: '500.00', bankAccountId: s.bank.id, allocations: [{ targetId: d.id, amount: '500.00' }] })
  assert.equal((await h.view(`reports/profit-and-loss?${OCT}&basis=cash`)).totalIncome, cash.totalIncome, 'unpaid October invoice excluded')
  const november = await h.view('reports/profit-and-loss?from=2026-11-01&to=2026-11-30&basis=cash')
  assert.deepEqual([lineOf(november, '4000') - lineOf(nov, '4000'), lineOf(november, '4100') - lineOf(nov, '4100')], [30000, 20000], 'half of the $1000 invoice is recognised proportionally in November')

})

test('REPORT-005 every P&L and balance sheet figure opens to its records, documents and bank lines, and ties to the figure', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  await h.command('document.upload', { name: 'brightline-bl-1042.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 Brightline BL-1042 $640.00\n').toString('base64'), linkedKind: 'bill', linkedId: s.bills.x.id })
  const statement = 'Details,Posting Date,Description,Amount,Type,Balance,Check or Slip #\nDEBIT,10/16/2026,"CHECK 1001 BRIGHTLINE",-640.00,CHECK_PAID,9360.00,1001\nCREDIT,10/21/2026,"DEPOSIT CEDAR STUDIO ACH",500.00,ACH_CREDIT,9860.00,\nDEBIT,10/29/2026,"WIRE FEE",-15.00,FEE_TRANSACTION,9845.00,\n'
  const imported = await h.command('statement.import', { bankAccountId: s.bank.id, fileName: 'checking-2026-10.csv', content: statement, opening: '10000.00', closing: '9845.00', start: '2026-10-01', end: '2026-10-30', confirmLast4: '4821' })
  const r = await h.view(`reconciliation/${imported.statement.id}`)
  await h.command('match.approve', { bankLineIds: [at(r.lines, l => l.description.includes('BRIGHTLINE')).id], journalLineIds: [at(r.postings, p => p.memo.includes('Payment to Brightline')).id] })
  // A fee filed by hand from its statement line (+ Expense or fee).
  await h.command('match.approve', { bankLineIds: [at(r.lines, l => l.description === 'WIRE FEE').id], journalLineIds: [], create: [{ type: 'fee', accountId: s.acct['6400'], amount: '15.00' }] })

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
  const software = await h.view(`reports/detail?report=profit-and-loss&line=${s.acct['6200']}&${OCT}&basis=accrual`)
  const row = at(software.rows, x => x.record.kind === 'bill')
  assert.deepEqual([row.amount, row.record.id, row.record.label], [64000, s.bills.x.id, 'Bill BL-1042 · Brightline Software'])
  assert.deepEqual(row.documents.map(d => d.name), ['brightline-bl-1042.pdf'])
  assert.deepEqual(row.bank.map(b => [b.date, b.description, b.amount]), [['2026-10-16', 'CHECK 1001 BRIGHTLINE', -64000]])
  // The hand-filed fee opens to the statement line it was filed from.
  const fees = await h.view(`reports/detail?report=profit-and-loss&line=${s.acct['6400']}&${OCT}&basis=accrual`)
  assert.deepEqual(at(fees.rows, x => x.amount === 1500).bank.map(b => [b.date, b.description, b.amount, b.reconciled]), [['2026-10-29', 'WIRE FEE', -1500, false]])
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

test('SALESTAX-004 economic nexus: a year of New Jersey invoices alerts owner and accountant at 80% then 100%, and the accountant records the decision on the state row', async t => {
  const h = await harness(); t.after(() => h.close())
  const { today } = await h.view('sales-tax/nexus'), last = Number(today.slice(0, 4)) - 1
  await h.command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: `${last}-01-01`, policies: '' })
  await h.command('chart.start', {})
  const acct = Object.fromEntries((await h.view('state')).accounts.map(a => [a.code, a.id]))
  const cpa = await h.member('cpa@example.test', 'accountant')
  const nj = await h.command('tax-code.save', { name: 'New Jersey', rate: '6.625', accountId: acct['2200'], state: 'NJ' })
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Hudson Rail Partners', termsDays: 30 })
  const issue = async (issueDate, rate, { destinationState = 'NJ', taxCode = 'exempt', ...extra } = {}) => {
    const d = await h.command('invoice.save-draft', { customerId: customer.id, destinationState, issueDate, lines: [{ description: 'Signal design', quantity: '1', rate, accountId: acct['4000'], taxCode }], ...extra })
    await h.command('invoice.approve', { id: d.id, revision: d.revision })
    return h.command('invoice.issue', { id: d.id })
  }
  // A year of monthly invoices shipped to New Jersey: $84,000 is 84% of its $100,000 previous-calendar-year threshold.
  for (let month = 1; month <= 11; month++) await issue(`${last}-${String(month).padStart(2, '0')}-15`, '7000.00')
  await issue(`${last}-12-15`, '7000.00', { destinationState: '', taxCode: nj.id })
  await issue(`${last}-12-16`, '900.00', { destinationState: '' })
  let watch = await h.view('sales-tax/nexus')
  const row = () => at(watch.states, s => s.state === 'NJ')
  assert.deepEqual([row().thresholdSales, row().thresholdTransactions, row().test, row().period, row().sales, row().transactions, row().reached, row().level],
    [10000000, 200, 'or', `Calendar year ${last}`, 8400000, 12, 8400, 80])
  assert.deepEqual(watch.unassigned, { sales: 90000, documents: 1 }, 'a sale with no ship-to state and no state tax code is listed, not guessed')
  assert.match(row().source, /New Jersey Division of Taxation/); assert.equal(row().version, watch.version)
  const alerts = () => h.mail.filter(m => /economic-nexus threshold/.test(m.subject))
  await h.cron(); await h.cron()
  assert.equal(alerts().length, 1, 'one 80% alert however often due work runs')
  assert.deepEqual(alerts()[0].to.sort(), ['cpa@example.test', 'owner@example.test'])
  assert.match(alerts()[0].subject, /NJ sales at 80%/); assert.match(alerts()[0].text, /\$84,000\.00 of \$100,000\.00/)
  // One more invoice crosses 100%.
  const big = await issue(`${last}-12-20`, '20000.00')
  await h.cron()
  assert.equal(alerts().length, 2); assert.match(alerts()[1].subject, /NJ sales at 100%/)
  watch = await h.view('sales-tax/nexus')
  assert.deepEqual([row().sales, row().transactions, row().level, row().alerts.map(a => [a.level, a.resolved_at, a.email_status])], [10400000, 13, 100, [[100, null, 'accepted'], [80, null, 'accepted']]])
  // A credit brings sales back under; the 100% alert resolves and the 80% one stays open.
  await issue(`${last}-12-28`, '5000.00', { kind: 'credit', creditFor: big.id })
  await h.cron()
  watch = await h.view('sales-tax/nexus')
  assert.deepEqual([row().sales, row().transactions, row().level], [9900000, 13, 80])
  assert.ok(at(row().alerts, a => a.level === 100).resolved_at); assert.equal(at(row().alerts, a => a.level === 80).resolved_at, null)
  // Registering is the accountant's decision, recorded with the figures it was made on.
  const refused = await h.command('nexus.decide', { state: 'NJ', decision: 'register', note: 'Owner guess' }, h.owner, 403)
  assert.match(refused.error, /accountant/)
  watch = await h.command('nexus.decide', { state: 'NJ', decision: 'register', note: 'Register from 1 January; collect 6.625% on taxable lines.' }, cpa)
  assert.deepEqual([row().decision.decision, row().decision.decided_by, row().decision.sales_cents, row().decision.threshold_version, row().decision.note],
    ['register', 'cpa@example.test', 9900000, watch.version, 'Register from 1 January; collect 6.625% on taxable lines.'])
  assert.equal((await h.view('sales-tax/nexus')).states.find(s => s.state === 'NJ').decision.decision, 'register')
})

test('CLOSE-005 / TAXFORM-002 1099 contractors: cash payments per calendar year by the IRS rules Pantry can apply, flagged at the threshold, forms and CSV in January', async t => {
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

  const readiness = (await h.view('year-end/2025')).checks.find(c => c.key === 'year-end-1099')
  assert.equal(readiness.ok, false); assert.ok(readiness.items.some(c => c.id === v['Ada Okafor'].id))

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
  assert.equal(lines[1], `2025,1099-NEC,Juniper Lane Design LLC,NY,${v['Ada Okafor'].id},Adaeze Okafor,SSN,123-45-6789,22 Elm St Apt 4,Brooklyn,NY,11201,650.00,0.00,Payment basis`)
  const activity = await h.view('activity')
  assert.ok(activity.audit.some(a => a.action === 'contractor.1099-csv'))
  assert.ok(!JSON.stringify(activity).includes('123456789') && !JSON.stringify(activity).includes('123-45-6789'), 'the audit trail never carries the full TIN')
  // 2026: $2,000 threshold; a payment with no recorded method is shown apart until a person sets it.
  let y26 = await h.view('reports/contractors?year=2026', bea)
  assert.deepEqual([y26.threshold, y26.yearEnded], [200000, false])
  assert.deepEqual(y26.contractors.map(x => [x.name, x.box1, x.unrecorded, x.overThreshold, x.mayReach]), [['Ada Okafor', 150000, 60000, false, true], ['Ben Ruiz Design', 0, 0, false, false]])
  const unknownMethods = (await h.view('year-end/2026')).checks.find(c => c.key === 'year-end-1099')
  assert.equal(unknownMethods.ok, false); assert.ok(unknownMethods.items.some(i => i.id === v['Ada Okafor'].id))
  await h.command('payment.set-method', { id: later.id, method: 'check' }, bea)
  y26 = await h.view('reports/contractors?year=2026', bea)
  assert.deepEqual(y26.contractors.map(x => [x.name, x.box1, x.overThreshold]), [['Ada Okafor', 210000, true], ['Ben Ruiz Design', 0, false]])
  assert.equal((await h.view('year-end/2026')).checks.find(c => c.key === 'year-end-1099').ok, true, 'recording the method resolves readiness')
  assert.equal((await h.send('/api/pantry/reports/contractors/2026/1099-nec.csv', undefined, { cookie: h.owner })).status, 409)
})

test('REPORT-003 indirect cash flow: activity, noncash adjustments, arbitrary periods, source entries and exports tie to cash', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  const loan = await h.command('account.save', { code: '2500', name: 'Equipment loan', type: 'liability' })
  const depreciation = await h.command('account.save', { code: '1590', name: 'Accumulated depreciation', type: 'asset' })
  const post = async (date, memo, lines) => {
    const d = await h.command('journal.save-draft', { date, memo, lines })
    return h.command('journal.post', { id: d.id, revision: d.revision })
  }
  await post('2026-10-11', 'Equipment purchase', [{ accountId: s.acct['1500'], debit: '2500.00' }, { accountId: s.acct['1000'], credit: '2500.00' }])
  await post('2026-10-12', 'Loan proceeds', [{ accountId: s.acct['1000'], debit: '4000.00' }, { accountId: loan.id, credit: '4000.00' }])
  await post('2026-10-13', 'Owner distribution', [{ accountId: s.acct['3000'], debit: '700.00' }, { accountId: s.acct['1000'], credit: '700.00' }])
  await post('2026-10-31', 'Depreciation', [{ accountId: s.acct['6500'], debit: '100.00' }, { accountId: depreciation.id, credit: '100.00' }])
  await post('2026-10-31', 'Equipment financed without cash', [{ accountId: s.acct['1500'], debit: '600.00' }, { accountId: loan.id, credit: '600.00' }])
  const range = 'from=2026-10-01&to=2026-12-31'
  const r = await h.view('reports/cash-flow?' + range)
  assert.deepEqual([r.totalOperating, r.totalInvesting, r.totalFinancing], [240125, -250000, 330000])
  assert.deepEqual([r.opening, r.closing, r.netChange, r.balanceSheetChange, r.ties], [1000000, 1320125, 320125, 320125, true])
  assert.equal(r.operating.find(l => l.id === 'net-income').amount, 94800)
  assert.equal(r.operating.find(l => l.id === `noncash:${depreciation.id}`).amount, 10000)
  // Every displayed amount, including totals and cash balances, opens to entries adding to that amount.
  for (const [id, amount] of [...[...r.operating, ...r.investing, ...r.financing].map(l => [l.id, l.amount]), ['operating', r.totalOperating], ['investing', r.totalInvesting], ['financing', r.totalFinancing], ['net-change', r.netChange], ['opening', r.opening], ['closing', r.closing]]) {
    const d = await h.view(`reports/cash-flow/detail?${range}&line=${encodeURIComponent(id)}`)
    assert.equal(d.figure, amount)
    assert.equal(d.rows.reduce((n, l) => n + l.amount, 0), amount)
    for (const row of d.rows) assert.ok((await h.view(`reports/record/entry/${row.entryId}`)).entries.length)
  }
  const start = await h.view('reports/balance-sheet?to=2026-09-30'), end = await h.view('reports/balance-sheet?to=2026-12-31')
  assert.equal(r.netChange, lineOf(end, '1000') - lineOf(start, '1000'))
  const oneDay = await h.view('reports/cash-flow?from=2026-10-11&to=2026-10-11')
  assert.deepEqual([oneDay.totalInvesting, oneDay.netChange, oneDay.ties], [-250000, -250000, true])
  const csv = await h.send(`/api/pantry/reports/cash-flow.csv?${range}`, undefined, { cookie: h.owner })
  assert.equal(csv.status, 200)
  assert.ok(csv.value.includes('3201.25') && csv.value.includes('13201.25'))
  assert.equal((await h.view('package/2026-10')).cashFlow.ties, true)
  const accountant = await h.member('cash-accountant@example.test', 'accountant')
  await h.command('cash-flow.classify', { accountId: s.acct['1500'], class: 'operating' }, accountant)
  const changed = await h.view('reports/cash-flow?' + range)
  assert.deepEqual([changed.totalOperating, changed.totalInvesting, changed.netChange, changed.ties], [-9875, 0, 320125, true])
  const viewer = await h.member('cash-viewer@example.test', 'viewer')
  await h.command('cash-flow.classify', { accountId: loan.id, class: 'investing' }, viewer, 403)
  await h.command('cash-flow.classify', { accountId: loan.id, class: 'cash' }, accountant, 400)
  await h.view('reports/cash-flow?from=2026-12-31&to=2026-10-01', h.owner, 400)
})


test('REPORT-008 dashboard figures tie to reports, waiting work has destinations, and a month lock advances books-current date', async t => {
  const plaid = await fakePlaid()
  const h = await harness({ bindings: plaid.bindings, outbound: plaid.outbound }); t.after(() => h.close())
  const s = await october(h)
  await s.issue('Willow Services', '2026-10-01', [{ description: 'Overdue work', quantity: '1', rate: '125.00', accountId: s.acct['4000'], taxCode: 'exempt' }], { dueDate: '2026-10-03' })
  await h.command('bill.save', { vendorId: s.c['Brightline Software'].id, reference: 'OVERDUE', billDate: '2026-10-01', dueDate: '2026-10-05', lines: [{ description: 'Support', accountId: s.acct['6200'], amount: '75.00' }], post: true })
  await h.command('capture-approval-rule.save', { minimum: '2500.00' })
  await h.command('bill.save', { vendorId: s.c['Brightline Software'].id, reference: 'REVIEW', billDate: '2026-10-02', lines: [{ description: 'Annual plan', accountId: s.acct['6200'], amount: '3100.00' }] })
  const connection = await h.command('feed.connect', { publicToken: 'synthetic-public-sandbox-b0e2c4ee-a763-4df5-bfe9-46a46bce993d', institution: { name: 'First Platypus Bank' } })
  await h.command('feed.map', { itemId: connection.id, accounts: [{ id: at(connection.accounts, a => a.mask === '0000').id, bankAccountId: s.bank.id }] })
  await h.command('books-agent.run', {})
  const queue = (await h.view('state')).overview.queue
  assert.ok(queue.unmatchedLines > 0 && queue.questions > 0)
  let d = await h.view('dashboard?to=2026-10-31')
  const provider = at(plaid.recorded['accounts-get'].accounts, a => a.mask === '0000')
  assert.equal(d.cash.total, Math.round(provider.balances.current * 100)); assert.equal(d.cash.observed, 1)
  assert.equal(d.basis, 'cash', 'declared business tax method picks the default')
  for (const basis of ['cash', 'accrual']) {
    d = await h.view(`dashboard?to=2026-10-31&basis=${basis}`)
    for (const m of d.trend) {
      const pl = await h.view(`reports/profit-and-loss?from=${m.from}&to=${m.to}&basis=${basis}`)
      assert.deepEqual([m.income, m.expenses, m.netIncome], [pl.totalIncome, pl.totalExpenses, pl.netIncome])
    }
  }
  const lines = (await h.view('bank/lines')).lines.filter(l => l.posted_date >= d.from && l.posted_date <= d.asOf)
  assert.deepEqual(d.movements, { moneyIn: lines.filter(l => l.amount_cents > 0).reduce((n, l) => n + l.amount_cents, 0), moneyOut: -lines.filter(l => l.amount_cents < 0).reduce((n, l) => n + l.amount_cents, 0) })
  assert.equal(d.overdue.receivables.amount, 12500)
  assert.equal(d.overdue.payables.amount, 7500, 'a bill due on the as-of date is not overdue')
  assert.equal(d.work.billsToApprove, 1); assert.ok(d.work.missingReceipts > 0)
  assert.equal(d.work.missingByMonth.reduce((n, m) => n + m.count, 0), d.work.missingReceipts)
  assert.equal(d.currentThrough, null)
  plaid.state.loginRequired = true
  await h.command('feed.sync', { itemId: connection.id })
  assert.equal((await h.view('dashboard?to=2026-10-31')).work.brokenConnections, 1)
  const viewer = await h.member('dashboard@example.test', 'viewer')
  await h.view('dashboard?to=2026-10-31', viewer)
  assert.equal((await h.send('/api/pantry/dashboard')).status, 401)

  // A genuine close on a fresh business, without a bank balance standing in
  // for reconciliation, advances the reported date only after the lock.
  const fresh = await harness(); t.after(() => fresh.close()); const freshBooks = await books(fresh)
  assert.equal((await fresh.view('dashboard?to=2026-10-31')).currentThrough, null)
  let close = await fresh.command('close.tasks', { period: '2026-09' })
  for (const task of close.tasks) close = await fresh.command('close.task', { id: task.id, revision: task.revision, done: true, note: 'Reviewed' })
  await fresh.command('period.lock', { period: '2026-09' })
  assert.deepEqual([(await fresh.view('dashboard?to=2026-10-31')).currentThrough, (await fresh.view('dashboard?to=2026-10-31')).currentSource], ['2026-09-30', 'locked'])
  const bank = await fresh.command('bank-account.save', { name: 'Checking', institution: 'Community Bank', accountId: freshBooks.acct['1000'], numberLast4: '1234', openingDate: '2026-09-30', openingBalance: '0' })
  const statement = await fresh.command('statement.import', { bankAccountId: bank.id, fileName: 'october.csv', content: 'Posting Date,Description,Amount\n10/15/2026,INTEREST,1.00\n', opening: '0', closing: '1', start: '2026-10-01', end: '2026-10-31', confirmLast4: '1234' })
  const interest = at((await fresh.view('bank/lines')).lines, l => l.description === 'INTEREST')
  await fresh.command('match.approve', { bankLineIds: [interest.id], create: [{ type: 'income', amount: '1', accountId: freshBooks.acct['4900'] }] })
  await fresh.command('reconciliation.complete', { statementId: statement.statement.id })
  const reconciled = await fresh.view('dashboard?to=2026-10-31')
  assert.deepEqual([reconciled.currentThrough, reconciled.currentSource], ['2026-10-31', 'fully-reconciled'])
  const reserve = await fresh.command('account.save', { code: '1010', name: 'Savings', type: 'asset', subtype: 'bank' })
  await fresh.command('bank-account.save', { name: 'Savings', institution: 'Community Bank', accountId: reserve.id, numberLast4: '4321', openingDate: '2026-09-30', openingBalance: '0' })
  assert.equal((await fresh.view('dashboard?to=2026-10-31')).currentThrough, '2026-09-30', 'one unreconciled account prevents a later fully-reconciled date')

})

test('REPORT-001 financial statements with comparisons, fiscal periods, YTD and customer columns tie to single reports on both bases', async t => {
  const h = await harness(); t.after(() => h.close())
  const s = await october(h)
  await s.issue('Cedar Studio', '2025-10-05', [{ description: 'Prior-year design', quantity: '1', rate: '450.00', accountId: s.acct['4000'], taxCode: 'exempt' }])
  const priorLoss = await h.command('journal.save-draft', { date: '2025-10-31', memo: 'Prior-year software costs', lines: [{ accountId: s.acct['6200'], debit: '500.00' }, { accountId: s.acct['1000'], credit: '500.00' }] })
  await h.command('journal.post', { id: priorLoss.id, revision: priorLoss.revision })
  const job = await h.command('journal.save-draft', { date: '2026-10-12', memo: 'Cedar job materials', lines: [{ accountId: s.acct['6000'], contactId: s.c['Cedar Studio'].id, debit: '50.00' }, { accountId: s.acct['1000'], credit: '50.00' }] })
  await h.command('journal.post', { id: job.id, revision: job.revision })
  await h.command('entity.save', { revision: (await h.view('state')).settings.entity.revision, legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 4, taxMethod: 'cash', booksStart: '2026-01-01' })
  const before = (await h.db.prepare('SELECT * FROM pt_journal_entries ORDER BY id').all()).results
  const keys = { 'profit-and-loss': ['totalIncome', 'totalExpenses', 'netIncome'], 'balance-sheet': ['totalAssets', 'totalLiabilities', 'totalEquity', 'liabilities-and-equity'] }
  for (const basis of ['cash', 'accrual']) for (const kind of ['profit-and-loss', 'balance-sheet']) {
    for (const mode of ['prior-period', 'prior-year', 'months', 'quarters', 'ytd', ...(kind === 'profit-and-loss' ? ['customer'] : [])]) {
      const path = `reports/${kind}?${OCT}&basis=${basis}&columns=${mode}`
      const r = await h.view(path)
      assert.equal(r.basis, basis); assert.equal(r.mode, mode)
      if (basis === 'cash') assert.deepEqual(await h.view(`reports/${kind}?${OCT}&columns=${mode}`), r, 'declared cash method is the default for every variant')
      const moneyColumns = r.columns.filter(c => c.unit === 'money' && c.id !== 'change')
      if (mode === 'months' || mode === 'quarters') {
        assert.equal(moneyColumns[0].from, '2026-04-01'); assert.equal(moneyColumns.at(-1).to, '2027-03-31')
        assert.equal(moneyColumns.length, mode === 'months' ? 12 : 4)
      }
      if (mode === 'ytd') assert.deepEqual([r.columns[0].from, r.columns[0].to], ['2026-04-01', '2026-10-31'])
      if (mode === 'prior-period') assert.deepEqual([r.columns[1].from, r.columns[1].to], ['2026-08-31', '2026-09-30'])
      if (mode === 'prior-year') assert.deepEqual([r.columns[1].from, r.columns[1].to], ['2025-10-01', '2025-10-31'])
      if (mode === 'customer') {
        assert.ok(r.columns.some(c => c.id === s.c['Cedar Studio'].id)); assert.ok(r.columns.some(c => c.id === 'unassigned'))
        for (const l of [...r.rows, ...r.totals]) assert.equal(l.values.slice(0, -1).reduce((a, b) => a + b, 0), l.values.at(-1), `customer sum ${l.name}`)
        assert.equal(r.rows.find(l => l.code === '6000').values[r.columns.findIndex(c => c.id === s.c['Cedar Studio'].id)], 5000)
      }
      for (const [i, c] of r.columns.entries()) {
        if (c.unit !== 'money' || c.id === 'change' || (mode === 'customer' && c.id !== 'total')) continue
        const single = await h.view(`reports/${kind}?from=${c.from}&to=${c.to}&basis=${basis}`)
        for (const row of r.rows) assert.equal(row.values[i], row.code ? lineOf(single, row.code) : [...(single.equity ?? [])].find(l => l.id === row.id)?.amount ?? 0, `${path}: ${c.label}: ${row.name}`)
        assert.deepEqual(r.totals.map(l => l.values[i]), keys[kind].map(k => k === 'liabilities-and-equity' ? single.totalLiabilities + single.totalEquity : single[k]))
      }
      if (mode.startsWith('prior-')) for (const row of [...r.rows, ...r.totals]) {
        assert.equal(row.values[2], row.values[0] - row.values[1])
        assert.equal(row.values[3], row.values[1] === 0 ? null : Math.round((row.values[0] - row.values[1]) / Math.abs(row.values[1]) * 10000) / 100)
      }
      for (const format of ['csv', 'pdf']) {
        const x = await h.send(`/api/pantry/reports/${kind}/export?${OCT}&basis=${basis}&columns=${mode}&format=${format}`, undefined, { cookie: h.owner })
        assert.equal(x.status, 200, x.value)
        if (basis === 'cash') {
          const declaredExport = await h.send(`/api/pantry/reports/${kind}/export?${OCT}&columns=${mode}&format=${format}`, undefined, { cookie: h.owner })
          assert.equal(declaredExport.status, 200); assert.equal(declaredExport.value, x.value, 'exports inherit the declared basis')
        }
        const label = basis === 'cash' ? 'Cash basis' : 'Accrual basis'
        if (format === 'pdf') {
          assert.equal((x.value.match(new RegExp(label, 'g')) ?? []).length, x.value.match(/\/Type \/Page\b/g).length, 'every exported page labels its basis')
          for (const l of r.totals) for (const [i, v] of l.values.entries()) {
            if (v === null) continue
            const printed = r.columns[i].unit === 'percent' ? `${v}%` : `${v < 0 ? '-' : ''}$${(Math.abs(v) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
            assert.ok(x.value.includes(printed), `PDF ${l.name} ${r.columns[i].label} ${printed}`)
          }
        }
        else {
          assert.match(x.value, new RegExp(label)); assert.match(x.value, /2026-10-31|2027-03-31/)
          for (const l of r.totals) {
            const exported = x.value.split('\r\n').find(row => row.startsWith(`"${l.name}",`))
            assert.ok(exported, l.name)
            for (const [i, v] of l.values.entries()) assert.ok(exported.includes(v === null ? 'Not comparable (prior is zero)' : r.columns[i].unit === 'percent' ? `${v}%` : (v / 100).toFixed(2)), `export ${l.name} ${i}`)
          }
        }
      }
    }
  }
  const octoberComparison = await h.view(`reports/profit-and-loss?${OCT}&columns=prior-year&basis=accrual`)
  assert.deepEqual(octoberComparison.totals.find(l => l.id === 'net-income').values, [99800, -5000, 104800, 2096])
  const declared = await h.view(`reports/profit-and-loss?${OCT}&columns=prior-year`)
  assert.equal(declared.basis, 'cash')
  const leap = await h.view('reports/profit-and-loss?from=2024-02-29&to=2024-02-29&columns=prior-year')
  assert.deepEqual([leap.columns[1].from, leap.columns[1].to], ['2023-02-28', '2023-02-28'])
  await h.view(`reports/balance-sheet?${OCT}&columns=customer`, h.owner, 400)
  await h.view(`reports/profit-and-loss?${OCT}&columns=unknown`, h.owner, 400)
  await h.view('reports/profit-and-loss?from=2026-11-01&to=2026-10-01&columns=months', h.owner, 400)
  assert.deepEqual((await h.db.prepare('SELECT * FROM pt_journal_entries ORDER BY id').all()).results, before, 'columns, basis switches and exports never write to the ledger')
})

test('BUDGET-001 annual account/month plans copy posted actuals plus 5%, edit a month, import CSV and mapped Easel plans, and tie quarterly variances on both bases', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const journal = async (date, memo, income, expense) => {
    const draft = await h.command('journal.save-draft', { date, memo, lines: [{ accountId: acct['1000'], debit: income }, { accountId: acct['4000'], credit: income }, { accountId: acct['6200'], debit: expense }, { accountId: acct['1000'], credit: expense }] })
    return h.command('journal.post', { id: draft.id, revision: draft.revision })
  }
  await journal('2025-01-17', 'Last year studio activity', '1000.00', '300.00')
  await journal('2026-01-17', 'This year studio activity', '1200.00', '450.00')
  await h.command('journal.save-draft', { date: '2025-02-12', memo: 'Unposted estimate excluded', lines: [{ accountId: acct['1000'], debit: '9999.00' }, { accountId: acct['4000'], credit: '9999.00' }] })
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio', termsDays: 30 })
  const invoice = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-02-10', dueDate: '2026-03-12', lines: [{ description: 'Unpaid design work', quantity: '1', rate: '500.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  await h.command('invoice.approve', { id: invoice.id, revision: invoice.revision })
  await h.command('invoice.issue', { id: invoice.id, revision: invoice.revision })
  const before = await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
  let plan = await h.command('budget.save', { name: 'Studio 2026', startMonth: '2026-01', copyActuals: true, percentChange: '5' })
  assert.equal(plan.basis, 'cash', 'declared basis applies to copying actuals')
  assert.deepEqual(plan.cells.map(c => [c.account_id, c.month, c.amount_cents]).sort(), [[acct['4000'], '2026-01', 105000], [acct['6200'], '2026-01', 31500]].sort())
  plan = await h.command('budget.save', { id: plan.id, revision: plan.revision, name: plan.name, startMonth: plan.start_month, basis: plan.basis, cells: plan.cells.map(c => ({ accountId: c.account_id, month: c.month, amount: c.account_id === acct['6200'] ? '400.00' : (c.amount_cents / 100).toFixed(2) })) })
  const quarter = `budgets/${plan.id}/report?from=2026-01-01&to=2026-03-31`
  const cash = await h.view(quarter)
  assert.deepEqual(cash.netIncome, { budget: 65000, actual: 75000, variance: 10000, percent: 15.38 })
  assert.equal(cash.basis, 'cash')
  for (const basis of ['cash', 'accrual']) {
    const report = await h.view(`${quarter}&basis=${basis}`), pl = await h.view(`reports/profit-and-loss?from=2026-01-01&to=2026-03-31&basis=${basis}`)
    assert.equal(report.netIncome.actual, pl.netIncome)
    for (const row of report.rows) {
      assert.equal(row.actual, [...pl.income, ...pl.expenses].find(a => a.id === row.id)?.amount ?? 0)
      assert.equal(row.variance, row.actual - row.budget)
      assert.equal(row.percent, Math.round(row.variance / Math.abs(row.budget) * 10000) / 100)
    }
    const csv = await h.send(`/api/pantry/budgets/${plan.id}/report.csv?from=2026-01-01&to=2026-03-31&basis=${basis}`, undefined, { cookie: h.owner })
    assert.equal(csv.status, 200)
    assert.match(csv.value, new RegExp(`${basis === 'cash' ? 'Cash' : 'Accrual'} basis`))
    assert.match(csv.value, new RegExp(`"${(pl.netIncome / 100).toFixed(2)}"`))
  }
  const partial = await h.view(`budgets/${plan.id}/report?from=2026-01-16&to=2026-01-31`)
  assert.equal(at(partial.rows, r => r.id === acct['4000']).budget, Math.round(105000 * 16 / 31))
  const entered = await h.command('budget.save', { name: 'Manual 2026', startMonth: '2026-01', cells: [{ accountId: acct['4000'], month: '2026-01', amount: '0.00' }, { accountId: acct['6200'], month: '2026-02', amount: '-12.55' }] })
  assert.equal((await h.view(`budgets/${entered.id}/report?from=2026-01-01&to=2026-01-31`)).rows[0].percent, null)
  const imported = await h.command('budget.save', { name: 'CSV plan', startMonth: '2026-01', csv: 'Account,Month,Amount\r\n4000,2026-01,2000.00\r\n6200,2026-02,-12.55\r\n' })
  assert.deepEqual(imported.cells.map(c => [c.month, c.amount_cents]).sort(), [['2026-01', 200000], ['2026-02', -1255]])
  // Easel's real scenario response: calculation cells are integer minor units,
  // departments aggregate only through an explicit line-to-chart mapping.
  const easel = { scenario: { id: 'board-budget', name: 'Board budget' }, workspace: { currency: 'USD', planStart: '2026-01', horizon: 12 }, lines: [{ id: 'design', name: 'Design services', type: 'revenue' }, { id: 'software', name: 'Software', type: 'operating-expense' }], calculation: { currency: 'USD', cells: [{ line: 'design', department: 'studio', month: '2026-01', amount: 200000, basis: 'plan' }, { line: 'design', department: 'projects', month: '2026-01', amount: 100000, basis: 'plan' }, { line: 'software', department: 'studio', month: '2026-02', amount: 50000, basis: 'plan' }] } }
  const mapped = await h.command('budget.save', { name: 'Easel board plan', startMonth: '2026-01', easel, mapping: { design: acct['4000'], software: acct['6200'] } })
  assert.deepEqual(mapped.cells.map(c => [c.account_id, c.month, c.amount_cents]).sort(), [[acct['4000'], '2026-01', 300000], [acct['6200'], '2026-02', 50000]].sort())
  assert.equal((await h.view(`budgets/${mapped.id}/report?from=2026-01-01&to=2026-03-31`)).netIncome.budget, 250000)
  assert.equal((await h.view('budgets')).budgets.length, 4)
  await h.command('budget.save', { name: 'Unmapped', startMonth: '2026-01', easel, mapping: {} }, h.owner, 400)
  await h.command('budget.save', { name: 'Foreign', startMonth: '2026-01', easel: { ...easel, calculation: { ...easel.calculation, currency: 'AUD' } }, mapping: {} }, h.owner, 400)
  await h.command('budget.save', { name: 'Unknown CSV account', startMonth: '2026-01', csv: 'Account,Month,Amount\nmissing,2026-01,10.00' }, h.owner, 400)
  await h.command('budget.save', { name: 'Duplicate cell', startMonth: '2026-01', csv: 'Account,Month,Amount\n4000,2026-01,10.00\n4000,2026-01,20.00' }, h.owner, 400)
  await h.command('budget.save', { name: 'Outside year', startMonth: '2026-01', csv: 'Account,Month,Amount\n4000,2027-01,10.00' }, h.owner, 400)
  await h.command('budget.save', { id: plan.id, revision: 'stale', name: plan.name, startMonth: '2026-01', cells: [] }, h.owner, 409)
  const viewer = await h.member('budget-viewer@example.test', 'viewer')
  await h.view(quarter, viewer)
  await h.command('budget.save', { name: 'Unauthorized', startMonth: '2026-01', cells: [] }, viewer, 403)
  await h.view(`budgets/${plan.id}/report?from=2025-12-31&to=2026-03-31`, h.owner, 400)
  assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'), before, 'planning never changes the posted ledger')
})
