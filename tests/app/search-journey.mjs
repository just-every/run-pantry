import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
export async function searchJourney(t) {
 const app=await worker();t.after(()=>app.close())
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext()
 assert.equal((await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'synthetic-pantry-1'},maxRedirects:0})).status(),303)
 await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
 const cmd=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 await cmd('entity.save',{legalName:'Synthetic pantry studio',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:''})
 await cmd('chart.start',{})
 const state=await(await context.request.get(app.origin+'/api/pantry/state')).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 const customer=await cmd('contact.save',{kind:'customer',name:'Cedar Studio'})
 const invoice=await cmd('invoice.save-draft',{customerId:customer.id,issueDate:'2026-03-01',lines:[{description:'Brand consultation',quantity:'1',rate:'1234.56',accountId:acct['4000'],taxCode:'exempt'}]})
 const vendor=await cmd('contact.save',{kind:'vendor',name:'Pine Supplies'})
 const bank=await cmd('bank-account.save',{name:'Operating checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0'})
 const settings=await cmd('check.settings',{bankAccountId:bank.id,nextNumber:1047,stock:'voucher',positivePay:{name:'Synthetic format',account:'synthetic-pantry-2',columns:['number','amount','date','status'].map(field=>({field,header:field})),header:true,delimiter:',',dateFormat:'YYYY-MM-DD',amountFormat:'decimal',issueCode:'I',voidCode:'V'}})
 await cmd('check.issue',{bankAccountId:bank.id,revision:settings.revision,date:'2026-03-20',items:[{kind:'expense',contactId:vendor.id,amount:'25.00',accountId:acct['6200'],description:'Office supplies',memo:'Printer paper'}]})
 for(const width of [1440,390]) {
  const page=await context.newPage();await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(app.origin+'/app')
  await page.getByRole('search').getByLabel('Find a transaction').fill('$1,234.56')
  await page.getByRole('search').getByRole('button',{name:'Search',exact:true}).click()
  await page.getByRole('link',{name:invoice.number,exact:true}).waitFor()
  await page.getByRole('link',{name:invoice.number,exact:true}).click()
  await page.getByRole('heading',{name:'Transaction record',exact:true}).waitFor()
  await page.getByText('Brand consultation',{exact:true}).waitFor()
  await page.goto(app.origin+'/app/search?q=1047&type=check')
  await page.getByRole('link',{name:'1047',exact:true}).waitFor()
  await page.getByRole('link',{name:'1047',exact:true}).click()
  await page.getByText('Printer paper',{exact:true}).waitFor()
  await page.goto(app.origin+'/app/search?min=1200&max=1300')
  await page.getByRole('link',{name:invoice.number,exact:true}).waitFor()
  assert.ok(await page.getByLabel('Minimum amount',{exact:true}).isVisible())
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  // All controls on these screens are text-labelled; the shell's icons are
  // accompanied by their navigation words at both widths.
  assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0)
  assert.deepEqual(errors,[])
  if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/search-${width}.png`,fullPage:true})}
  await page.close()
 }
 await context.close()
}
