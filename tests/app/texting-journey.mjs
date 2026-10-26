import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'
import { twilioSignature } from '../api/texting-journey.mjs'

export async function textingBrowser(t) {
 let texts=0,mail=0
 const app=await providerWorker({clock:true,bindings:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-pantry-30'},outbound:async request=>{
  if(new URL(request.url).hostname==='api.resend.com'){mail++;return Response.json({id:`synthetic-pantry-${mail+30}`})}
  assert.equal(new URL(request.url).hostname,'api.twilio.com')
  const form=new URLSearchParams(await request.text());assert.equal(form.get('From'),'+15005550006');assert.equal(form.get('To'),'+15005550006')
  return Response.json({sid:`synthetic-pantry-${++texts+40}`,status:'queued'})
 }})
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']})
 const clock={'x-synthetic-pantry-clock':'2026-10-20T14:00:00Z'}
 const owner=await browser.newContext({extraHTTPHeaders:clock})
 try {
  assert.equal((await owner.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'synthetic-pantry-1'},maxRedirects:0})).status(),303)
  await owner.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
  const command=async(op,data)=>{const r=await owner.request.post(`${app.origin}/api/pantry/command/${op}`,{headers:{origin:app.origin},data});assert.equal(r.status(),200,`${op}: ${await r.text()}`);return r.json()}
  const view=async path=>{const r=await owner.request.get(`${app.origin}/api/pantry/${path}`);assert.equal(r.status(),200,await r.text());return r.json()}
  await command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:''})
  await command('chart.start',{})
  const accountId=(await view('state')).accounts.find(a=>a.code==='4000').id
  const customer=await command('contact.save',{kind:'customer',name:'synthetic-pantry-1',phone:'+15005550006',email:'synthetic-pantry-1@example.test'})
  let inv=await command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-20',dueDate:'2026-10-21',lines:[{description:'synthetic-pantry-1',quantity:'1',rate:'100',accountId,taxCode:'exempt'}]})
  inv=await command('invoice.approve',{id:inv.id,revision:inv.revision});inv=await command('invoice.issue',{id:inv.id});await command('invoice.send',{id:inv.id})
  const storageState=await owner.storageState(),proof=process.env.PANTRY_PROOF_DIR
  if(proof)await mkdir(proof,{recursive:true})
  for(const width of [1440,390]) {
   const context=await browser.newContext({storageState,extraHTTPHeaders:clock,viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[]
   try {
    page.on('pageerror',error=>errors.push(String(error)))
    const submit=async(op,action)=>{const [response]=await Promise.all([page.waitForResponse(r=>r.url().endsWith('/command/'+op)),action()]);assert.equal(response.status(),200,await response.text());return response.json()}
    await page.goto(app.origin+'/app/settings')
    const settings=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Texting',exact:true})})
    await settings.getByLabel('Invoice text template',{exact:true}).waitFor()
    if(width===1440){
     await settings.getByText('Connect Twilio test account',{exact:true}).click()
     await settings.getByLabel('Twilio test account SID',{exact:true}).fill('synthetic-pantry-31')
     await settings.getByLabel('Twilio test auth token',{exact:true}).fill('synthetic-pantry-32')
     await settings.getByRole('checkbox',{name:'These are Twilio test credentials. No real SMS will be sent.',exact:true}).check()
     await submit('texting.connect',()=>settings.getByRole('button',{name:'Connect test account',exact:true}).click())
    }
    await settings.getByRole('checkbox',{name:'Enable consented test texts',exact:true}).check()
    await settings.getByLabel('Business contact for HELP',{exact:true}).fill('synthetic-pantry-1 support: synthetic-pantry-1@example.test')
    await settings.getByLabel('Text reminder days',{exact:true}).fill('0, 7')
    await settings.getByRole('checkbox',{name:'I approve these exact templates and reminder days for the consented purposes.',exact:true}).check()
    await submit('texting.settings',()=>settings.getByRole('button',{name:'Approve text settings',exact:true}).click())
    await settings.getByText('Test texting enabled',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Text settings fit ${width}`)
    if(proof)await settings.screenshot({path:`${proof}/texting-settings-${width}.png`})
    await page.goto(`${app.origin}/app/sales?tab=contacts&customer=${customer.id}`)
    const consent=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Customer text consent',exact:true})})
    await consent.getByLabel('Consented mobile number',{exact:true}).fill('+15005550006')
    await consent.getByLabel('Customer time zone',{exact:true}).fill('America/New_York')
    await consent.getByLabel('Consent source',{exact:true}).fill('synthetic-pantry-1 signed form')
    await consent.getByLabel('Exact consent wording',{exact:true}).fill('I consent to invoice links and reminders. Reply STOP to stop.')
    await consent.getByLabel('Consent given at',{exact:true}).fill('2026-10-19T10:00')
    await submit('texting.consent',()=>consent.getByRole('button',{name:'Record text consent',exact:true}).click())
    await consent.getByText('Consented',{exact:true}).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Text consent fits ${width}`)
    if(proof)await consent.screenshot({path:`${proof}/texting-consent-${width}.png`})
    await page.goto(`${app.origin}/app/sales?invoice=${inv.id}`)
    const panel=page.getByRole('region',{name:'Text invoice link',exact:true})
    const anchor=panel.getByRole('link',{name:'Text the link',exact:true})
    await anchor.waitFor()
    const href=await anchor.getAttribute('href')
    assert.match(href,/^sms:\+15005550006\?body=/);assert.ok(decodeURIComponent(href).includes('/i/'))
    await submit('texting.share',()=>anchor.click())
    await panel.getByText('Link shared; sending happens on the phone',{exact:true}).first().waitFor()
    await submit('texting.send',()=>panel.getByRole('button',{name:'Send test text from Pantry',exact:true}).click())
    await panel.getByText('queued',{exact:true}).first().waitFor()
    const message=(await view('texting')).messages.find(m=>m.invoice_id===inv.id&&m.status==='queued')
    const path='/api/pantry/texting/twilio/status?messageId='+message.id,fields={AccountSid:'synthetic-pantry-31',MessageSid:message.provider_message_id,MessageStatus:'delivered'}
    const response=await owner.request.post(app.origin+path,{headers:{'content-type':'application/x-www-form-urlencoded','x-twilio-signature':twilioSignature('synthetic-pantry-32',app.origin+path,fields)},data:new URLSearchParams(fields).toString()})
    assert.equal(response.status(),200,await response.text())
    await page.reload()
    await panel.getByText('delivered',{exact:true}).first().waitFor()
    const outcome=panel.locator('details').last();await outcome.locator('summary').click()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`Text outcomes fit ${width}`)
    if(proof){await panel.scrollIntoViewIfNeeded();await panel.screenshot({path:`${proof}/texting-invoice-${width}.png`});await page.screenshot({path:`${proof}/texting-invoice-page-${width}.png`,fullPage:true})}
    const deliveries=(await view('sales')).deliveries.filter(d=>d.invoice_id===inv.id)
    assert.ok(deliveries.some(d=>d.kind==='invoice'&&d.status==='accepted'))
    assert.deepEqual(errors,[])
   } finally {await context.close()}
  }
 } finally {await owner.close();await browser.close();await app.close()}
}
