import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { worker,TOKEN } from './worker.mjs'
import { archiveScenario } from '../api/archive-journey.mjs'
export async function archiveJourney(t){const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 for(const width of [1440,390]){const app=await worker(),context=await browser.newContext({viewport:{width,height:1000}});try{
 await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic owner'},maxRedirects:0});await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
 const command=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()},view=async path=>{const r=await context.request.get(app.origin+'/api/pantry/'+path);assert.equal(r.status(),200);return r.json()}, {batch,bill}=await archiveScenario({command,view}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
 await page.goto(app.origin+'/app/move-in');const manifest={...batch,files:batch.files.map(({base64,...f})=>f)}
 await page.getByLabel('Archive manifest',{exact:true}).setInputFiles({name:'synthetic-pantry-50.json',mimeType:'application/json',buffer:Buffer.from(JSON.stringify(manifest))})
 await page.getByLabel('Extracted original files',{exact:true}).setInputFiles(batch.files.map(f=>({name:f.name,mimeType:f.mediaType,buffer:Buffer.from(f.base64,'base64')})))
 await page.getByRole('button',{name:'Preview archive batch',exact:true}).click();await page.getByRole('button',{name:'Import reviewed originals',exact:true}).click()
 const queue=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Unlinked archive originals',exact:true})});await queue.getByLabel('Transaction type',{exact:true}).selectOption('bill');await queue.getByLabel('Pantry transaction ID',{exact:true}).fill(bill.id);await queue.getByRole('button',{name:'Place original',exact:true}).click();await queue.getByText('Every imported original is placed.',{exact:true}).waitFor()
 const journal=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Archive move-in journal',exact:true})});await journal.getByText('hubdoc · synthetic-pantry-20',{exact:true}).waitFor();assert.equal((await view('document-archives')).files.length,2)
 assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.equal(await page.locator('button').evaluateAll(bs=>bs.filter(b=>!b.textContent.trim()).length),0);assert.deepEqual(errors,[])
 if(process.env.PANTRY_PROOF_DIR){await mkdir(process.env.PANTRY_PROOF_DIR,{recursive:true});await journal.scrollIntoViewIfNeeded();await page.screenshot({path:`${process.env.PANTRY_PROOF_DIR}/archives-${width}.png`})}
 }finally{await context.close();await app.close()}}
}
