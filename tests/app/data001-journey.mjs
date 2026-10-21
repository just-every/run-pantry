import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {worker,TOKEN} from './worker.mjs'

export async function data001Browser(t) {
  const app=await worker();t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const owner=await browser.newContext();t.after(()=>owner.close())
  assert.equal((await owner.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})).status(),303)
  assert.equal((await owner.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})).status(),303)
  const command=async(op,data)=>{const r=await owner.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});if(r.status()!==200)assert.fail(`${op}: HTTP ${r.status()}`);return r.json()}
  await command('entity.save',{legalName:'Rivera Design Studio LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:'Consulting services billed on approval.'})
  await command('chart.start',{})
  await command('receipt-address.create',{mailbox:'receipts@rivera.example'})
  await command('webhook.create',{destination:'https://hooks.rivera.example/books',events:['approved','paid']})
  if(process.env.PANTRY_STRIPE_KEY)await command('stripe.connect',{secretKey:process.env.PANTRY_STRIPE_KEY})
  const session=await owner.storageState(),dir=process.env.PANTRY_EVIDENCE_DIR??'/tmp/sx-pantry-c30-data'
  await mkdir(dir,{recursive:true})
  for(const width of [1440,390]) {
    const context=await browser.newContext({storageState:session,viewport:{width,height:width===390?844:1000}})
    try {
      const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
      await page.goto(app.origin+'/app/settings')
      const inventory=page.locator('#data-flows')
      await inventory.getByRole('heading',{name:'Data & connections',exact:true}).waitFor()
      for(const id of ['plaid','stripe','model','mail','inbound'])await inventory.locator(`[data-service="${id}"] > summary`).click()
      await inventory.getByText(/receipts\+.*@rivera\.example/).waitFor()
      await inventory.getByText('Owner webhook destinations · 1',{exact:true}).click()
      await inventory.getByText('hooks.rivera.example · Enabled',{exact:true}).waitFor()
      assert.ok((await inventory.innerText()).includes('per-connection'))
      assert.ok((await inventory.innerText()).includes('$0.0009/message'))
      await inventory.screenshot({path:`${dir}/data-inventory-${width}.png`})
      await inventory.getByText('Services not available in this edition',{exact:true}).click()
      await inventory.getByText('Pantry Connect mail',{exact:true}).waitFor()
      await inventory.screenshot({path:`${dir}/data-unavailable-${width}.png`})
      const reader=page.getByRole('heading',{name:'AI reading',exact:true}).locator('../..')
      await reader.getByLabel('API key',{exact:true}).fill('synthetic-pantry-9001')
      await reader.getByRole('button',{name:'Save key',exact:true}).click()
      await reader.getByRole('button',{name:'Remove key',exact:true}).waitFor()
      await inventory.getByRole('button',{name:'Refresh connections',exact:true}).click()
      await inventory.getByText('Model provider · Connected',{exact:true}).waitFor()
      await reader.getByRole('button',{name:'Remove key',exact:true}).click()
      await reader.getByRole('button',{name:'Save key',exact:true}).waitFor()
      await inventory.getByRole('button',{name:'Refresh connections',exact:true}).click()
      await inventory.getByText('Model provider · Off',{exact:true}).waitFor()
      await reader.screenshot({path:`${dir}/data-model-off-${width}.png`})
      if(process.env.PANTRY_STRIPE_KEY) {
        const stripe=page.getByRole('heading',{name:'Online payments (Stripe)',exact:true}).locator('../..')
        await stripe.getByText('Replace Stripe key',{exact:true}).click()
        await stripe.getByLabel('Replacement Stripe secret key',{exact:true}).fill(process.env.PANTRY_STRIPE_KEY)
        await stripe.getByRole('button',{name:'Replace Stripe key',exact:true}).click()
        await page.waitForFunction(()=>document.querySelector('input[name="secretKey"]')?.value==='')
        assert.equal(await stripe.locator('[type=password]').inputValue(),'','successful rotation clears the entered key')
        await stripe.screenshot({path:`${dir}/data-stripe-${width}.png`})
      }
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`settings fits ${width}`)
      assert.deepEqual(errors,[])
    } finally {await context.close()}
  }
}
