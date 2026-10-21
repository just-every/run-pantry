import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { worker, TOKEN } from './worker.mjs'
import { september, importStatements, matchSeptember, closeReady } from '../api/scenario.mjs'

const choices = [
  ['Receivables summary','receivables-summary'],['Payables summary','payables-summary'],['Open invoices','open-invoices'],['Unpaid bills','unpaid-bills'],
  ['Customer balances','customer-balances'],['Vendor balances','vendor-balances'],['Transactions','transactions'],['Journal','journal'],['Deposits','deposits'],
  ['Check detail','check-detail'],['Reconciliation reports','reconciliations'],['Audit log','audit-log'],['1099 summary','contractor-summary'],
]

test('REPORT-004 run the everyday library, filter journal, open records and download the same reports at 1440 and 390', async t => {
  const app=await worker(); t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']}); t.after(()=>browser.close())
  const owner=await browser.newContext()
  assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`,{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})).status(),303)
  await owner.request.post(`${app.origin}/setup`,{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
  const command=async(op,data)=>{const r=await owner.request.post(`${app.origin}/api/pantry/command/${op}`,{headers:{origin:app.origin},data});assert.equal(r.status(),200,`${op}: ${await r.text()}`);return r.json()}
  const view=async(path)=>{const r=await owner.request.get(`${app.origin}/api/pantry/${path}`);assert.equal(r.status(),200,await r.text());return r.json()}
  const h={command,view}, s=await september(h), st=await importStatements(h,s)
  await matchSeptember(h,s,st); await closeReady(h,s,st)
  await command('bill.save',{vendorId:s.c['Brightline Software'].id,reference:'BL-SEPT-UNPAID',billDate:'2026-09-28',post:true,lines:[{description:'Additional seats',accountId:s.acct['6200'],amount:'125.00'}]})
  await command('contractor.save',{contactId:s.c['Harbor Office Rentals'].id,is1099:true})
  await command('payment.set-method',{id:s.paid.harbor.id,method:'check'})
  const storageState=await owner.storageState(), money=n=>new Intl.NumberFormat('en-US',{style:'currency',currency:'USD'}).format(n/100)
  const today=new Date().toISOString().slice(0,10)
  for(const width of [1440,390]){
    const context=await browser.newContext({storageState,viewport:{width,height:width===390?844:1000}}), page=await context.newPage(), errors=[]
    page.on('pageerror',e=>errors.push(String(e)))
    for(const [label,kind] of choices){
      const from=kind==='audit-log'?today:'2026-09-01', to=kind==='audit-log'?today:'2026-09-30'
      await page.goto(`${app.origin}/app/reports?report=${kind}&from=${from}&to=${to}&basis=accrual`)
      if(width===390)assert.equal(await page.getByLabel('Report',{exact:true}).inputValue(),label)
      else await page.getByRole('tab',{name:label,exact:true}).waitFor()
      const r=await view(`reports/${kind}?from=${from}&to=${to}&basis=accrual`)
      const table=page.getByRole('table',{name:r.title,exact:true})
      await table.waitFor();assert.ok(r.rows.length>0,kind)
      for(const row of r.rows.slice(0,2))for(const [index,value]of row.cells.entries()){
        if(value==='')continue
        const expected=r.moneyColumns.includes(index)?money(value):String(value)
        assert.ok((await table.innerText()).includes(expected),`${width} ${kind} ${expected}`)
      }
      for(const total of r.totals)await page.getByRole('row').filter({has:page.getByText(total.label,{exact:true})}).getByText(money(total.amount),{exact:true}).waitFor()
      const pdf=page.getByRole('link',{name:/^Download PDF/}), csv=page.getByRole('link',{name:/^Download CSV/})
      for(const [link,format]of [[pdf,'pdf'],[csv,'csv']]){
        const href=await link.getAttribute('href'), response=await context.request.get(new URL(href,app.origin).href)
        assert.equal(response.status(),200);assert.equal(response.headers()['x-pantry-basis'],r.basisLabel)
        if(format==='csv')assert.ok((await response.text()).includes(r.columns[0]));else assert.equal((await response.body()).subarray(0,5).toString(),'%PDF-')
      }
      if(kind==='open-invoices'){ const [download]=await Promise.all([page.waitForEvent('download'),csv.click()]); assert.equal(await download.failure(),null) }
      if(kind==='reconciliations'){
        const evidence=table.locator('details').first();await evidence.locator('summary').click();await evidence.locator('pre').waitFor();assert.ok((await evidence.innerText()).includes('owner@example.test'))
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${width} ${kind} fits`)
      for(const control of await page.locator('.report-library input, .report-library select').all()){const box=await control.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width,`${width} ${kind} control fits`)}
      await page.screenshot({path:`/tmp/pantry-r14-${kind}-${width}.png`,fullPage:true})
    }
    await page.goto(`${app.origin}/app/reports?report=journal&from=2026-09-01&to=2026-09-30&basis=accrual`)
    await page.getByLabel('Account filter',{exact:true}).selectOption(s.acct['6200'])
    await page.getByLabel('Payee filter',{exact:true}).selectOption(s.c['Brightline Software'].id)
    const filtered=page.getByRole('table',{name:'Journal',exact:true});await filtered.getByText('BL-SEPT-UNPAID',{exact:false}).first().waitFor()
    assert.equal(new URL(page.url()).searchParams.get('payee'),s.c['Brightline Software'].id)
    const csv=page.getByRole('link',{name:/^Download CSV/})
    assert.equal(new URL(await csv.getAttribute('href'),app.origin).searchParams.get('account'),s.acct['6200'])
    await page.screenshot({path:`/tmp/pantry-r14-journal-filter-${width}.png`,fullPage:true})
    await filtered.getByRole('link',{name:'View record',exact:true}).last().click()
    await page.getByRole('heading',{name:/Journal entry/}).first().waitFor()
    assert.equal(new URL(page.url()).searchParams.get('payee'),s.c['Brightline Software'].id)
    await page.screenshot({path:`/tmp/pantry-r14-record-${width}.png`,fullPage:true})
    await page.goBack();await page.getByRole('radio',{name:'Cash',exact:true}).click()
    await page.getByRole('table',{name:'Journal',exact:true}).waitFor()
    await page.getByRole('link',{name:'Download CSV · cash',exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.screenshot({path:`/tmp/pantry-r14-journal-cash-${width}.png`,fullPage:true})
    assert.deepEqual(errors,[]);await context.close()
  }
})

test('REPORT-005 Software figure to approved bill, PDF, payment and bank; source and record exports preserve report context at 1440 and 390', async t => {
  const { mkdir } = await import('node:fs/promises')
  const evidence = process.env.PANTRY_EVIDENCE_DIR || '/tmp/sx-pantry-r16'
  await mkdir(evidence, { recursive: true })
  const app = await worker(); t.after(() => app.close())
  const browser = await chromium.launch({ headless: true, args: ['--use-mock-keychain', '--password-store=basic'] }); t.after(() => browser.close())
  const owner = await browser.newContext()
  await owner.request.post(`${app.origin}/auth/bootstrap`, { headers: { origin: app.origin }, data: { token: TOKEN, displayName: 'Rosa Rivera' }, maxRedirects: 0 })
  await owner.request.post(`${app.origin}/setup`, { headers: { origin: app.origin }, form: { confirm: 'yes' }, maxRedirects: 0 })
  const command = async (op, data) => { const r = await owner.request.post(`${app.origin}/api/pantry/command/${op}`, { headers: { origin: app.origin }, data }); assert.equal(r.status(), 200, await r.text()); return r.json() }
  const view = async path => (await owner.request.get(`${app.origin}/api/pantry/${path}`)).json()
  await command('entity.save', { legalName: 'Juniper Lane Design LLC', entityType: 'single-member-llc', state: 'NY', fiscalYearStart: 1, taxMethod: 'cash', booksStart: '2026-01-01' })
  await command('chart.start', {})
  const acct = Object.fromEntries((await view('state')).accounts.map(a => [a.code, a.id]))
  const bank = await command('bank-account.save', { name: 'Operating checking', institution: 'Chase', accountId: acct['1000'], numberLast4: '4821', openingDate: '2026-09-30', openingBalance: '0' })
  const vendor = await command('contact.save', { kind: 'vendor', name: 'Brightline Software', termsDays: 30 })
  const draft = await command('bill.save', { vendorId: vendor.id, reference: 'BL-1042', billDate: '2026-10-02', lines: [{ description: 'October software seats', accountId: acct['6200'], amount: '640.00' }] })
  await command('bill.approve', { id: draft.id, revision: draft.revision, note: 'Reviewed vendor invoice and software seats' })
  const bill = await command('bill.record', { id: draft.id, revision: draft.revision })
  await command('document.upload', { name: 'brightline-bl-1042.pdf', mediaType: 'application/pdf', base64: Buffer.from('%PDF-1.4 Brightline software seats USD 640.00\n').toString('base64'), linkedKind: 'bill', linkedId: bill.id })
  const payment = await command('payment.record', { direction: 'paid', contactId: vendor.id, bankAccountId: bank.id, date: '2026-10-15', amount: '640', method: 'check', reference: '1001', allocations: [{ targetId: bill.id, amount: '640' }] })
  const imported = await command('statement.import', { bankAccountId: bank.id, fileName: 'october.csv', content: 'Date,Description,Amount,Reference\n2026-10-16,CHECK 1001 BRIGHTLINE,-640.00,1001\n', start: '2026-10-01', end: '2026-10-31', opening: '0', closing: '-640', confirmLast4: '4821' })
  const state = await view(`reconciliation/${imported.statement.id}`)
  const paymentEntry = (await view(`reports/record/payment/${payment.id}`)).entries[0]
  if (!state.lines[0].match_id) await command('match.approve', { bankLineIds: [state.lines[0].id], journalLineIds: [state.postings.find(p => p.number === paymentEntry.number).id] })
  // A 1099 vendor, a budget and a taxed open invoice for the 1099, budget, ageing and sales tax doors.
  await command('contractor.save', { contactId: vendor.id, is1099: true })
  await command('budget.save', { name: 'Juniper 2026', startMonth: '2026-01', basis: 'accrual', cells: [{ accountId: acct['6200'], month: '2026-10', amount: '500.00' }] })
  const customer = await command('contact.save', { kind: 'customer', name: 'Cedar Studio', termsDays: 30 })
  const nyc = await command('tax-code.save', { name: 'New York City', rate: '8.875', accountId: acct['2200'], state: 'NY' })
  const invoiceDraft = await command('invoice.save-draft', { customerId: customer.id, issueDate: '2026-10-05', lines: [{ description: 'Website design', quantity: '1', rate: '600.00', accountId: acct['4000'], taxCode: nyc.id }] })
  await command('invoice.approve', { id: invoiceDraft.id, revision: invoiceDraft.revision })
  const invoice = await command('invoice.issue', { id: invoiceDraft.id })
  const storageState = await owner.storageState()
  for (const width of [1440, 390]) {
    const context = await browser.newContext({ storageState, viewport: { width, height: width === 390 ? 844 : 1000 } }), page = await context.newPage(), errors = []
    page.on('pageerror', e => errors.push(String(e)))
    const shot = async name => { assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true); await page.screenshot({ path: `${evidence}/report005-${name}-${width}.png`, fullPage: true }) }
    const params = new URLSearchParams({ report: 'profit-and-loss', from: '2026-10-01', to: '2026-10-31', basis: 'accrual', line: acct['6200'], account: acct['6200'], payee: vendor.id })
    await page.goto(`${app.origin}/app/reports?${params}`)
    await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
    const sourceExport = page.getByRole('link', { name: 'Export source lines CSV', exact: true })
    const csvHref = new URL(await sourceExport.getAttribute('href'), app.origin)
    assert.equal(csvHref.searchParams.get('payee'), vendor.id)
    const csv = await context.request.get(csvHref.href); assert.equal(csv.status(), 200); assert.match(await csv.text(), /64000/)
    await shot('figure')
    await page.getByRole('link', { name: 'Bill BL-1042 · Brightline Software', exact: true }).click()
    await page.getByRole('heading', { name: 'Approvals', exact: true }).waitFor()
    await page.getByText('Reviewed vendor invoice and software seats', { exact: false }).waitFor()
    const approvals = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Approvals', exact: true }) })
    await approvals.locator('summary').first().click()
    assert.ok((await approvals.innerText()).includes(draft.revision))
    const audit = page.locator('.card').filter({ has: page.getByRole('heading', { name: 'Audit history', exact: true }) })
    await audit.locator('summary').first().waitFor()
    await audit.locator('summary').first().click()
    const pdf = page.getByRole('link', { name: 'brightline-bl-1042.pdf', exact: true })
    assert.equal((await context.request.get(new URL(await pdf.getAttribute('href'), app.origin).href)).status(), 200)
    const recordHref = new URL(await page.getByRole('link', { name: 'Export record JSON', exact: true }).getAttribute('href'), app.origin)
    const record = await (await context.request.get(recordHref.href)).json()
    assert.equal(record.context.line, acct['6200']); assert.equal(record.context.payee, vendor.id)
    assert.ok(record.record.approvals.some(a => a.subject_revision === draft.revision)); assert.ok(record.record.audit.some(a => a.action === 'bill.record'))
    await shot('bill')
    await page.getByRole('link', { name: 'Payment to Brightline Software', exact: true }).click()
    await page.getByRole('heading', { name: 'Payment to Brightline Software', exact: true }).waitFor()
    await page.getByText(/CHECK 1001 BRIGHTLINE/).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('line'), acct['6200']); assert.equal(new URL(page.url()).searchParams.get('basis'), 'accrual')
    const paymentExport = await context.request.get(new URL(await page.getByRole('link', { name: 'Export record JSON', exact: true }).getAttribute('href'), app.origin).href)
    assert.equal((await paymentExport.json()).record.bank[0].amount, -64000)
    await shot('payment')
    await page.getByRole('link', { name: 'Back to the figure', exact: true }).click()
    await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
    // New native report amounts are links to exactly the displayed read model.
    const money = cents => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(cents / 100)
    const openFigure = async selection => {
      const links = page.locator('a.figure-link')
      const index = (await links.evaluateAll(nodes => nodes.map(a => { const value = new URL(a.href).searchParams.get('line'); try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : JSON.stringify(parsed) } catch { return value } }))).indexOf(JSON.stringify(selection))
      assert.ok(index >= 0, `visible figure ${JSON.stringify(selection)}`)
      await links.nth(index).click()
      await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
    }
    for (const basis of ['cash', 'accrual']) {
      const tb = await view(`reports/trial-balance?to=2026-10-31&basis=${basis}`)
      const query = new URLSearchParams({ report: 'trial-balance', from: '2026-10-01', to: '2026-10-31', basis })
      await page.goto(`${app.origin}/app/reports?${query}`)
      await page.locator('a.figure-link').first().waitFor(); await shot(`trial-${basis}`)
      await openFigure(['total', 'debit'])
      const totalCsv = await context.request.get(new URL(await page.getByRole('link', { name: 'Export source lines CSV', exact: true }).getAttribute('href'), app.origin).href)
      assert.equal(totalCsv.status(), 200); assert.ok((await totalCsv.text()).includes(`"${tb.debit}"`))
      await shot(`trial-total-${basis}`)
      const gl = await view(`reports/general-ledger?from=2026-10-01&to=2026-10-31&basis=${basis}&account=${acct['6200']}`)
      const a = gl.accounts[0], row = a.rows[0]
      const ledger = new URLSearchParams({ report: 'general-ledger', from: '2026-10-01', to: '2026-10-31', basis, account: a.id })
      for (const [selection, expected] of [[[a.id, 'opening'], a.opening], [[a.id, 'debit', row.id], row.debit_cents], [[a.id, 'running', row.id], row.running], [[a.id, 'closing'], a.closing]]) {
        await page.goto(`${app.origin}/app/reports?${ledger}`)
        await page.locator('a.figure-link').first().waitFor()
        assert.equal(await page.locator('.gl-account').count(), 1, 'native account filter applies to the table')
        if (selection[1] === 'opening') {
          const download = new URL(await page.getByRole('link', { name: /^Download CSV/ }).getAttribute('href'), app.origin)
          assert.equal(download.searchParams.get('account'), a.id)
          assert.equal((await context.request.get(download.href)).status(), 200)
          await shot(`ledger-${basis}`)
        }
        await openFigure(selection)
        await page.locator('.figure-total').getByText(money(expected), { exact: true }).waitFor()
        const href = new URL(await page.getByRole('link', { name: 'Export source lines CSV', exact: true }).getAttribute('href'), app.origin)
        assert.equal(href.searchParams.get('account'), a.id)
        assert.equal((await context.request.get(href.href)).status(), 200)
        await shot(`ledger-${basis}-${selection[1]}`)
        if (selection[1] === 'debit') {
          await page.getByRole('link', { name: 'Bill BL-1042 · Brightline Software', exact: true }).first().click()
          await page.getByRole('heading', { name: 'Approvals', exact: true }).waitFor()
          assert.equal(new URL(page.url()).searchParams.get('account'), a.id)
          await shot(`ledger-record-${basis}`)
          await page.getByRole('link', { name: 'Back to the figure', exact: true }).click()
          await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
        }
      }
    }
    await page.goto(`${app.origin}/app/reports?report=cash-flow&from=2026-10-01&to=2026-10-31&basis=cash`)
    await page.getByRole('link', { name: 'Net cash from operating activities', exact: true }).waitFor(); await shot('cash-flow')
    await page.getByRole('link', { name: 'Net cash from operating activities', exact: true }).click()
    const cashExport = new URL(await page.getByRole('link', { name: 'Export source lines CSV', exact: true }).getAttribute('href'), app.origin)
    const cashCsv = await context.request.get(cashExport.href)
    assert.equal(cashCsv.status(), 200); assert.equal(cashCsv.headers()['x-pantry-basis'], 'Indirect method - accrual starting income')
    await shot('cash-flow-detail')
    await page.getByRole('link', { name: 'Bill BL-1042 · Brightline Software', exact: true }).first().click()
    await page.getByRole('heading', { name: 'Approvals', exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('report'), 'cash-flow')
    await shot('cash-flow-record')
    for (const [line, date] of [['opening', 'Sep 30, 2026'], ['closing', 'Oct 31, 2026']]) {
      await page.goto(`${app.origin}/app/reports?report=cash-flow&from=2026-10-01&to=2026-10-31&basis=cash&line=${line}`)
      await page.getByText(`All posted cash activity through ${date}`, { exact: false }).waitFor()
      await shot(`cash-flow-${line}`)
    }
    // Grouped spend, comparison columns and a derived change % open the same way.
    await page.goto(`${app.origin}/app/reports?report=expenses-by-vendor&from=2026-10-01&to=2026-10-31&basis=accrual`)
    await page.locator('a.figure-link').first().waitFor(); await shot('expenses-by-vendor')
    const lines = await page.locator('a.figure-link').evaluateAll(nodes => nodes.map(a => new URL(a.href).searchParams.get('line')))
    await page.locator('a.figure-link').nth(lines.indexOf(vendor.id)).click()
    await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
    await page.locator('.figure-total').getByText(money(64000), { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Bill BL-1042 · Brightline Software', exact: true }).first().waitFor()
    await shot('expenses-by-vendor-figure')
    await page.goto(`${app.origin}/app/reports?report=profit-and-loss&from=2026-10-01&to=2026-10-31&basis=accrual&columns=prior-period`)
    const software = page.getByRole('row').filter({ has: page.getByRole('rowheader', { name: /Software/ }) })
    await software.locator('a.figure-link').nth(2).click()
    await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
    assert.equal(new URL(page.url()).searchParams.get('column'), 'change'); assert.equal(new URL(page.url()).searchParams.get('columns'), 'prior-period')
    await page.locator('.figure-total').getByText(money(64000), { exact: true }).waitFor()
    await shot('comparison-change')
    await page.goBack()
    await software.locator('a.figure-link').nth(3).click()
    await page.getByText('Recalculates to the report figure', { exact: true }).waitFor()
    await page.getByRole('link', { name: 'Prior', exact: true }).waitFor()
    await shot('comparison-percent')
    // 1099, budget, ageing, sales tax and library figures open the same way.
    const opens = async (address, line, name, expected) => {
      await page.goto(`${app.origin}/app/reports?${address}`)
      await page.locator('a.figure-link').first().waitFor()
      // The router quotes JSON-shaped strings in the address; compare the decoded selection.
      const found = await page.locator('a.figure-link').evaluateAll(nodes => nodes.map(a => { const value = new URL(a.href).searchParams.get('line'); try { const parsed = JSON.parse(value); return typeof parsed === 'string' ? parsed : JSON.stringify(parsed) } catch { return value } }))
      assert.ok(found.includes(line), `${name} figure ${line}`)
      await page.locator('a.figure-link').nth(found.indexOf(line)).click()
      await page.getByText('Adds up to the report figure', { exact: true }).waitFor()
      await page.locator('.figure-total').getByText(money(expected), { exact: true }).waitFor()
      await shot(name)
    }
    await opens('report=contractors&year=2026', JSON.stringify([vendor.id, 'box1']), 'contractors-box1', 64000)
    await page.getByRole('link', { name: 'Payment to Brightline Software', exact: true }).first().waitFor()
    await opens('report=budget-actual&from=2026-10-01&to=2026-10-31&basis=accrual', JSON.stringify([acct['6200'], 'variance']), 'budget-variance', 14000)
    await opens('report=receivables&to=2026-10-31', JSON.stringify(['item', invoice.id]), 'receivables-item', 65325)
    await opens('report=sales-tax&from=2026-10-01&to=2026-10-31&basis=accrual', JSON.stringify(['code', nyc.id, 'charged']), 'sales-tax-charged', 5325)
    await page.getByRole('link', { name: `Invoice ${invoice.number} · Cedar Studio`, exact: true }).first().waitFor()
    await opens('report=check-detail&from=2026-10-01&to=2026-10-31&basis=accrual', JSON.stringify([payment.id, '6']), 'check-detail-amount', 64000)
    assert.deepEqual(errors, []); await context.close()
  }
})
