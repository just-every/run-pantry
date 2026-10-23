import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
export async function assetsJourney(t){
 const app=await worker();t.after(()=>app.close());const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext();await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic studio owner'},maxRedirects:0});await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
 const cmd=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 await cmd('entity.save',{legalName:'Synthetic pantry studio',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2025-01-01',policies:''});await cmd('chart.start',{})
 const state=await(await context.request.get(app.origin+'/api/pantry/state')).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 const contra=await cmd('account.save',{code:'1590',name:'Accumulated vehicle depreciation',type:'asset',subtype:'other'}),expense=await cmd('account.save',{code:'6900',name:'Book depreciation',type:'expense',subtype:'other'}),vendor=await cmd('contact.save',{kind:'vendor',name:'Synthetic vehicle supplier'})
 for(const width of [1440,390]){
  await cmd('bill.save',{vendorId:vendor.id,reference:'synthetic-pantry-'+width,billDate:'2025-01-01',post:true,evidenceWaived:'Accountant reviewed source',lines:[{description:'Vehicle '+width,accountId:acct['6200'],amount:'7200.00'}]})
  const page=await context.newPage();await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(app.origin+'/app/assets')
  await page.getByLabel('Capitalize bill lines over',{exact:true}).fill('2500.00')
  await page.getByLabel('Election tax year',{exact:true}).fill('2025')
  await page.getByRole('button',{name:'Save capitalization policy',exact:true}).click()
  const proposal=page.locator('details').filter({has:page.locator('summary',{hasText:'Vehicle '+width})}).first();await proposal.locator('summary').click()
  await proposal.getByLabel('Fixed asset account',{exact:true}).selectOption(acct['1500']);await proposal.getByLabel('Accumulated depreciation account',{exact:true}).selectOption(contra.id);await proposal.getByLabel('Depreciation expense account',{exact:true}).selectOption(expense.id)
  await proposal.getByRole('button',{name:'Approve and capitalize this source line',exact:true}).click()
  const asset=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Vehicle '+width,exact:true})})
  await asset.waitFor();await asset.getByRole('button',{name:'Prepare next monthly journals',exact:true}).click()
  for(let month=1;month<=12;month++){const day=new Date(Date.UTC(2025,month,0)).toISOString().slice(0,10);await asset.getByRole('button',{name:'Approve '+day,exact:true}).click();await asset.getByRole('button',{name:'Approve '+day,exact:true}).waitFor({state:'detached'})}
  await asset.getByRole('button',{name:'Run approved depreciation due now',exact:true}).click()
  await asset.getByText('$7,200.00 accumulated book depreciation · $0.00 remaining book value.',{exact:true}).waitFor()
  await asset.locator('summary',{hasText:'Accountant tax schedule'}).click();await asset.getByLabel('Section 179 amount',{exact:true}).fill('7200.00');await asset.getByLabel('Accountant election note',{exact:true}).fill('Accountant selected Section 179 for the tax package only');await asset.getByRole('button',{name:'Record tax election',exact:true}).click()
  await asset.locator('summary',{hasText:'Dispose of this asset'}).click();await asset.getByLabel('Disposal date',{exact:true}).fill('2026-01-01');await asset.getByLabel('Disposal proceeds',{exact:true}).fill('4000.00');await asset.getByLabel('Proceeds bank ledger account',{exact:true}).selectOption(acct['1000']);await asset.getByLabel('Gain income account',{exact:true}).selectOption(acct['4000']);await asset.getByLabel('Loss expense account',{exact:true}).selectOption(expense.id);await asset.getByRole('button',{name:'Approve and record disposal',exact:true}).click()
  await asset.getByText(/Disposed 2026-01-01/).waitFor()
  await asset.scrollIntoViewIfNeeded()
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0);assert.deepEqual(errors,[])
  if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/assets-${width}.png`})}
  await asset.getByRole('link',{name:'Disposal entry',exact:true}).click();await page.getByText('Dispose Vehicle '+width,{exact:true}).waitFor()
  await page.close()
 }
 await context.close()
}
