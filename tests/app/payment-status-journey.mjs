import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {providerWorker} from './provider-worker.mjs'
import {TOKEN} from './worker.mjs'
import {paymentEventsJourney} from '../api/payment-events-journey.mjs'

export async function paymentStatusBrowser(t) {
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const context=await browser.newContext()
  const scene=await paymentEventsJourney(t,async config=>{
    const mail=[]
    const app=await providerWorker({clock:true,bindings:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-pantry-1013',MAIL_FROM:'Pantry <pantry@example.test>',SESSION_SECRET:'local-test-secret-not-production-0123456789'},outbound:async request=>{
      if(new URL(request.url).hostname==='api.resend.com'){mail.push(await request.json());return Response.json({id:`synthetic-pantry-mail-${mail.length}`})}
      return config.outbound(request)
    }})
    const send=async(path,body,{raw,headers={},method}={})=>{
      const response=await context.request.fetch(app.origin+path,{method:method??(body===undefined&&raw===undefined?'GET':'POST'),headers:{origin:app.origin,...(!path.startsWith('/auth/')?{'x-synthetic-pantry-clock':config.clock}:{}),'content-type':'application/json',...headers},...(raw!==undefined?{data:raw}:body!==undefined?{data:body}:{}),maxRedirects:0})
      const text=await response.text();let value;try{value=JSON.parse(text)}catch{value=text}
      return {status:response.status(),value,headers:new Headers(response.headers())}
    }
    assert.equal((await send('/auth/bootstrap',{token:TOKEN,displayName:'Rosa Rivera'})).status,303)
    await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
    const command=async(op,body,cookie,status=200)=>{const r=await send('/api/pantry/command/'+op,body);assert.equal(r.status,status,`${op}: ${JSON.stringify(r.value)}`);return r.value}
    const view=async path=>{const r=await send('/api/pantry/'+path);assert.equal(r.status,200,JSON.stringify(r.value));return r.value}
    return {...app,send,command,view,mail,owner:'native-browser-session'}
  })
  const {h,customer,card,ach,disputed}=scene
  const storageState=await context.storageState(),proof=process.env.PANTRY_PROOF_DIR
  if(proof)await mkdir(proof,{recursive:true})
  for(const width of [1440,390]) {
    const c=await browser.newContext({storageState,viewport:{width,height:width===390?844:1000},extraHTTPHeaders:{'x-synthetic-pantry-clock':'2026-10-20T12:00:00Z'}})
    const page=await c.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
    for(const [name,item] of [['refund',card],['returned',ach],['disputed',disputed]]) {
      await page.goto(`${h.origin}/app/sales?invoice=${item.invoice.id}`)
      const cardPanel=page.locator('section.card').filter({has:page.getByRole('heading',{name:new RegExp(item.invoice.number)})})
      await cardPanel.locator('summary',{hasText:'Provider payment status'}).click()
      await cardPanel.locator('summary',{hasText:'Payment receipts and notices'}).click()
      if(name==='returned'){
        await cardPanel.getByText(/R01/).waitFor()
        await cardPanel.getByRole('link',{name:'View payment reversal',exact:true}).waitFor()
        await cardPanel.getByText('Payment returned — invoice open again',{exact:true}).first().waitFor()
      }
      if(name==='disputed'){
        await cardPanel.getByText('Disputed',{exact:true}).waitFor()
        await cardPanel.getByText(/Evidence due/).waitFor()
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`)
      if(proof)await page.screenshot({path:`${proof}/provider-${name}-${width}.png`,fullPage:true})
    }
    await page.goto(`${h.origin}/app/sales?tab=contacts&customer=${customer.id}`)
    const preference=page.locator('details').filter({has:page.locator('summary',{hasText:'Payment receipt preference'})})
    await preference.locator('summary').click()
    await preference.getByRole('button',{name:'Turn payment receipts off',exact:true}).click()
    await preference.getByRole('button',{name:'Turn payment receipts on',exact:true}).waitFor()
    if(proof)await page.screenshot({path:`${proof}/payer-preference-${width}.png`,fullPage:true})
    await preference.getByRole('button',{name:'Turn payment receipts on',exact:true}).click()
    await page.goto(`${h.origin}/app/settings`)
    const comparison=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Payment comparison',exact:true})})
    await comparison.getByRole('button',{name:'Compare Stripe payment events',exact:true}).waitFor()
    assert.ok((await comparison.innerText()).includes('complete'))
    await comparison.scrollIntoViewIfNeeded()
    if(proof)await comparison.screenshot({path:`${proof}/payment-comparison-${width}.png`})
    const sending=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Sending invoices and reminders',exact:true})})
    await sending.locator('summary',{hasText:'Payment receipt preference'}).click()
    await sending.getByRole('button',{name:'Turn payment receipts off',exact:true}).click()
    await sending.getByRole('button',{name:'Turn payment receipts on',exact:true}).waitFor()
    if(proof)await sending.screenshot({path:`${proof}/business-receipts-${width}.png`})
    await sending.getByRole('button',{name:'Turn payment receipts on',exact:true}).click()
    assert.deepEqual(errors,[])
    await c.close()
  }
  await context.close()
}
