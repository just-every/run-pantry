import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {providerWorker} from './provider-worker.mjs'
import {TOKEN} from './worker.mjs'

export async function queueBrowser(t){
 const app=await providerWorker({bindings:{},outbound:()=>{throw Error('No outbound action belongs to this review')}});t.after(()=>app.close())
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const evidence=process.env.PANTRY_EVIDENCE_DIR||'/tmp/pantry-queue';await mkdir(evidence,{recursive:true})
 for(const width of [1440,390]){
  const context=await browser.newContext({viewport:{width,height:1000}});t.after(()=>context.close())
  const origin=app.origin,request=context.request
  if(width===1440){
   assert.equal((await request.post(origin+'/auth/bootstrap',{headers:{origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})).status(),303)
   await request.post(origin+'/setup',{headers:{origin},form:{confirm:'yes'},maxRedirects:0})
  }else await context.addCookies(await browser.contexts()[0].cookies())
  const command=async(op,data)=>{const r=await request.post(origin+'/api/pantry/command/'+op,{headers:{origin},data});assert.equal(r.status(),200,`${op}: ${await r.text()}`);return r.json()}
  const view=async path=>{const r=await request.get(origin+'/api/pantry/'+path);assert.equal(r.status(),200,await r.text());return r.json()}
  if(width===1440){await command('entity.save',{legalName:'Juniper Review Studio LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'accrual',booksStart:'2026-01-01'});await command('chart.start',{})}
  const accounts=Object.fromEntries((await view('state')).accounts.map(a=>[a.code,a.id])),month=width===1440?'10':'11',day=`2026-${month}-15`
  const cardLedger=await command('account.save',{code:width===1440?'2111':'2112',name:`Review card ${width}`,type:'liability',subtype:'bank'})
  const bank=await command('bank-account.save',{name:`Review checking ${width}`,institution:'Local',accountId:width===1440?accounts['1000']:(await command('account.save',{code:'1011',name:'Mobile checking',type:'asset',subtype:'bank'})).id,numberLast4:'3131',openingDate:'2026-01-01',openingBalance:'0'})
  const card=await command('bank-account.save',{name:`Review business card ${width}`,institution:'Local card',accountId:cardLedger.id,numberLast4:'3132',openingDate:'2026-01-01',openingBalance:'0'})
  const vendor=await command('contact.save',{kind:'vendor',name:`Review Stationer ${width}`,defaultAccountId:accounts['6200']})
  const customer=await command('contact.save',{kind:'customer',name:`Review Customer ${width}`})
  const tax=await command('tax-code.save',{name:`Review tax ${width}`,rate:'10',accountId:accounts['2200']})
  const d=await command('invoice.save-draft',{customerId:customer.id,issueDate:day,lines:[{description:'Reviewed services',quantity:'1',rate:'1000',accountId:accounts['4000'],taxCode:'exempt'}]})
  const approved=await command('invoice.approve',{id:d.id,revision:d.revision}),invoice=await command('invoice.issue',{id:approved.id})
  const amounts=[-6000,-20000,-500,100000,...Array.from({length:46},(_,i)=>-1000-i)]
  const descriptions=[`Split purchase ${width}`,`synthetic-pantry-${width}-card`,`Personal purchase ${width}`,`Customer collection ${width}`,...Array(46).fill(vendor.name)]
  await command('statement.import',{bankAccountId:bank.id,fileName:`synthetic-pantry-${width}.csv`,content:'Posting Date,Description,Amount\n'+amounts.map((n,i)=>`${month}/15/2026,${descriptions[i]},${(n/100).toFixed(2)}`).join('\n'),opening:'0',closing:(amounts.reduce((a,b)=>a+b,0)/100).toFixed(2),start:day,end:day,confirmLast4:'3131'})
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
  await page.goto(origin+'/app/bank')
  await page.getByLabel('Account',{exact:true}).selectOption(bank.id)
  await page.getByRole('heading',{name:'Transactions',exact:true}).click()
  await page.keyboard.press('j');await page.keyboard.press('x')
  await expect(page.getByRole('heading',{name:'Review 1 selected line',exact:true})).toBeVisible()
  await page.keyboard.press('Escape');await expect(page.getByRole('heading',{name:'Review 1 selected line',exact:true})).toHaveCount(0)
  const row=description=>page.getByRole('row').filter({hasText:description}).filter({has:page.locator('td[data-label="Description"]')})
  const choose=async description=>{await row(description).getByRole('button',{name:'File it',exact:true}).click();await expect(page.getByRole('heading',{name:'Match review',exact:true})).toBeVisible()}
  const panel=page.locator('.match-panel')
  await choose(descriptions[0])
  for(const [i,amount,account] of [[0,'33','6100'],[1,'17','6200'],[2,'10','6300']]){
   await panel.getByRole('button',{name:'+ Expense or fee',exact:true}).click()
   const item=panel.locator('.new-item').nth(i)
   await item.getByLabel('Amount',{exact:true}).fill(amount);await item.getByLabel('Account',{exact:true}).selectOption(accounts[account])
   if(i===0){await item.getByLabel('Sales tax included',{exact:true}).selectOption(tax.id);await item.getByLabel('Payee',{exact:true}).selectOption(vendor.id);await item.getByLabel('Memo',{exact:true}).fill('Reviewed three-way purchase');await item.getByLabel('Class',{exact:true}).fill('Studio');await item.getByLabel('Location',{exact:true}).fill('Albany');await item.getByLabel('Project',{exact:true}).fill('Cedar')}
  }
  await panel.screenshot({path:`${evidence}/queue-split-${width}.png`})
  await panel.getByRole('button',{name:'Approve match',exact:true}).click();await expect(panel).toHaveCount(0)
  await choose(descriptions[1]);await panel.getByRole('button',{name:'+ Transfer',exact:true}).click();await panel.getByLabel('Other bank account',{exact:true}).selectOption(card.id)
  await panel.screenshot({path:`${evidence}/queue-card-${width}.png`});await panel.getByRole('button',{name:'Approve match',exact:true}).click();await expect(panel).toHaveCount(0)
  await choose(descriptions[2]);await page.getByLabel('Exclusion reason',{exact:true}).fill('Personal purchase reviewed by the owner');await page.getByRole('button',{name:'Exclude selected line',exact:true}).click();await expect(panel).toHaveCount(0)
  await page.getByLabel('Show',{exact:true}).selectOption('Excluded');await expect(row(descriptions[2]).getByText('Personal purchase reviewed by the owner',{exact:false})).toBeVisible();await page.screenshot({path:`${evidence}/queue-excluded-${width}.png`,fullPage:true});await page.getByLabel('Show',{exact:true}).selectOption('All')
  await choose(descriptions[3]);await panel.getByRole('button',{name:'+ Customer payment',exact:true}).click();await panel.getByLabel('Customer',{exact:true}).selectOption(customer.id)
  await panel.getByRole('button',{name:'Approve match',exact:true}).click();await expect(panel).toHaveCount(0)
  assert.equal((await view('sales')).invoices.find(i=>i.id===invoice.id).open_cents,0)
  const bulk=async count=>{
   const boxes=page.getByRole('checkbox',{name:new RegExp(`^Select ${vendor.name}`)})
   for(let i=0;i<count;i++)await boxes.nth(i).check()
   await page.getByRole('button',{name:'Review selected suggestions',exact:true}).click()
   const heading=page.getByRole('heading',{name:`Review ${count} selected lines`,exact:true});await expect(heading).toBeVisible()
   await page.getByLabel('I reviewed every displayed category and amount.',{exact:true}).check()
   await heading.locator('..').screenshot({path:`${evidence}/queue-bulk-${count}-${width}.png`})
   await page.getByRole('button',{name:'Accept selected suggestions',exact:true}).click();await expect(heading).toHaveCount(0)
  }
  await bulk(20);await bulk(26)
  const queued=(await view('bank/lines')).lines.filter(l=>l.bank_account_id===bank.id)
  assert.equal(queued.length,50);assert.equal(queued.filter(l=>l.match_id).length,49);assert.equal(queued.filter(l=>l.excluded_at).length,1)
  const one=row(vendor.name).first();await one.getByRole('button',{name:'Undo',exact:true}).click();await expect(one.getByRole('button',{name:'File it',exact:true})).toBeVisible()
  const after=(await view('bank/lines')).lines.filter(l=>l.bank_account_id===bank.id)
  assert.equal(after.filter(l=>l.match_id).length,48);assert.equal(after.filter(l=>!l.match_id&&!l.excluded_at).length,1)
  assert.equal((await view(`reports/trial-balance?to=${day}&basis=accrual`)).balanced,true)
  await page.getByLabel('Show',{exact:true}).selectOption('To file');await page.screenshot({path:`${evidence}/queue-after-undo-${width}.png`,fullPage:true})
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`queue fits ${width}`)
  assert.deepEqual(errors,[])
  await page.close()
 }
}
