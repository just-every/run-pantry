import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'
import { clearingProvider } from '../providers/stripe-clearing.mjs'

test('REPORT-005 / PROC-003 missing Stripe refund is named on close and settings, then disappears when repaired at 1440 and 390',async t=>{
  const provider=clearingProvider(),app=await providerWorker({bindings:{},outbound:provider.outbound});t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const owner=await browser.newContext()
  assert.equal((await owner.request.post(`${app.origin}/auth/bootstrap`,{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})).status(),303)
  await owner.request.post(`${app.origin}/setup`,{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
  const command=async(op,data)=>{const r=await owner.request.post(`${app.origin}/api/pantry/command/${op}`,{headers:{origin:app.origin},data});assert.equal(r.status(),200,`${op}: ${await r.text()}`);return r.json()}
  await command('entity.save',{legalName:'Juniper Lane Design LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01',policies:''});await command('chart.start',{})
  const state=await(await owner.request.get(`${app.origin}/api/pantry/state`)).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
  const bank=await command('bank-account.save',{name:'Operating checking',institution:'Chase',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0.00'})
  await command('stripe.connect',{secretKey:'sk_test_'+'syntheticclearingfixture0123456789'})
  await command('stripe.payouts',{bankAccountId:bank.id,salesAccountId:acct['4000'],from:'2026-09-01'})
  const storageState=await owner.storageState()
  for(const repaired of [false,true]){
    if(repaired){
      provider.repair()
      const repairPage=await owner.newPage();await repairPage.goto(`${app.origin}/app/settings`)
      await repairPage.getByRole('button',{name:'Read payouts now',exact:true}).click()
      await repairPage.locator('.card').filter({has:repairPage.getByRole('heading',{name:'Stripe clearing',exact:true})}).getByText('Matches provider',{exact:true}).waitFor()
      await repairPage.close()
    }
    for(const width of [1440,390]){
      const context=await browser.newContext({storageState,viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[]
      page.on('pageerror',e=>errors.push(String(e)))
      for(const [name,path] of [['close','/app/close?period=2026-09'],['settings','/app/settings']]){
        await page.goto(app.origin+path)
        if(name==='close'){
          const row=page.getByRole('row').filter({has:page.getByText('Stripe clearing agrees to the provider',{exact:true})})
          await row.getByText(repaired?'Passed':'Not yet',{exact:true}).waitFor()
          if(!repaired){assert.ok((await row.innerText()).includes('txn_refund'));assert.ok((await row.innerText()).includes('$100.00'))}
          else assert.ok((await row.innerText()).includes('difference $0.00'))
        }else{
          const card=page.locator('.card').filter({has:page.getByRole('heading',{name:'Stripe clearing',exact:true})})
          await card.getByText(repaired?'Matches provider':'Needs attention',{exact:true}).waitFor()
          if(!repaired){await card.getByRole('cell',{name:/txn_refund/}).waitFor();await card.getByText('refund',{exact:true}).waitFor()}
          else assert.equal(await card.getByRole('cell',{name:/txn_refund/}).count(),0)
          const response=await context.request.get(new URL(await card.getByRole('link',{name:'Download comparison and item evidence',exact:true}).getAttribute('href'),app.origin).href)
          assert.equal(response.status(),200);const data=await response.json();assert.equal(data.ok,repaired);assert.equal(data.differenceCents,repaired?0:10000);const observed = card.locator('time').filter({ hasText: /at/ });assert.equal(await observed.getAttribute('datetime'),data.observedAt);assert.equal(await observed.innerText(),await page.evaluate(iso=>new Intl.DateTimeFormat('en-US',{month:'short',day:'numeric',year:'numeric'}).format(new Date(iso))+' at '+new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date(iso)),data.observedAt));assert.ok(!(await card.innerText()).includes(data.observedAt));assert.ok(!(await card.innerText()).includes('[object Object]'))
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width} fits`)
        if(name==='settings'){
          await page.locator('.card').filter({has:page.getByRole('heading',{name:'Stripe clearing',exact:true})}).screenshot({path:`/tmp/pantry-r14-proc003-settings-card-${repaired?'repaired':'missing'}-${width}.png`})
          const payout=page.locator('.card').filter({has:page.getByRole('heading',{name:'Stripe payouts',exact:true})})
          await payout.getByText('Change payout settings',{exact:true}).click()
          const start=payout.getByLabel('Activity start date',{exact:true});await start.waitFor();assert.equal(await start.inputValue(),'2026-09-01')
          const box=await start.boundingBox();assert.ok(box.x>=0&&box.x+box.width<=width)
          await payout.screenshot({path:`/tmp/pantry-r14-proc003-payout-card-${repaired?'repaired':'missing'}-${width}.png`})
        }
        await page.screenshot({path:`/tmp/pantry-r14-proc003-${name}-${repaired?'repaired':'missing'}-${width}.png`,fullPage:true})
      }
      if(repaired){
        const clearing=await(await context.request.get(`${app.origin}/api/pantry/stripe/clearing`)).json()
        const charge=clearing.items.find(i=>i.id==='txn_charge')
        await page.goto(`${app.origin}/app/reports?report=profit-and-loss&line=income&record=entry:${charge.entryId}&from=2026-09-01&to=2026-09-30&basis=accrual`)
        const providerCard=page.locator('.card').filter({has:page.getByRole('heading',{name:'Provider events',exact:true})})
        await providerCard.getByText('Stripe · balance-transaction',{exact:true}).waitFor()
        await providerCard.locator('summary').first().click()
        await providerCard.getByText('txn_charge',{exact:true}).waitFor()
        assert.ok((await providerCard.innerText()).includes('pi_external'))
        const output=await context.request.get(new URL(await page.getByRole('link',{name:'Export record JSON',exact:true}).getAttribute('href'),app.origin).href)
        const exported=await output.json()
        assert.ok(exported.record.providerEvents.some(e=>e.id==='txn_charge'))
        assert.ok(exported.record.audit.some(e=>e.subject_id==='txn_charge'&&e.action==='stripe.clearing'))
        const auditCard=page.locator('.card').filter({has:page.getByRole('heading',{name:'Audit history',exact:true})})
        await auditCard.getByText(/Stripe clearing/).waitFor()
        await auditCard.locator('summary').first().click()
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
        const evidence=process.env.PANTRY_EVIDENCE_DIR||'/tmp/sx-pantry-r16'
        await(await import('node:fs/promises')).mkdir(evidence,{recursive:true})
        await page.screenshot({path:`${evidence}/report005-provider-${width}.png`,fullPage:true})
      }
      assert.deepEqual(errors,[]);await context.close()
    }
  }
})
