import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
import { learningScenario } from '../api/learning-journey.mjs'
export async function learningJourney(t){
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 for(const width of [1440,390]){
  const app=await worker(),context=await browser.newContext({viewport:{width,height:1000}})
  try{
   await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic owner'},maxRedirects:0});await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
   const command=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()},view=async path=>{const r=await context.request.get(app.origin+'/api/pantry/'+path);assert.equal(r.status(),200);return r.json()}
   const {expense,proposal}=await learningScenario({command,view}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
   await page.goto(app.origin+'/app/questions')
   const panel=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Repeated resolutions',exact:true})})
   await panel.getByRole('heading',{name:'Synthetic Insurance · 3-month prepaid proposal',exact:true}).waitFor()
   await panel.getByLabel('Recognition expense account',{exact:true}).selectOption(expense.id);await panel.getByLabel('Back-test through',{exact:true}).fill('2026-10-01');await panel.getByRole('button',{name:'Back-test prior year',exact:true}).click()
   await panel.getByText('2026-01',{exact:true}).waitFor();assert.equal(await panel.getByText('$400.00',{exact:true}).count(),18)
   await panel.getByLabel('Maximum funding amount',{exact:true}).fill('1200.00');await panel.getByRole('button',{name:'Approve this vendor and materiality',exact:true}).click()
   await panel.getByLabel('Reviewed funding source',{exact:true}).selectOption(proposal.sources[0].id);await panel.getByRole('button',{name:'Prepare source-funded plan',exact:true}).click();await panel.getByText('Human posting approval required',{exact:true}).waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0)
   if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await panel.locator('h3').scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/learning-${width}.png`})}
   await panel.getByRole('link',{name:'Review source-funded plan',exact:true}).click()
   await page.getByRole('heading',{name:'Learned Synthetic Insurance · 2026-01-01',exact:true}).waitFor()
   await page.getByRole('button',{name:'Approve this schedule revision',exact:true}).click()
   await page.getByText(/this revision approved by/).waitFor();assert.deepEqual(errors,[])
  }finally{await context.close();await app.close()}
 }
}
