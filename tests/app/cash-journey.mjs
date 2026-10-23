import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
export async function cashJourney(t){
 const app=await worker();t.after(()=>app.close())
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const context=await browser.newContext()
 await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic studio owner'},maxRedirects:0})
 await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
 const cmd=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 await cmd('entity.save',{legalName:'Synthetic pantry studio',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:''});await cmd('chart.start',{})
 const state=await(await context.request.get(app.origin+'/api/pantry/state')).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 await cmd('bank-account.save',{name:'Operating checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'10000.00'})
 const customer=await cmd('contact.save',{kind:'customer',name:'Cedar Studio',termsDays:30})
 const invoice=await cmd('invoice.save-draft',{customerId:customer.id,issueDate:'2027-03-01',lines:[{description:'Brand consultation',quantity:'1',rate:'1234.56',accountId:acct['4000'],taxCode:'exempt'}]});await cmd('invoice.approve',{id:invoice.id,revision:invoice.revision});await cmd('invoice.issue',{id:invoice.id})
 for(const width of [1440,390]){
  const page=await context.newPage();await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(app.origin+'/app/cash-planner?asOf=2027-03-01')
  await page.getByRole('heading',{name:'Opening cash · $10,000.00',exact:true}).waitFor()
  assert.equal(await page.getByRole('heading',{name:'13-week projection',exact:true}).count(),1)
  await page.getByLabel('Scenario item',{exact:true}).fill('New equipment')
  await page.getByLabel('Scenario amount',{exact:true}).fill('-15000.00')
  await page.getByRole('button',{name:'Add what-if item',exact:true}).click()
  await page.getByRole('alert').getByText('Projected cash below $0.00',{exact:true}).waitFor()
  await page.getByText('New equipment',{exact:true}).waitFor()
  const link=page.getByRole('link',{name:`Invoice ${invoice.number} · Cedar Studio`,exact:true});await link.waitFor();await link.click()
  await page.getByRole('heading',{name:'Transaction record',exact:true}).waitFor()
  await page.getByText('Brand consultation',{exact:true}).waitFor()
  await page.goBack();await page.getByRole('heading',{name:'13-week projection',exact:true}).waitFor()
  const exported=await context.request.get(await page.getByRole('link',{name:'Export projection JSON'}).getAttribute('href').then(h=>app.origin+h));assert.equal(exported.status(),200);assert.equal((await exported.json()).weeks.length,13)
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
  assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0)
  assert.deepEqual(errors,[])
  if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/cash-${width}.png`,fullPage:true})}
  await page.close()
 }
 await context.close()
}
