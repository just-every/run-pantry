import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
import { collectionsScenario } from '../api/collections-journey.mjs'
export async function collectionsJourney(t){
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 for(const width of [1440,390]){
  const app=await worker(),context=await browser.newContext({viewport:{width,height:1000}})
  try{
   await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic owner'},maxRedirects:0});await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
   const command=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()},view=async path=>{const r=await context.request.get(app.origin+'/api/pantry/'+path);assert.equal(r.status(),200);return r.json()}
   const {bank,invoices}=await collectionsScenario({command,view}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
   await page.goto(app.origin+'/app/collections');await page.getByRole('button',{name:'Prepare overdue drafts',exact:true}).click()
   for(let n=0;n<2;n++){
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name:`${invoices[n].number} · Synthetic customer ${n}`,exact:true})})
    await card.getByLabel('Collection message',{exact:true}).fill('A friendly follow-up on our invoice. Please confirm your payment date. Thank you.')
    await card.getByRole('button',{name:'Save collection draft',exact:true}).click();await card.getByRole('button',{name:'Approve this exact draft',exact:true}).click();await card.getByRole('button',{name:'Send approved draft',exact:true}).click();await card.getByText('suppressed',{exact:true}).waitFor()
   }
   const promised=page.locator('section.card').filter({has:page.getByRole('heading',{name:`${invoices[2].number} · Synthetic customer 2`,exact:true})})
   await promised.locator('summary',{hasText:'Record a reply or stop chasing'}).click();await promised.getByLabel('Collection decision',{exact:true}).selectOption('promise')
   const today=(await view('collections')).today,fri=new Date(today+'T12:00:00Z');fri.setUTCDate(fri.getUTCDate()+(5-fri.getUTCDay()+7)%7)
   await promised.getByLabel('Promised payment date',{exact:true}).fill(fri.toISOString().slice(0,10));await promised.getByLabel('Customer reply or owner reason',{exact:true}).fill('Customer replied: payment Friday');await promised.getByRole('button',{name:'Record collection decision',exact:true}).click();await promised.getByText(/Paused through/).waitFor()
   await command('payment.record',{direction:'received',contactId:invoices[3].customer_id,date:today,amount:'100',bankAccountId:bank.id,allocations:[{targetId:invoices[3].id,amount:'100'}]})
   await page.reload();const paid=page.locator('section.card').filter({has:page.getByRole('heading',{name:`${invoices[3].number} · Synthetic customer 3`,exact:true})});await paid.getByText(/\$0.00 currently open · paid/).waitFor();assert.equal(await paid.getByRole('button',{name:'Send approved draft',exact:true}).count(),0)
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0);assert.deepEqual(errors,[])
   if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});const card=page.locator('section.card').filter({has:page.getByRole('heading',{name:`${invoices[2].number} · Synthetic customer 2`,exact:true})});await card.locator('.card-head').scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/collections-${width}.png`})}
  }finally{await context.close();await app.close()}
 }
}
