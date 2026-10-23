import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
import { standingScenario } from '../api/standing-journey.mjs'
export async function standingJourney(t){
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 for(const width of [1440,390]){
  const app=await worker(),context=await browser.newContext({viewport:{width,height:1000}})
  try{
   await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic owner'},maxRedirects:0});await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
   const command=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()},view=async path=>{const r=await context.request.get(app.origin+'/api/pantry/'+path);assert.equal(r.status(),200);return r.json()}
   const {rule,bank}=await standingScenario({command,view},{lines:10,grant:false}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
   await page.goto(app.origin+'/app/questions')
   const panel=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Books-agent permissions',exact:true})})
   await panel.getByLabel('Permission name',{exact:true}).fill('Reviewed recurring charges');await panel.getByLabel('Reviewed suggest-only rule',{exact:true}).selectOption(rule.id);await panel.getByLabel('Permission bank account',{exact:true}).selectOption(bank.id);await panel.getByLabel('Exact bank payee text',{exact:true}).fill('Synthetic permitted');await panel.getByLabel('Maximum automatic amount',{exact:true}).fill('15.00');await panel.getByRole('checkbox').check();await panel.getByRole('button',{name:'Grant this standing permission',exact:true}).click()
   await panel.getByRole('button',{name:'Run permitted work now',exact:true}).click();await panel.getByText(/5 actions · 0 undone · 0 reviewed/).waitFor()
   await panel.getByRole('button',{name:'Correct',exact:true}).first().click();await panel.getByText(/Review accuracy: 1\/1 correct \(100%\)/).waitFor()
   await panel.getByRole('button',{name:'Undo sampled action',exact:true}).first().click();await panel.getByText(/5 actions · 1 undone/).waitFor()
   await panel.getByRole('button',{name:'Revoke Reviewed recurring charges',exact:true}).click();await panel.getByText(/Revoked · synthetic permitted/).waitFor()
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('button').evaluateAll(buttons=>buttons.filter(b=>!b.textContent.trim()).length),0)
   if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await panel.getByRole('heading',{name:'Reviewed recurring charges',exact:true}).scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/standing-${width}.png`})}
   await page.goto(app.origin+'/app/bank');await page.getByText('Books agent · Reviewed recurring charges',{exact:true}).first().waitFor();assert.equal(await page.getByText('Books agent · Reviewed recurring charges',{exact:true}).count(),4);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
   if(process.env.PANTRY_PROOF_DIR)await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/standing-bank-${width}.png`})
   assert.deepEqual(errors,[])
  }finally{await context.close();await app.close()}
 }
}
