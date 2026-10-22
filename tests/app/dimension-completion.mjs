import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {providerWorker} from './provider-worker.mjs'
import {TOKEN} from './worker.mjs'

export async function dimensionCompletionBrowser(t){
 const app=await providerWorker({bindings:{},outbound:async()=>{throw new Error('No provider call expected')}});t.after(()=>app.close())
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const owner=await browser.newContext();t.after(()=>owner.close());const {origin}=app
 await owner.request.post(origin+'/auth/bootstrap',{headers:{origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})
 await owner.request.post(origin+'/setup',{headers:{origin},form:{confirm:'yes'},maxRedirects:0})
 const command=async(op,data)=>{const r=await owner.request.post(origin+'/api/pantry/command/'+op,{headers:{origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 const view=async(path)=>{const r=await owner.request.get(origin+'/api/pantry/'+path);assert.equal(r.status(),200,await r.text());return r.json()}
 await command('entity.save',{legalName:'Juniper Studio LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01'})
 await command('chart.start',{});let state=await view('state');const acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 await command('dimensions.settings',{revision:state.dimensions.settings.revision,class:true,location:true,project:true})
 for(const [kind,names]of [['class',['Studio','Support']],['location',['New York','Remote']],['project',['Cedar','Cypress']]])for(const name of names)await command('dimension.save',{kind,name})
 const tags={className:'Studio',locationName:'New York',projectName:'Cedar'},other={className:'Support',locationName:'Remote',projectName:'Cypress'}
 const customer=await command('contact.save',{kind:'customer',name:'Cedar Workshop'}),vendor=await command('contact.save',{kind:'vendor',name:'Brightline Software'})
 const bank=await command('bank-account.save',{name:'Operating checking',institution:'Juniper Bank',accountId:acct['1000'],numberLast4:'3131',openingDate:'2026-01-01',openingBalance:'0'})
 const liability=await command('account.save',{code:'2400',name:'Customer advances',type:'liability',subtype:'other'})
 const draft=await command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-01',lines:[{description:'Design consultation',quantity:'1',rate:'200',accountId:acct['4000'],taxCode:'exempt',...tags},{description:'Website support',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...other}]})
 await command('invoice.approve',{id:draft.id,revision:draft.revision});await command('invoice.issue',{id:draft.id})
 await command('payment.record',{direction:'received',contactId:customer.id,date:'2026-09-10',amount:'150',bankAccountId:bank.id,...tags,allocations:[{targetId:draft.id,amount:'150'}]})
 await command('bill.save',{vendorId:vendor.id,billDate:'2026-09-02',reference:'Brightline September',post:true,lines:[{description:'Studio software',amount:'40',accountId:acct['6200'],...tags}]})
 await command('contractor.save',{contactId:vendor.id,is1099:true});await command('payment.record',{direction:'paid',contactId:vendor.id,date:'2026-09-15',amount:'25',method:'ach',bankAccountId:bank.id,...tags,allocations:[]})
 const adjust=await command('journal.save-draft',{date:'2026-12-31',memo:'Annual software adjustment',adjusting:true,lines:[{accountId:acct['6200'],debit:'5',...tags},{accountId:acct['3000'],credit:'5',...other}]});await command('journal.post',{id:adjust.id,revision:adjust.revision})
 const budget=await command('budget.save',{name:'Cedar annual plan',startMonth:'2026-01',basis:'cash',cells:[{accountId:acct['4000'],month:'2026-09',amount:'250',...tags},{accountId:acct['6200'],month:'2026-09',amount:'40',...tags}]})
 const proof=process.env.PANTRY_EVIDENCE_DIR||'/tmp/pantry-dimension-completion';await mkdir(proof,{recursive:true})
 for(const width of [1440,390]){
  const page=await owner.newPage();await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  const shot=async(name,locator)=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);if(locator)await locator.screenshot({path:`${proof}/completion-${name}-${width}.png`});else await page.screenshot({path:`${proof}/completion-${name}-${width}.png`})}
  const submit=async(button,op)=>{const saved=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pantry/command/'+op&&r.request().method()==='POST');await button.click();assert.equal((await saved).status(),200)}
  const report=async(slug,extra={})=>{await page.goto(origin+'/app/reports?'+new URLSearchParams({report:slug,from:'2026-09-01',to:'2026-09-30',basis:'cash',...extra}));await expect(page.getByRole('heading',{name:'Reports',exact:true})).toBeVisible()}
  await report('sales-by-customer');await page.getByLabel('Split by dimension',{exact:true}).selectOption('class')
  await expect(page.getByRole('table',{name:'Report split by class',exact:true})).toBeVisible();await shot('group-split')
  const download=page.waitForEvent('download');await page.getByRole('link',{name:'Download Excel · cash',exact:true}).click();assert.ok((await download).suggestedFilename().endsWith('.xlsx'))
  await page.getByRole('table',{name:'Report split by class'}).locator('.figure-link').first().click();await expect(page.getByText('Adds up to the report figure',{exact:true})).toBeVisible();await shot('split-sources')
  await report('audit-log',{from:'2026-01-01',to:'2026-12-31'});await page.getByLabel('Dimension filter',{exact:true}).selectOption(JSON.stringify(['class','value:Studio']))
  await expect(page.getByText(/Dimension filters use frozen event-time memberships/)).toBeVisible();await shot('audit-filter')
  await page.getByLabel('Split by dimension',{exact:true}).selectOption('class');await expect(page.getByRole('table',{name:'Report split by class'})).toBeVisible();await shot('audit-split')
  await report('adjusting-entries',{to:'2026-12-31',split:'class',basis:'accrual'});await expect(page.getByRole('table',{name:'Report split by class'})).toBeVisible();await shot('adjusting-split')
  await page.locator('.figure-link').first().click();await expect(page.getByText('Adds up to the report figure',{exact:true})).toBeVisible();await shot('adjusting-sources')
  await report('project-profitability',{projectName:'Cedar',split:'location'});await expect(page.getByRole('table',{name:'Report split by location'})).toBeVisible();await shot('project-split')
  await report('budget-actual',{budget:budget.id});await page.getByLabel('Split by dimension',{exact:true}).selectOption('class');await expect(page.getByRole('table',{name:'Report split by class'})).toBeVisible();await shot('budget-split')
  await report('contractors',{year:'2026',split:'class'});await expect(page.getByRole('table',{name:'Report split by class'})).toBeVisible();await shot('contractor-split')
  await report('custom');await page.getByRole('button',{name:'New custom report',exact:true}).click()
  await page.getByLabel('Report name',{exact:true}).fill(`Studio trial balance ${width}`);await page.getByLabel('Report source',{exact:true}).selectOption('trial-balance')
  await page.getByLabel('From',{exact:true}).fill('2026-09-01');await page.getByLabel('To',{exact:true}).fill('2026-09-30');await page.getByLabel('Period columns',{exact:true}).selectOption('class')
  await shot('custom-dimension-editor');await submit(page.getByRole('button',{name:'Save custom report',exact:true}),'custom-report.save')
  await expect(page.getByRole('heading',{name:`Studio trial balance ${width}`,exact:true})).toBeVisible();await shot('custom-dimension-render')
  const invoiceDraft=await command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-20',lines:[{description:`Recode consultation ${width}`,quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...tags}]})
  await command('invoice.approve',{id:invoiceDraft.id,revision:invoiceDraft.revision});const issued=await command('invoice.issue',{id:invoiceDraft.id})
  await command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-05',amount:'50',bankAccountId:bank.id,...tags,allocations:[{targetId:issued.id,amount:'50'}]})
  const original=(await view('journal')).entries.find(e=>e.id===issued.journal_id)
  await page.goto(origin+'/app/books');await page.getByRole('tab',{name:'Review',exact:true}).click();await page.getByLabel('Reclassify by',{exact:true}).selectOption('class');await page.getByLabel('From account',{exact:true}).selectOption(acct['4000'])
  await page.getByLabel(`Reclassify ${original.memo}`,{exact:true}).check();await page.getByLabel('To class',{exact:true}).selectOption('Support');await shot('document-recoding')
  await submit(page.getByRole('button',{name:'Reclassify 1 line',exact:true}),'journal.reclassify')
  const retained=(await view('journal')).entries.find(e=>e.id===issued.journal_id);assert.equal(retained.lines.find(l=>l.line_no===2).class_name,'Studio')
  await report('profit-and-loss',{from:'2026-10-01',to:'2026-10-31',dimension:'class',dimensionValue:'value:Support'});await expect(page.getByRole('link',{name:width===1440?'$50.00':'$100.00',exact:true}).first()).toBeVisible();await shot('recoded-cash-report')
  await page.goto(origin+'/app/sales?tab=deposits')
  const advance=page.locator('form').filter({has:page.getByRole('button',{name:'Record customer deposit',exact:true})})
  await advance.getByLabel('Deposit customer',{exact:true}).selectOption(customer.id);await advance.getByLabel('Date received',{exact:true}).fill('2026-10-10');await advance.getByLabel('Deposit received amount',{exact:true}).fill('20')
  await advance.getByLabel('Bank account received into',{exact:true}).selectOption(bank.id);await advance.getByLabel('Customer deposit liability account',{exact:true}).selectOption(liability.id);await advance.getByLabel('How the deposit was paid',{exact:true}).selectOption('ach');await advance.getByLabel('Deposit reference',{exact:true}).fill(`Cedar advance ${width}`)
  for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await advance.getByLabel(`Advance deposit ${kind}`,{exact:true}).selectOption(name)
  await shot('advance-coded',advance);await submit(advance.getByRole('button',{name:'Record customer deposit',exact:true}),'customer-deposit.record');await expect(page.getByText(`Cedar advance ${width}`,{exact:true})).toBeVisible();await shot('advance-recorded')
  await page.goto(origin+'/app/bank?tab=checks');await page.getByLabel('Check bank account',{exact:true}).selectOption(bank.id)
  const settings=await command('check.settings',{bankAccountId:bank.id,revision:(await view('checks')).profiles.find(p=>p.bank_account_id===bank.id)?.revision,nextNumber:width===1440?1001:2001,stock:'voucher',positivePay:{name:'Juniper bank format',account:'synthetic-pantry-82',columns:['number','amount','date','status'].map(field=>({field,header:field})),header:true,delimiter:',',dateFormat:'YYYY-MM-DD',amountFormat:'decimal',issueCode:'ISSUE',voidCode:'VOID'}})
  await page.reload();await page.getByLabel('Check bank account',{exact:true}).selectOption(bank.id)
  const write=page.getByRole('heading',{name:'Write checks',exact:true}).locator('..').locator('..');await write.getByLabel('Write as',{exact:true}).selectOption('expense');await write.getByLabel('Payee',{exact:true}).selectOption(vendor.id);await write.getByLabel('Expense account',{exact:true}).selectOption(acct['6200']);await write.getByLabel('Check date',{exact:true}).fill('2026-10-12');await write.getByLabel('Expense amount',{exact:true}).fill('12');await write.getByLabel('Expense description',{exact:true}).fill('Coded studio subscription')
  for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await write.getByLabel(`Check ${kind}`,{exact:true}).selectOption(name)
  await shot('check-coded',write);await submit(write.getByRole('button',{name:'Issue checks',exact:true}),'check.issue');await expect(page.getByRole('heading',{name:width===1440?'Checks 1001–1001':'Checks 2001–2001',exact:true})).toBeVisible();await shot('check-issued')
  await page.goto(origin+'/app/sales?tab=estimates');await page.getByRole('button',{name:'Create estimate',exact:true}).click();await page.getByLabel('Customer',{exact:true}).selectOption(customer.id)
  await page.getByLabel('Include a deposit at issue',{exact:true}).check();await page.getByLabel('Deposit at issue amount',{exact:true}).fill('10');await page.getByLabel('Deposit at issue date',{exact:true}).fill('2026-10-01');await page.getByLabel('Deposit-to bank account',{exact:true}).selectOption(bank.id)
  for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await page.getByLabel(`Deposit at issue ${kind}`,{exact:true}).selectOption(name)
  await shot('invoice-deposit-coded',page.getByRole('heading',{name:'Deposit received at invoice issue',exact:true}).locator('..').locator('..'))
  await page.goto(origin+'/app/close?period=2026-10');await page.getByRole('button',{name:'New recognition schedule',exact:true}).click();await page.getByLabel('Schedule type',{exact:true}).selectOption('accrual');await page.getByLabel('Schedule name',{exact:true}).fill(`Studio accrual ${width}`);await page.getByLabel('Balance-sheet account',{exact:true}).selectOption(liability.id);await page.getByLabel('Recognition account',{exact:true}).selectOption(acct['6200']);await page.getByLabel('Amount per month',{exact:true}).fill('10');await page.getByLabel('First accrual month',{exact:true}).fill('2026-10-31')
  for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await page.getByLabel(`Recognition ${kind}`,{exact:true}).selectOption(name)
  await shot('recognition-coded',page.getByRole('heading',{name:'New recognition schedule',exact:true}).locator('..').locator('..'));await submit(page.getByRole('button',{name:'Save recognition schedule',exact:true}),'recognition.save');await expect(page.getByRole('heading',{name:`Studio accrual ${width}`,exact:true})).toBeVisible();await shot('recognition-awaiting-approval')
  await page.goto(origin+'/app/close?period=2026-10');await page.getByRole('button',{name:'New recurring journal',exact:true}).click()
  const template=page.locator('form').filter({has:page.getByRole('button',{name:'Save journal template',exact:true})})
  await template.getByLabel('Template name',{exact:true}).fill(`Studio journal ${width}`);await template.getByLabel('Entry description',{exact:true}).fill('Studio loan interest')
  await template.getByLabel('Line 1 account',{exact:true}).selectOption(acct['6200']);await template.getByLabel('Line 1 debit',{exact:true}).fill('5');await template.getByLabel('Line 2 account',{exact:true}).selectOption(liability.id);await template.getByLabel('Line 2 credit',{exact:true}).fill('5')
  for(const i of [1,2])for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await template.getByLabel(`Line ${i} ${kind}`,{exact:true}).selectOption(name)
  await shot('recurring-journal-coded',template)
  assert.deepEqual(errors,[]);await page.close()
 }
}
