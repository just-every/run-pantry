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
