import assert from 'node:assert/strict'
import { chromium } from '@playwright/test'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { worker,TOKEN } from './worker.mjs'
async function start(t) {
  const app=await worker();t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const owner=await browser.newContext()
  assert.equal((await owner.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Synthetic owner'},maxRedirects:0})).status(),303)
  assert.equal((await owner.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})).status(),303)
  const command=async(op,data)=>{const r=await owner.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,op+': '+await r.text());return r.json()}
  await command('entity.save',{legalName:'Synthetic Studio',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2025-01-01',policies:''})
  await command('chart.start',{})
  const state=await(await owner.request.get(app.origin+'/api/pantry/state')).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
  const evidence=process.env.PANTRY_EVIDENCE_DIR??join(tmpdir(),'pantry-connections-ask');await mkdir(evidence,{recursive:true})
  return {app,browser,owner,command,acct,evidence}
}
async function iconAudit(page) {
  for(const control of await page.locator('button:visible,a:visible').all()) {
    if((await control.innerText()).trim())continue
    // Every visible icon-only control needs a keyboard-accessible tooltip.
    const label=await control.getAttribute('aria-label');assert.ok(label,'icon-only control needs a label')
    await control.focus();await page.getByRole('tooltip',{name:label}).waitFor()
  }
}
export async function askJourney(t) {
  const {app,browser,owner,command,acct,evidence}=await start(t)
  for(const [date,account,amount]of [['2025-08-15',acct['6000'],'100.00'],['2026-08-15',acct['6000'],'250.00'],['2026-09-15',acct['4000'],'1000.00'],['2026-10-15',acct['4000'],'600.00']]) {
    const expense=account===acct['6000'],e=await command('journal.save-draft',{date,memo:'Synthetic posted work',lines:[{accountId:expense?account:acct['1000'],debit:amount},{accountId:expense?acct['1000']:account,credit:amount}]})
    await command('journal.post',{id:e.id,revision:e.revision})
  }
  for(const width of [1440,390]) {
    const context=await browser.newContext({storageState:await owner.storageState(),viewport:{width,height:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(String(e)))
    await page.goto(app.origin+'/app/reports')
    const card=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Ask the books',exact:true})})
    for(const question of ['what did we spend on contractors in Q3 2026 compared with last year?','why is net income down in October 2026?']) {
      await card.getByLabel('Book question').fill(question);await card.getByLabel('Answer basis').selectOption('accrual')
      await card.getByRole('button',{name:'Ask the books',exact:true}).click();await card.getByRole('heading',{name:'Generated answer · answered'}).waitFor()
      await card.getByText(question.includes('contractors')?'2026-07-01 to 2026-09-30: $250.00':'2026-10-01 to 2026-10-31: $600.00',{exact:true}).waitFor()
    }
    await page.screenshot({path:join(evidence,'ask-'+width+'.png'),fullPage:true})
    await card.getByText('Posted lines used (1)',{exact:true}).first().click()
    await card.getByRole('link',{name:/Synthetic posted work/}).first().click()
    await page.getByRole('heading',{name:/Journal entry/}).first().waitFor()
    await page.goto(app.origin+'/app/reports')
    await card.getByLabel('Book question').fill('why is net income down in October 2040?');await card.getByLabel('Answer basis').selectOption('cash')
    await card.getByRole('button',{name:'Ask the books',exact:true}).click();await card.getByRole('heading',{name:'Generated answer · no records'}).waitFor()
    assert.equal(await card.getByRole('button',{name:'Save answer as custom report'}).count(),0)
    await card.getByLabel('Book question').fill('why is net income down in October 2026?');await card.getByRole('button',{name:'Ask the books',exact:true}).click()
    await card.getByRole('button',{name:'Save answer as custom report'}).click()
    await page.getByRole('heading',{name:'Ask the books',exact:true}).waitFor()
    await page.getByText('why is net income down in October 2026?',{exact:true}).first().waitFor()
    await iconAudit(page);assert.deepEqual(errors,[]);await context.close()
  }
}
export async function connectionJourney(t) {
  const {app,browser,owner,evidence,command}=await start(t)
  await command('integration.create',{name:'Synthetic automation',scopes:['invoices:read']})
  for(const width of [1440,390]) {
    const context=await browser.newContext({storageState:await owner.storageState(),viewport:{width,height:1000}}),page=await context.newPage()
    await page.goto(app.origin+'/app/settings')
    const table=page.getByRole('table',{name:'Connection health',exact:true});await table.waitFor();await table.scrollIntoViewIfNeeded()
    for(const name of ['Stripe','Gusto','Synthetic automation'])assert.equal(await table.getByRole('row').filter({has:page.getByRole('cell',{name,exact:true})}).count(),1)
    await table.getByRole('cell',{name:'Not measured',exact:true}).first().waitFor()
    const row=table.getByRole('row').filter({has:page.getByRole('cell',{name:'Synthetic automation',exact:true})});await row.getByText('Active',{exact:true}).waitFor()
    await page.screenshot({path:join(evidence,'connections-'+width+'.png'),fullPage:true})
    await iconAudit(page);await context.close()
  }
}
