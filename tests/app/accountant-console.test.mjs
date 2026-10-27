import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { chromium } from '@playwright/test'
import { providerWorker } from './provider-worker.mjs'
import { TOKEN } from './worker.mjs'

test('accountant connects three clients with distinct status and grants, and owner removal hides a client', async t => {
  const evidence=process.env.PANTRY_EVIDENCE_DIR
  if(evidence)await mkdir(evidence,{recursive:true})
  const apps = [], mail = [[], [], []], origins = [1, 2, 3].map(n => `https://client${n}.example.test`)
  const browser = await chromium.launch({headless:true, ...(process.env.PANTRY_CHROMIUM_PATH ? {executablePath:process.env.PANTRY_CHROMIUM_PATH}:{}), args:['--no-sandbox','--use-mock-keychain','--password-store=basic']})
  t.after(() => browser.close())
  const owners = [], accountants = [], keys = [], charts = [], entries = []
  const email = 'synthetic-pantry-1@example.test'
  async function command(context, i, op, data, status=200) {
    const response = await context.request.post(apps[i].origin + '/api/pantry/command/' + op, {headers:{origin:apps[i].origin},data})
    assert.equal(response.status(),status,`${op}: ${await response.text()}`)
    return response.json()
  }
  for (let i=0;i<3;i++) {
    const app = await providerWorker({bindings:{PANTRY_ACCOUNTANT_CLIENTS:origins.join(','),MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-pantry-2'},outbound:async request => {
      const url=new URL(request.url)
      if(url.hostname==='api.resend.com') {mail[i].push(await request.json());return Response.json({id:'synthetic-pantry-3'})}
      const index=origins.indexOf(url.origin)
      assert.ok(index>=0,'only trusted client origins may be contacted')
      return fetch(apps[index].origin+url.pathname,{headers:request.headers,redirect:'manual'})
    }})
    apps.push(app);t.after(() => app.close())
    const owner=await browser.newContext(), accountant=await browser.newContext()
    owners.push(owner);accountants.push(accountant)
    assert.equal((await owner.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Client owner'},maxRedirects:0})).status(),303)
    await owner.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})
    await command(owner,i,'entity.save',{legalName:`Client ${i+1}`,entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01'})
    await command(owner,i,'chart.start',{})
    const state=await (await owner.request.get(app.origin+'/api/pantry/state')).json()
    const chart=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]));charts.push(chart)
    await command(owner,i,'member.save',{email,name:'Shared accountant',role:'accountant',canPost:i===1,canLock:i===2,canReopen:i===2})
    const message=mail[i].findLast(message=>[message.to].flat().includes(email))
    assert.ok(message)
    const token=new URL(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
    assert.equal((await accountant.request.post(app.origin+'/auth/confirm',{headers:{origin:app.origin},data:{token},maxRedirects:0})).status(),303)
    await command(accountant,i,'accountant.status-share',{email,consent:'SHARE STATUS'},403)
    await command(owner,i,'accountant.status-share',{email,consent:'no'},400)
    keys.push((await command(owner,i,'accountant.status-share',{email,consent:'SHARE STATUS'})).token)
    if(i===0) {
      const ownerPage=await owner.newPage();await ownerPage.setViewportSize({width:1440,height:1000})
      await ownerPage.goto(app.origin+'/app/settings')
      const card=ownerPage.locator('section.card').filter({has:ownerPage.getByRole('heading',{name:'Accountant console',exact:true})})
      await card.getByText("Share this client's status",{exact:true}).click()
      await card.getByLabel('Accountant',{exact:true}).selectOption(email)
      await card.getByRole('button',{name:'Share client status',exact:true}).click()
      await card.getByLabel('New client status key').waitFor()
      keys[i]=await card.getByLabel('New client status key').inputValue()
      await card.getByRole('button',{name:'Show key',exact:true}).click()
      assert.equal(await card.getByLabel('New client status key').getAttribute('type'),'text')
      await card.getByRole('button',{name:'Hide key',exact:true}).click()
      if(evidence)for(const width of [1440,390]) {
        await ownerPage.setViewportSize({width,height:1000})
        await card.screenshot({path:`${evidence}/accountant-sharing-${width}.png`})
      }
      await ownerPage.close()
    }
    assert.equal((await accountant.request.get(app.origin+'/api/pantry/accountant-status')).status(),401)
    assert.equal((await accountant.request.get(app.origin+'/api/pantry/state',{headers:{authorization:`Bearer ${keys[i]}`,'cookie':''}})).status(),401)
    if(i===0) {
      const customer=await command(owner,i,'contact.save',{kind:'customer',name:'synthetic-pantry-30'})
      await command(owner,i,'invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-30',lines:[{description:'synthetic-pantry-31',accountId:chart['4000'],quantity:'1',rate:'25.00',taxCode:'exempt'}]})
    }
    if(i===2) {
      await command(owner,i,'close.tasks',{period:'2026-08'})
      const close=await (await owner.request.get(app.origin+'/api/pantry/close/2026-08')).json()
      for(const task of close.tasks)await command(owner,i,'close.task',{id:task.id,revision:task.revision,done:true})
      await command(owner,i,'period.lock',{period:'2026-08'})
    }
    for(let j=0;j<=i;j++) {
      const draft=await command(owner,i,'journal.save-draft',{date:'2026-09-30',memo:`synthetic-pantry-${10+j}`,lines:[{accountId:chart['6500'],debit:'10.00'},{accountId:chart['3000'],credit:'10.00'}]})
      if(!j)entries.push(draft)
      await command(owner,i,'question.ask',{subjectKind:'journal',subjectId:draft.id,question:'Confirm the source for this draft?',assignee:email})
    }
  }
  const hub=accountants[0], view=async()=>{
    const response=await hub.request.get(apps[0].origin+'/api/pantry/accountant-console');assert.equal(response.status(),200);return response.json()
  }
  await command(hub,0,'accountant.client-save',{origin:'https://untrusted.example.test',token:keys[0]},403)
  await command(owners[0],0,'accountant.client-save',{origin:origins[0],token:keys[0]},403)
  for(let i=0;i<3;i++)await command(hub,0,'accountant.client-save',{origin:origins[i],token:keys[i]})
  const clients=(await view()).clients
  assert.deepEqual(clients.map(c=>[c.name,c.reviewQueue,c.openQuestions,c.currentThrough,c.closeStatus]),[
    ['Client 1',2,1,null,'No locked periods'],['Client 2',2,2,null,'No locked periods'],['Client 3',3,3,'2026-08-31','Locked through 2026-08'],
  ])
  assert.deepEqual(clients.map(c=>c.grants),[{post:false,lock:false,reopen:false},{post:true,lock:false,reopen:false},{post:false,lock:true,reopen:true}])
  await command(accountants[0],0,'journal.post',{id:entries[0].id,revision:entries[0].revision},403)
  await command(accountants[1],1,'journal.post',{id:entries[1].id,revision:entries[1].revision})
  await command(accountants[2],2,'journal.post',{id:entries[2].id,revision:entries[2].revision},403)
  const page=await hub.newPage();await page.setViewportSize({width:1440,height:1000})
  await page.goto(apps[0].origin+'/app/settings')
  const consoleCard=page.locator('section.card').filter({has:page.getByRole('heading',{name:'Accountant console',exact:true})})
  await consoleCard.getByText('Client 3',{exact:true}).waitFor()
  assert.deepEqual(await consoleCard.getByRole('link',{name:'Open books'}).evaluateAll(links=>links.map(link=>link.href)),origins.map(origin=>origin+'/app'))
  assert.equal(await consoleCard.getByRole('row').count(),4)
  if(evidence)for(const width of [1440,390]) {
    await page.setViewportSize({width,height:1000});await page.evaluate(()=>window.scrollTo(0,0))
    await consoleCard.screenshot({path:`${evidence}/accountant-console-${width}.png`})
  }
  await command(owners[2],2,'member.save',{email,name:'Shared accountant',role:'accountant',active:false})
  await consoleCard.getByRole('button',{name:'Refresh client status'}).click()
  await consoleCard.getByText('Client 3',{exact:true}).waitFor({state:'detached'})
  assert.deepEqual((await view()).clients.map(c=>c.name),['Client 1','Client 2'])
  assert.equal((await accountants[2].request.get(apps[2].origin+'/api/pantry/state')).status(),403)
  assert.equal((await hub.request.get(apps[2].origin+'/api/pantry/accountant-status',{headers:{authorization:`Bearer ${keys[2]}`}})).status(),403)
  // Restricting bank visibility invalidates the old grant; a new consent shares no aggregate counts.
  await command(owners[1],1,'member.save',{email,name:'Shared accountant',role:'accountant',bankAccounts:[]})
  assert.deepEqual((await view()).clients.map(c=>c.name),['Client 1'])
  const limitedKey=(await command(owners[1],1,'accountant.status-share',{email,consent:'SHARE STATUS'})).token
  await command(hub,0,'accountant.client-save',{origin:origins[1],token:limitedKey})
  const limited=(await view()).clients.find(c=>c.name==='Client 2')
  assert.deepEqual([limited.restricted,limited.currentThrough,limited.reviewQueue,limited.openQuestions,limited.closeStatus],[true,null,null,null,null])
  await command(owners[1],1,'accountant.status-revoke',{email})
  assert.deepEqual((await view()).clients.map(c=>c.name),['Client 1'])
  const other=await browser.newContext()
  assert.equal((await other.request.get(apps[0].origin+'/api/pantry/accountant-console')).status(),401)
  const cross=await hub.request.post(apps[0].origin+'/api/pantry/command/accountant.client-remove',{headers:{origin:'https://untrusted.example.test'},data:{origin:origins[0]}})
  assert.equal(cross.status(),403)
  const activity=await (await owners[0].request.get(apps[0].origin+'/api/pantry/activity')).json()
  for(const key of keys)assert.ok(!JSON.stringify(activity).includes(key),'status keys must never enter audit detail')
})
