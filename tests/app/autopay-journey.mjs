import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'
import { autopayProvider } from '../api/autopay-journey.mjs'

export async function autopayBrowser(t) {
  const provider=autopayProvider(),mail=[]
  const app=await providerWorker({clock:true,bindings:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-pantry-140',MAIL_FROM:'Pantry <pantry@example.test>'},outbound:async request=>{
    if(new URL(request.url).hostname==='api.resend.com'){mail.push(await request.json());return Response.json({id:`synthetic-pantry-${mail.length+150}`})}
    return provider.outbound(request)
  }})
  t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const clock={'x-synthetic-pantry-clock':'2026-10-20T16:00:00Z'}
  const owner=await browser.newContext({extraHTTPHeaders:clock});t.after(()=>owner.close())
  assert.equal((await owner.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})).status(),303)
  await owner.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
  const command=async(op,data)=>{const r=await owner.request.post(`${app.origin}/api/pantry/command/${op}`,{headers:{origin:app.origin},data});assert.equal(r.status(),200,`${op}: ${await r.text()}`);return r.json()}
  const view=async path=>{const r=await owner.request.get(`${app.origin}/api/pantry/${path}`);assert.equal(r.status(),200,await r.text());return r.json()}
  await command('entity.save',{legalName:'Juniper Lane Design LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:''})
  await command('chart.start',{});await command('stripe.connect',{secretKey:'synthetic-pantry-141'})
  const acct=(await view('state')).accounts.find(a=>a.code==='4000').id,storageState=await owner.storageState(),proof=process.env.PANTRY_PROOF_DIR
  if(proof)await mkdir(proof,{recursive:true})
  for(const width of [1440,390]) {
    const customer=await command('contact.save',{kind:'customer',name:`Cedar Studio ${width}`,email:`cedar-${width}@example.test`,billingAddress:'12 Cedar Street, New York NY 10001',phone:'+15005550006',termsDays:1})
    let recurring=await command('recurring.save',{customerId:customer.id,startDate:'2026-10-20',every:1,unit:'month',termsDays:1,mode:'send',lines:[{description:'Monthly design retainer',quantity:'1',rate:'2400',accountId:acct,taxCode:'exempt'}]})
    recurring=await command('recurring.approve',{id:recurring.id,revision:recurring.revision})
    await app.cron(Date.parse('2026-10-20T16:00:00Z'))
    const inv=(await view('sales')).invoices.find(i=>i.recurring_id===recurring.id)
    assert.ok(inv.link_token)
    const context=await browser.newContext({storageState,extraHTTPHeaders:clock,viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[]
    page.on('pageerror',e=>errors.push(String(e)))
    await page.goto(`${app.origin}/app/sales?tab=contacts&customer=${customer.id}`)
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Saved payment and autopay',exact:true})})
    await card.getByText('Off',{exact:true}).waitFor();await card.locator('summary',{hasText:'Authorization and schedule'}).click()
    await card.getByLabel('Recurring template',{exact:true}).selectOption(recurring.id)
    await card.getByLabel('Charge purpose',{exact:true}).fill('Monthly studio design retainer')
    await card.getByLabel('I approve this schedule and its retry notices for this customer.',{exact:true}).check()
    await card.getByRole('button',{name:'Approve autopay schedule',exact:true}).click()
    await card.getByText(/Approved schedule/).waitFor()
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    if(proof)await card.screenshot({path:`${proof}/autopay-owner-approved-${width}.png`})
    const payer=await browser.newContext({extraHTTPHeaders:{...clock,'cf-connecting-ip':'192.0.2.10'},viewport:{width,height:width===390?844:1000}}),hosted=await payer.newPage()
    await hosted.route('https://checkout.stripe.com/**',async route=>{
      const sessionId=new URL(route.request().url()).pathname.split('/').at(-1)
      provider.completeSetup(sessionId)
      await route.fulfill({status:302,headers:{location:`${app.origin}/i/${inv.link_token}?autopay_setup=${sessionId}`},body:''})
    })
    await hosted.goto(`${app.origin}/i/${inv.link_token}`)
    await hosted.getByText('Save a method for recurring invoices',{exact:true}).click()
    await hosted.getByLabel('Payment method',{exact:false}).selectOption('us_bank_account')
    await hosted.getByLabel('I authorize these recurring charges and agree to the authorization above.',{exact:true}).check()
    assert.match(await hosted.getByRole('region',{name:'Autopay'}).innerText(),/electronic debits/)
    assert.equal(await hosted.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    if(proof)await hosted.screenshot({path:`${proof}/autopay-payer-authorization-${width}.png`,fullPage:true})
    await hosted.getByRole('button',{name:'Continue to Stripe to save method',exact:true}).click()
    await hosted.getByText(/ACH bank account ending 6789. Autopay authorized/).waitFor()
    if(proof)await hosted.screenshot({path:`${proof}/autopay-payer-saved-${width}.png`,fullPage:true})
    await page.reload();await card.getByText('Authorized',{exact:true}).waitFor()
    if(proof)await card.screenshot({path:`${proof}/autopay-owner-authorized-${width}.png`})
    await hosted.getByRole('button',{name:'Revoke autopay',exact:true}).click()
    await hosted.getByText(/Autopay is off/).waitFor()
    if(proof)await hosted.screenshot({path:`${proof}/autopay-payer-revoked-${width}.png`,fullPage:true})
    await page.reload();await card.getByText('Off',{exact:true}).waitFor()
    if(proof)await card.screenshot({path:`${proof}/autopay-owner-revoked-${width}.png`})
    assert.deepEqual(errors,[])
    await payer.close();await context.close()
  }
}
