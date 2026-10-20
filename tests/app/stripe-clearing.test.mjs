import test from 'node:test'
import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'
import { clearingProvider } from '../providers/stripe-clearing.mjs'

test('PROC-003 missing Stripe refund is named on dashboard, close and settings, then disappears when repaired at 1440 and 390',async t=>{
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
      for(const [name,path] of [['dashboard','/app'],['close','/app/close?period=2026-09'],['settings','/app/settings']]){
        await page.goto(app.origin+path)
        if(name==='close'){
          const row=page.getByRole('row').filter({has:page.getByText('Stripe clearing agrees to the provider',{exact:true})})
          await row.getByText(repaired?'Passed':'Not yet',{exact:true}).waitFor()
          if(!repaired){assert.ok((await row.innerText()).includes('txn_refund'));assert.ok((await row.innerText()).includes('$100.00'))}
          else assert.ok((await row.innerText()).includes('difference $0.00'))
        }else{
          const card=page.locator('.card').filter({has:page.getByRole('heading',{name:'Stripe clearing',exact:true})})
          await card.getByText(repaired?'Matches provider':'Needs attention',{exact:true}).waitFor()
          if(!repaired){await card.getByRole('cell',{name:/^txn_refund/}).waitFor();await card.getByText('refund',{exact:true}).waitFor()}
          else assert.equal(await card.getByRole('cell',{name:/^txn_refund/}).count(),0)
          const response=await context.request.get(new URL(await card.getByRole('link',{name:'Download comparison and item evidence',exact:true}).getAttribute('href'),app.origin).href)
          assert.equal(response.status(),200);const data=await response.json();assert.equal(data.ok,repaired);assert.equal(data.differenceCents,repaired?0:10000)
        }
        assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} ${width} fits`)
        await page.screenshot({path:`/tmp/pantry-r14-proc003-${name}-${repaired?'repaired':'missing'}-${width}.png`,fullPage:true})
      }
      assert.deepEqual(errors,[]);await context.close()
    }
  }
})
