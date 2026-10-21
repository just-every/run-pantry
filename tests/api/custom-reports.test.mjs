import test from 'node:test'
import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

const basic = { name: 'Personal income', source: 'profit-and-loss', from: '2026-10-01', to: '2026-10-31', columns: ['name', 'amount'] }
const doors = (prefix, id) => [`${prefix}/${id}`, `${prefix}/${id}/render`, `${prefix}/${id}/export.pdf`, `${prefix}/${id}/export.csv`, `${prefix}/${id}/export.json`, ...(prefix === 'custom-reports' ? [`${prefix}/${id}/figures?row=missing&column=amount`, `${prefix}/${id}/figures/export?row=missing&column=amount`] : [])]

test('REPORT-006 personal and role sharing applies on every door, owner edits, revision fences and revoked references', async t => {
  const h = await harness(); t.after(() => h.close())
  await books(h)
  const bookkeeper = await h.member('keeper@example.test', 'bookkeeper')
  const accountant = await h.member('accountant@example.test', 'accountant')
  const viewer = await h.member('viewer@example.test', 'viewer')
  let saved = await h.command('custom-report.save', { definition: basic }, bookkeeper)
  assert.equal(saved.can_edit, true)
  assert.deepEqual(saved.shared_roles, [])
  assert.deepEqual((await h.view('custom-reports', accountant)).reports, [])
  for (const path of doors('custom-reports', saved.id)) await h.view(path, accountant, 404)
  assert.equal((await h.view(`custom-reports/${saved.id}`, h.owner)).can_edit, true)
  saved = await h.command('custom-report.save', { id: saved.id, revision: saved.revision, definition: { ...basic, name: 'Owner reviewed' } })
  assert.equal((await h.view(`custom-reports/${saved.id}`, bookkeeper)).name, 'Owner reviewed')
  await h.command('custom-report.save', { definition: basic }, viewer, 403)
  await h.command('management-package.save', { name: 'Forbidden', reportIds: [saved.id] }, viewer, 403)
  const stale = saved.revision
  saved = await h.command('custom-report.save', { id: saved.id, revision: stale, definition: basic, sharedRoles: ['accountant', 'viewer'] }, bookkeeper)
  await h.command('custom-report.save', { id: saved.id, revision: stale, definition: basic }, bookkeeper, 409)
  for (const cookie of [accountant, viewer]) {
    assert.equal((await h.view('custom-reports', cookie)).reports.length, 1)
    assert.equal((await h.view(`custom-reports/${saved.id}`, cookie)).can_edit, false)
    for (const path of doors('custom-reports', saved.id).filter(path => !path.includes('/figures'))) await h.view(path, cookie)
  }
  await h.command('custom-report.save', { id: saved.id, revision: saved.revision, definition: basic }, accountant, 404)
  const pkg = await h.command('management-package.save', { name: 'October board', cover: 'October results', commentary: ['Read the margins.'], reportIds: [saved.id], sharedRoles: ['accountant', 'viewer'] }, bookkeeper)
  assert.equal((await h.view(`management-packages/${pkg.id}`, accountant)).can_edit, false)
  for (const path of doors('management-packages', pkg.id)) await h.view(path, accountant)
  await h.command('management-package.save', { id: pkg.id, revision: pkg.revision, name: 'No editing', reportIds: [saved.id] }, accountant, 404)
  await h.command('custom-report.save', { id: saved.id, revision: saved.revision, definition: basic, sharedRoles: [] }, bookkeeper)
  for (const path of doors('custom-reports', saved.id)) await h.view(path, accountant, 404)
  assert.deepEqual((await h.view('custom-reports', accountant)).reports, [])
  for (const suffix of ['/render', '/export.pdf', '/export.csv', '/export.json']) await h.view(`management-packages/${pkg.id}${suffix}`, accountant, 404)
  await h.command('management-package.save', { name: 'Cannot borrow package authority', reportIds: [saved.id] }, accountant, 404)
  // An existing package still belongs to its creator and the owner.
  for (const cookie of [bookkeeper, h.owner]) assert.equal((await h.view(`management-packages/${pkg.id}/render`, cookie)).reports.length, 1)
  saved = await h.view(`custom-reports/${saved.id}`, bookkeeper)
  saved = await h.command('custom-report.save', { id: saved.id, revision: saved.revision, definition: basic, sharedRoles: ['accountant'] }, bookkeeper)
  await h.command('member.save', { email: 'accountant@example.test', name: 'Accountant', role: 'bookkeeper' })
  for (const path of doors('custom-reports', saved.id)) await h.view(path, accountant, 404)
  assert.deepEqual((await h.view('custom-reports', accountant)).reports, [])
})

test('REPORT-005 / REPORT-006 / REPORT-007 saved P&L filters, gross margin and ratio tie to books; ordered PDF carries cover, commentary, formulas, shares and each basis', async t => {
  const h = await harness(); t.after(() => h.close())
  const { acct } = await books(h)
  const customer = await h.command('contact.save', { kind: 'customer', name: 'Cedar Studio' })
  const vendor = await h.command('contact.save', { kind: 'vendor', name: 'Brightline Software' })
  const invoice = await h.command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-05', lines: [{ description: 'Design', quantity: '1', rate: '1000.00', accountId: acct['4000'], taxCode: 'exempt' }] })
  await h.command('invoice.approve', { id: invoice.id, revision: invoice.revision })
  await h.command('invoice.issue', { id: invoice.id })
  await h.command('bill.save', { vendorId: vendor.id, reference: 'BL-October', billDate: '2026-10-10', post: true, lines: [{ description: 'Production cost', accountId: acct['6200'], amount: '400.00' }] })
  const definition = { ...basic, name: 'Accrual margins', basis: 'accrual', comparison: 'single', columns: ['name', 'amount', 'share'],
    filters: { accountIds: [acct['4000'], acct['6200']] }, grouping: 'section', notes: ['Margins before rent and tax.', '=1+1, "not a formula"\nRetained note.'], layout: [
      { id: 'revenue', kind: 'section', label: 'Revenue', accountIds: [acct['4000']] },
      { id: 'cost', kind: 'section', label: 'Cost of sales', accountIds: [acct['6200']] },
      { id: 'gross', kind: 'formula', label: 'Gross profit', expression: 'row("revenue") - row("cost")', unit: 'money' },
      { id: 'margin', kind: 'formula', label: 'Gross margin', expression: 'row("gross") / row("revenue") * 100', unit: 'percent' },
      { id: 'ratio', kind: 'formula', label: 'Cost ratio', expression: 'row("cost") / row("revenue")', unit: 'ratio' },
      { id: 'third', kind: 'formula', label: 'One third', expression: 'row("revenue") / 3', unit: 'money' },
      { id: 'tripled', kind: 'formula', label: 'Exact tripled amount', expression: 'row("third") * 3', unit: 'money' },
      { id: 'half-cent', kind: 'formula', label: 'Positive half cent', expression: 'row("revenue") / 200000', unit: 'money' },
      { id: 'negative-half', kind: 'formula', label: 'Negative half cent', expression: '-row("revenue") / 200000', unit: 'money' },
      { id: 'account-reference', kind: 'formula', label: 'Margin from accounts', expression: `(account("${acct['4000']}") - account("${acct['6200']}")) / account("${acct['4000']}") * 100`, unit: 'percent' },
      { id: 'note', kind: 'note', text: 'Production cost only.' },
    ] }
  const accountant = await h.member('reader@example.test', 'accountant')
  const saved = await h.command('custom-report.save', { definition, sharedRoles: ['accountant'] })
  assert.deepEqual(saved.definition, definition)
  const rendered = await h.view(`custom-reports/${saved.id}/render`, accountant)
  const value = id => rendered.report.rows.find(row => row.id === id).values.amount
  const native = await h.view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=accrual', accountant)
  assert.deepEqual([value('revenue'), value('cost'), value('gross'), value('margin'), value('ratio')], [native.totalIncome, native.totalExpenses, native.netIncome, 60, 0.4])
  assert.deepEqual(['revenue', 'cost', 'gross'].map(id => rendered.report.rows.find(row => row.id === id).values.share), [71.43, 28.57, 42.86], 'shares use the filtered native source absolute amounts')
  assert.deepEqual([value('third'), value('tripled'), value('half-cent'), value('negative-half')], [33333, 100000, 1, -1], 'round only the published values and preserve exact references')
  assert.equal(value('account-reference'), 60, 'account references, parentheses and row references agree')
  assert.deepEqual([rendered.report.basis, rendered.report.from, rendered.report.to], ['accrual', definition.from, definition.to])
  assert.deepEqual(rendered.report.columns.map(c => c.id), definition.columns)
  assert.equal(rendered.report.rows.find(row => row.id === 'note').text, 'Production cost only.')
  const followFigure = async (path, seen = new Set()) => {
    assert.equal(seen.has(path), false, 'operand graph is acyclic')
    const next = new Set([...seen, path]), figure = await h.view(path.replace(/^\/api\/pantry\//, ''), accountant)
    assert.equal(figure.basis, 'accrual')
    assert.ok(figure.to)
    const exportPath = path.replace(/^\/api\/pantry\//, '').replace('/figures?', '/figures/export?')
    assert.deepEqual(await h.view(`${exportPath}&format=json`, accountant), figure, 'every formula, derived value and operand exports its actual explanation')
    const exported = await h.send(`/api/pantry/${exportPath}&format=csv`, undefined, { cookie: accountant })
    if (figure.rows) {
      assert.equal(exported.status, 200)
      const cells = exported.value.trim().split('\r\n').map(line => [...line.matchAll(/"((?:[^"]|"")*)"(?:,|$)/g)].map(m => m[1].replaceAll('""', '"')))
      assert.equal(cells.slice(1).reduce((sum, row) => sum + Number(row[5]), 0), figure.value)
      assert.equal(JSON.parse(cells[1][11]).reportId, figure.context.reportId)
      assert.deepEqual(JSON.parse(cells[1][11]).filters, figure.context.filters)
    } else {
      assert.equal(exported.status, 400, 'derived operands are not misrepresented as additive source rows')
      assert.match(exported.value.error, /JSON with its operands/)
    }
    if (figure.rows) {
      assert.equal(figure.ties, true, `${figure.label} source lines tie`)
      assert.equal(figure.rows.reduce((total, row) => total + row.amount, 0), figure.value)
      for (const row of figure.rows) {
        const record = await h.view(`reports/record/${row.record.kind}/${row.record.id}`, accountant)
        assert.ok(record.title)
      }
    }
    for (const operand of figure.operands) {
      const detail = await followFigure(operand.href, next)
      assert.deepEqual([detail.value, detail.unit, detail.basis, detail.from, detail.to], [operand.value, operand.unit, operand.basis, operand.from, operand.to])
    }
    return figure
  }
  for (const row of rendered.report.rows.filter(row => row.kind !== 'note')) for (const column of rendered.report.columns.filter(column => column.unit !== 'text')) {
    const detail = await followFigure(`custom-reports/${saved.id}/figures?${new URLSearchParams({ row: row.id, column: column.id })}`)
    assert.equal(detail.value, row.values[column.id], `${row.name} ${column.label} explains the displayed figure`)
  }
  const noAuth = await h.send(`/api/pantry/custom-reports/${saved.id}/figures/export?row=margin&column=amount&format=json`)
  assert.equal(noAuth.status, 401)
  const marginFigure = await h.view(`custom-reports/${saved.id}/figures?row=margin&column=amount`, accountant)
  assert.equal(marginFigure.expression, definition.layout.find(row => row.id === 'margin').expression)
  assert.deepEqual(marginFigure.operands.map(operand => [operand.label, operand.value]), [['Gross profit', 60000], ['Revenue', 100000]])
  await h.view(`custom-reports/${saved.id}/figures?row=margin&column=amount&node=not-reachable`, accountant, 404)
  const defaultDefinition = { ...definition, name: 'Declared cash margins' }; delete defaultDefinition.basis
  const cash = await h.command('custom-report.save', { definition: defaultDefinition, sharedRoles: ['accountant'] })
  const cashRendered = await h.view(`custom-reports/${cash.id}/render`, accountant)
  assert.equal(cashRendered.report.basis, 'cash')
  assert.deepEqual(cashRendered.report.rows.filter(row => ['revenue', 'cost', 'gross', 'margin', 'ratio'].includes(row.id)).map(row => row.values.amount), [0, 0, 0, null, null])
  const undefinedFigure = await h.view(`custom-reports/${cash.id}/figures?row=margin&column=amount`, accountant)
  assert.equal(undefinedFigure.value, null)
  assert.deepEqual(undefinedFigure.operands.map(row => row.value), [0, 0])
  const exported = await h.view(`custom-reports/${saved.id}/export.json`, accountant)
  assert.deepEqual(exported.definition, definition)
  assert.deepEqual(exported.shared_roles, ['accountant'])
  const pkg = await h.command('management-package.save', { name: 'October management package', cover: 'October board review', commentary: ['Cash receipts remain outstanding.'], reportIds: [cash.id, saved.id], sharedRoles: ['accountant'] })
  const packageRendered = await h.view(`management-packages/${pkg.id}/render`, accountant)
  assert.deepEqual(packageRendered.reports.map(row => row.saved.id), [cash.id, saved.id])
  const json = await h.view(`management-packages/${pkg.id}/export.json`, accountant)
  assert.deepEqual(json.shared_roles, ['accountant'])
  assert.deepEqual(json.reports.map(row => row.definition.layout), [definition.layout, definition.layout])
  const readCsv = async path => {
    const response = await h.send('/api/pantry/' + path + '/export.csv', undefined, { cookie: accountant })
    assert.equal(response.status, 200)
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8')
    assert.equal(response.headers.get('cache-control'), 'no-store')
    const cells = [...response.value.matchAll(/"((?:[^"]|"")*)"(?=,|\r\n|$)/g)].map(m => m[1].replaceAll('""', '"'))
    const rows = []; for (let i = 15; i < cells.length; i += 15) rows.push(cells.slice(i, i + 15))
    return rows
  }
  const csv = await readCsv(`custom-reports/${saved.id}`)
  const figure = (name, column = rendered.report.columns.find(c => c.id === 'amount').label) => csv.find(row => row[7] === name && row[9] === column)
  assert.deepEqual(figure('Gross profit').slice(12, 14), ['USD', '600.00'])
  assert.deepEqual(figure('Gross margin').slice(12, 14), ['percent', '60.00'])
  assert.deepEqual(figure('Cost ratio').slice(12, 14), ['ratio', '0.40'])
  assert.ok(csv.some(row => row[14] === "'=1+1, \"not a formula\"\nRetained note."))
  const all = await readCsv(`management-packages/${pkg.id}`)
  assert.deepEqual([...new Set(all.filter(row => row[1]).map(row => [row[1], row[2]].join(':')))], ['1:Declared cash margins', '2:Accrual margins'])
  assert.ok(all.some(row => row[4] === 'Cash basis' && row[7] === 'Gross margin' && row[13] === 'undefined'))
  assert.ok(all.some(row => row[4] === 'Accrual basis' && row[7] === 'Gross profit' && row[13] === '600.00'))
  assert.ok(all.filter(row => row[7] === 'Gross profit').every(row => row[5] === '2026-10-01' && row[6] === '2026-10-31'))
  assert.ok(all.some(row => row[8] === 'commentary' && row[14] === 'Cash receipts remain outstanding.'))
  const pdf = await h.send(`/api/pantry/management-packages/${pkg.id}/export.pdf`, undefined, { cookie: accountant })
  assert.equal(pdf.status, 200)
  assert.equal(pdf.headers.get('content-type'), 'application/pdf')
  for (const phrase of ['October board review', 'Cash receipts remain outstanding.', 'Cash basis', 'Accrual basis', '$1,000.00', '$400.00', '$600.00', '60.00%', '0.40 ratio', 'undefined', 'Production cost only.', 'Margins before rent and tax.', 'Formula Gross profit:', 'Sharing: accountant']) assert.ok(pdf.value.includes(phrase), `PDF contains ${phrase}`)
  const single = await h.send(`/api/pantry/custom-reports/${saved.id}/export.pdf`, undefined, { cookie: accountant })
  assert.equal(single.status, 200)
  for (const phrase of ['$600.00', 'Formula Gross profit:', 'Sharing: accountant']) assert.ok(single.value.includes(phrase))
  const compared = await h.command('custom-report.save', { definition: { ...basic, name: 'Compared columns', columns: undefined, basis: 'accrual', comparison: 'prior-period', allColumns: true }, sharedRoles: ['accountant'] })
  const comparison = (await h.view(`custom-reports/${compared.id}/render`, accountant)).report
  assert.deepEqual(comparison.columns.map(c => c.id), ['code', 'name', 'amount', 'current', 'prior', 'change', 'percent', 'share'])
  const comparedCsv = await readCsv(`custom-reports/${compared.id}`)
  assert.ok(comparedCsv.some(c => c[9] === comparison.columns.find(c => c.id === 'prior').label && c[10] && c[11]))
  for (const row of comparison.rows.filter(row => row.kind !== 'note')) for (const column of comparison.columns.filter(column => column.unit !== 'text')) {
    const detail = await followFigure(`custom-reports/${compared.id}/figures?${new URLSearchParams({ row: row.id, column: column.id })}`)
    assert.equal(detail.value, row.values[column.id])
  }
  for (const source of ['balance-sheet', 'trial-balance', 'sales-by-customer', 'expenses-by-vendor']) {
    const definition = { ...basic, source, basis: 'accrual', columns: ['name', 'amount', 'share'], ...(source === 'sales-by-customer' ? { filters: { contactIds: [customer.id] } } : source === 'expenses-by-vendor' ? { filters: { contactIds: [vendor.id] } } : {}) }
    const saved = await h.command('custom-report.save', { definition, sharedRoles: ['accountant'] })
    const rendered = (await h.view(`custom-reports/${saved.id}/render`, accountant)).report
    assert.ok(rendered.rows.length > 0)
    const csv = await readCsv(`custom-reports/${saved.id}`)
    for (const row of rendered.rows) assert.ok(csv.some(c => c[7] === row.name && c[12] === 'USD' && c[13] === (row.values.amount / 100).toFixed(2)))
    if (source === 'sales-by-customer') assert.deepEqual(rendered.rows.map(row => row.values.amount), [100000])
    if (source === 'expenses-by-vendor') assert.deepEqual(rendered.rows.map(row => row.values.amount), [40000])
    if (source === 'trial-balance') assert.equal(rendered.rows.reduce((total, row) => total + row.values.amount, 0), 0)
    for (const row of rendered.rows) for (const column of rendered.columns.filter(column => column.unit !== 'text')) {
      const detail = await followFigure(`custom-reports/${saved.id}/figures?${new URLSearchParams({ row: row.id, column: column.id })}`)
      assert.equal(detail.value, row.values[column.id])
    }
  }
  for (const comparison of ['prior-year', 'months', 'quarters', 'ytd', 'customer']) {
    const saved = await h.command('custom-report.save', { definition: { ...basic, basis: 'accrual', comparison, allColumns: true, columns: undefined, filters: { accountIds: [acct['4000']] }, grouping: comparison === 'customer' ? 'customer' : 'account' }, sharedRoles: ['accountant'] })
    const rendered = (await h.view(`custom-reports/${saved.id}/render`, accountant)).report
    assert.equal(rendered.rows.reduce((sum, row) => sum + row.values.amount, 0), 100000)
    for (const row of rendered.rows) for (const column of rendered.columns.filter(column => column.unit !== 'text')) {
      const detail = await followFigure(`custom-reports/${saved.id}/figures?${new URLSearchParams({ row: row.id, column: column.id })}`)
      assert.equal(detail.value, row.values[column.id])
    }
  }
  await h.command('custom-report.save', { definition: { ...definition, layout: [{ id: 'unsafe', kind: 'formula', label: 'Unsafe', expression: 'process.exit()', unit: 'money' }] } }, h.owner, 400)
})
