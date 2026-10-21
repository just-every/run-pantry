// Synthetic OOXML export with shared strings and compressed entries, as emitted
// by spreadsheet software. It is a file fixture, not a replacement app/parser.
export async function spreadsheetWorkbook(rows, formulas = {}) {
  const { deflateRawSync } = await import('node:zlib')
  const escape = s => String(s).replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;')
  const strings = [...new Set(rows.flat().map(String))], index = new Map(strings.map((s, i) => [s, i]))
  const files = {
    '[Content_Types].xml': '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/contacts.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/></Types>',
    '_rels/.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>',
    'xl/workbook.xml': '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Vendors" sheetId="1" r:id="rId1"/></sheets></workbook>',
    'xl/_rels/workbook.xml.rels': '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/contacts.xml"/></Relationships>',
    'xl/sharedStrings.xml': `<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${rows.flat().length}" uniqueCount="${strings.length}">${strings.map(s => `<si><t>${escape(s)}</t></si>`).join('')}</sst>`,
    'xl/worksheets/contacts.xml': `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rows.map((r, i) => `<row r="${i + 1}">${r.map((v, j) => { const ref = `${String.fromCharCode(65 + j)}${i + 1}`; return `<c r="${ref}" t="s">${formulas[ref] ? `<f>${escape(formulas[ref])}</f>` : ''}<v>${index.get(String(v))}</v></c>` }).join('')}</row>`).join('')}</sheetData></worksheet>`,
  }
  const local = [], central = []; let offset = 0
  const crc32 = bytes => { let crc = 0xffffffff; for (const byte of bytes) { crc ^= byte; for (let b = 0; b < 8; b++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0) } return (crc ^ 0xffffffff) >>> 0 }
  for (const [path, text] of Object.entries(files)) {
    const name = Buffer.from(path), bytes = Buffer.from(text), compressed = deflateRawSync(bytes), crc = crc32(bytes)
    const header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(20, 4); header.writeUInt16LE(8, 8); header.writeUInt32LE(crc, 14); header.writeUInt32LE(compressed.length, 18); header.writeUInt32LE(bytes.length, 22); header.writeUInt16LE(name.length, 26)
    local.push(header, name, compressed)
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50); entry.writeUInt16LE(20, 4); entry.writeUInt16LE(20, 6); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(crc, 16); entry.writeUInt32LE(compressed.length, 20); entry.writeUInt32LE(bytes.length, 24); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42)
    central.push(entry, name); offset += header.length + name.length + compressed.length
  }
  const directory = Buffer.concat(central), end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...local, directory, end]).toString('base64')
}

export async function spreadsheetPackage() {
  const csv = (headers, rows) => [headers, ...rows].map(r => r.map(v => /[",\r\n]/.test(String(v)) ? `"${String(v).replaceAll('"', '""')}"` : v).join(',')).join('\r\n')
  const file = (key, headers, rows) => ({ name: `${key}.csv`, content: csv(headers, rows) })
  const chart = [['ar', 'Accounts receivable', '1100', 'asset', 'receivable'], ['ap', 'Accounts payable', '2100', 'liability', 'payable'], ['equity', 'Opening equity', '3000', 'equity', 'retained'], ['income', 'Consulting income', '4000', 'income', 'other'], ...Array.from({ length: 36 }, (_, n) => [`cost-${n}`, `Expense ${n}`, `${6000 + n}`, 'expense', 'other'])]
  return { source: 'spreadsheet', cutoverDate: '2026-08-31', files: {
    accounts: file('accounts', ['externalId', 'name', 'code', 'type', 'subtype'], chart.map((r, n) => [`synthetic-pantry-${n}`, ...r.slice(1)])),
    customers: file('customers', ['client_key', 'Client label', 'Mail box', 'Days credit'], [...Array.from({ length: 200 }, (_, n) => [`synthetic-pantry-${n}`, `Customer ${n}`, `customer${n}@example.test`, '30']), ['synthetic-pantry-200', 'Customer 1', 'other@example.test', '30']]),
    vendors: { name: 'vendors.xlsx', base64: await spreadsheetWorkbook([['Vendor key', 'Trading name', 'Email address'], ...Array.from({ length: 10 }, (_, n) => [`synthetic-pantry-${n}`, n === 0 ? 'Vendor & Café' : `Vendor ${n}`, `vendor${n}@example.test`])]) },
    items: file('items', ['externalId', 'name', 'account', 'rate', 'taxDecision'], [['synthetic-pantry-1', 'Consulting', 'Consulting income', '150.00', 'non-taxable'], ['synthetic-pantry-2', 'Unknown account item', 'Missing income', '5.00', 'non-taxable'], ['synthetic-pantry-3', 'Undecided tax item', 'Consulting income', '5.00', '']]),
    openInvoices: file('invoices', ['externalId', 'number', 'party', 'date', 'due', 'open', 'account', 'taxDecision'], Array.from({ length: 25 }, (_, n) => [`synthetic-pantry-${n}`, `INV-${n}`, `Customer ${n}`, '2026-08-01', '2026-08-31', '100.00', 'Accounts receivable', 'included'])),
    unpaidBills: file('bills', ['externalId', 'number', 'party', 'date', 'open', 'account', 'taxDecision'], Array.from({ length: 10 }, (_, n) => [`synthetic-pantry-${n}`, `BILL-${n}`, n === 0 ? 'Vendor & Café' : `Vendor ${n}`, '2026-08-01', '100.00', 'Accounts payable', 'included'])),
    trialBalance: file('opening', ['account', 'debit', 'credit'], [['Accounts receivable', '2500.00', '0'], ['Accounts payable', '0', '1000.00'], ['Opening equity', '0', '1500.00']]),
  } }
}


/** Run on the built app via the parent's test registration. It exercises real
 * uploads/mapping/preview/import/undo/reimport/sign-off at both clause widths. */
export async function moveInJourney(t) {
  const { default: assert } = await import('node:assert/strict')
  const { mkdir } = await import('node:fs/promises')
  const { chromium } = await import('@playwright/test')
  const { worker, TOKEN } = await import('./worker.mjs')
  const dir = process.env.PANTRY_SCREENSHOTS ?? '/tmp/sx-pantry-c30'
  await mkdir(dir, { recursive: true })
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  for (const width of [1440, 390]) {
    const app = await worker(); let appOpen = true
    const closeApp = async () => { if (appOpen) { appOpen = false; await app.close() } }; t.after(closeApp)
    const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } }); t.after(() => context.close())
    const page = await context.newPage(), errors = []; page.on('pageerror', e => errors.push(String(e)))
    assert.equal((await context.request.post(app.origin + '/auth/bootstrap', { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Synthetic Pantry Owner' }, maxRedirects: 0 })).status(), 303)
    assert.equal((await context.request.post(app.origin + '/setup', { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })).status(), 303)
    const cmd = async (op, data) => { const r = await context.request.post(app.origin + '/api/pantry/command/' + op, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
    const view = async path => { const r = await context.request.get(app.origin + '/api/pantry/' + path); assert.equal(r.status(), 200, await r.text()); return r.json() }
    await cmd('entity.save', { legalName: 'Synthetic Pantry', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'accrual', booksStart: '2026-09-01' })
    await page.goto(app.origin + '/app/move-in')
    await page.getByRole('tab', { name: 'Spreadsheet', exact: true }).click()
    await page.getByLabel('Spreadsheet cutover date').fill('2026-08-31')
    const pkg = await spreadsheetPackage()
    const labels = { customers: 'Customers', vendors: 'Vendors', items: 'Items', accounts: 'Chart of accounts', openInvoices: 'Open invoices', unpaidBills: 'Open bills', trialBalance: 'Opening trial balance' }
    for (const [key, file] of Object.entries(pkg.files)) {
      await page.getByLabel(labels[key] + ' spreadsheet', { exact: true }).setInputFiles({ name: file.name, mimeType: file.base64 ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' : 'text/csv', buffer: file.base64 ? Buffer.from(file.base64, 'base64') : Buffer.from(file.content) })
      await page.getByText(new RegExp(`data rows · ${file.name.replace('.', '\\.')}$`)).waitFor()
    }
    for (const [key, mapping] of Object.entries({ customers: { externalId: 'client_key', name: 'Client label', email: 'Mail box', termsDays: 'Days credit' }, vendors: { externalId: 'Vendor key', name: 'Trading name', email: 'Email address' } })) {
      await page.getByText(`Map ${labels[key].toLowerCase()} columns`, { exact: true }).click()
      for (const [field, header] of Object.entries(mapping)) await page.getByLabel(`${labels[key]}: ${field}`, { exact: true }).selectOption(header)
      await page.getByRole('button', { name: `Save ${labels[key].toLowerCase()} mapping`, exact: true }).click()
      assert.deepEqual((await view('move-in')).spreadsheetMappings[key], mapping)
    }
    const customerCard = page.getByRole('heading', { name: 'Customers', exact: true }).locator('../..')
    await customerCard.screenshot({ path: `${dir}/move-in-mapping-${width}.png` })
    const download = page.waitForEvent('download'); await customerCard.getByRole('button', { name: 'Download template', exact: true }).click(); assert.match((await download).suggestedFilename(), /\.csv$/)
    await page.getByRole('button', { name: 'Preview spreadsheets', exact: true }).click()
    await page.getByRole('heading', { name: 'Spreadsheet dry run', exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Refused spreadsheet rows (3)', exact: true }).waitFor()
    const refusalCard = page.getByRole('heading', { name: 'Refused spreadsheet rows (3)', exact: true }).locator('../..')
    for (const reason of [/Duplicate name/, /Unknown account/, /Missing tax decision/]) await refusalCard.getByText(reason).waitFor()
    await refusalCard.screenshot({ path: `${dir}/move-in-refusals-${width}.png` })
    await page.getByRole('heading', { name: 'Spreadsheet tie-outs', exact: true }).locator('../..').screenshot({ path: `${dir}/move-in-ties-${width}.png` })
    await page.getByRole('heading', { name: 'Every row (292)', exact: true }).waitFor()
    await page.getByRole('button', { name: 'Next rows', exact: true }).click()
    await page.getByText('26–50 of 292', { exact: true }).waitFor()
    await page.getByLabel('Show spreadsheet rows').selectOption('refused')
    await page.getByRole('heading', { name: 'Every row (292)', exact: true }).locator('../..').screenshot({ path: `${dir}/move-in-rows-${width}.png` })
    await page.getByLabel('Leave the 3 refused rows out of this import', { exact: true }).check()
    await page.getByRole('button', { name: 'Import spreadsheet records as staged', exact: true }).click()
    await page.getByRole('heading', { name: 'Cutover from Spreadsheet', exact: true }).waitFor({ timeout: 180000 })
    // A cutover is written last; wait for the completed job so undo is offered.
    await page.getByRole('button', { name: 'Undo import', exact: true }).waitFor({ timeout: 180000 })
    const firstCustomer = (await view('state')).contacts.find(c => c.name === 'Customer 0')
    assert.equal((await view('state')).contacts.length, 210)
    await page.getByRole('button', { name: 'Undo import', exact: true }).click()
    await page.getByRole('heading', { name: 'Cutover from Spreadsheet', exact: true }).waitFor({ state: 'detached', timeout: 180000 })
    assert.equal((await view('state')).contacts.length, 0)
    const changed = pkg.files.customers.content.replace('customer0@example.test', 'changed@example.test')
    await page.getByLabel('Customers spreadsheet', { exact: true }).setInputFiles({ name: 'customers.csv', mimeType: 'text/csv', buffer: Buffer.from(changed) })
    await page.getByText('201 data rows · customers.csv', { exact: true }).waitFor()
    await page.getByRole('button', { name: 'Preview spreadsheets', exact: true }).click()
    await page.getByRole('heading', { name: 'Refused spreadsheet rows (3)', exact: true }).waitFor()
    await page.getByLabel('Leave the 3 refused rows out of this import', { exact: true }).check()
    await page.getByRole('button', { name: 'Import spreadsheet records as staged', exact: true }).click()
    await page.getByRole('button', { name: 'Undo import', exact: true }).waitFor({ timeout: 180000 })
    const again = await view('state'); assert.equal(again.contacts.length, 210); assert.equal(again.contacts.find(c => c.id === firstCustomer.id).email, 'changed@example.test')
    await page.getByRole('heading', { name: 'Cutover from Spreadsheet', exact: true }).locator('../..').screenshot({ path: `${dir}/move-in-staged-${width}.png` })
    await page.getByRole('button', { name: 'Accountant sign-off', exact: true }).click()
    await page.getByText('Signed off', { exact: true }).waitFor()
    await page.getByRole('heading', { name: 'Cutover from Spreadsheet', exact: true }).locator('../..').screenshot({ path: `${dir}/move-in-signed-${width}.png` })
    assert.deepEqual([(await view('reports/receivables?to=2026-08-31')).agrees, (await view('reports/payables?to=2026-08-31')).agrees], [true, true])
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true)
    assert.deepEqual(errors, [])
    await context.close(); await closeApp()
  }
}
