import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium,expect} from '@playwright/test'
import {reportDeliverySeed} from './report-delivery-seed.mjs'

export async function reportDeliveryBrowser(t){
 const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
 const {app,origin,owner,accountant,command,view,mail,budget,pkg}=await reportDeliverySeed(t,browser)
 const proof=process.env.PANTRY_EVIDENCE_DIR||'/tmp/pantry-report-delivery';await mkdir(proof,{recursive:true})
 for(const width of [1440,390]){
  const page=await owner.newPage();await page.setViewportSize({width,height:1000});const errors=[];page.on('pageerror',e=>errors.push(String(e)))
  const shot=async name=>{assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,`${name} fits ${width}`);await page.screenshot({path:`${proof}/delivery-${name}-${width}.png`,fullPage:true})}
  const submit=async(label,op)=>{const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/pantry/command/'+op&&r.request().method()==='POST');await page.getByRole('button',{name:label,exact:true}).click();assert.equal((await response).status(),200)}
  const report=async(kind,extra={})=>page.goto(origin+'/app/reports?'+new URLSearchParams({report:kind,from:'2026-10-01',to:'2026-10-31',basis:'cash',...extra}))
  const download=async name=>{const file=page.waitForEvent('download');await page.getByRole('link',{name,exact:true}).click();const d=await file;assert.equal(await d.failure(),null);return d}
  await report('cash-flow');await download('Cash-flow Excel');await shot('cash-flow-exports')
  await report('receivables');await download('Download PDF');await shot('ageing-exports')
  await report('budget-actual',{budget:budget.id});await download('Download budget Excel · cash');await shot('budget-exports');await report('budget-actual',{budget:budget.id,split:'class'});await download('Download budget split Excel');await shot('budget-split-exports')
  await report('project-profitability',{projectName:'Cedar'});await download('Project Excel · cash');await shot('project-exports')
  await report('adjusting-entries',{to:'2026-12-31'});await download('Download Excel · cash');await shot('adjusting-exports')
  await report('contractors',{year:'2025'});await download('Contractor review Excel');await download('Filing data PDF');await shot('contractor-exports')
  await page.getByText('Accountant package formats · October 2026',{exact:true}).click();await download('Close package Excel · cash');await shot('close-package-exports')
  await report('delivery');await expect(page.getByRole('heading',{name:'Report schedules',exact:true})).toBeVisible()
  const lender=`synthetic-pantry-lender-${width}@example.test`
  await page.getByLabel('Outside email address',{exact:true}).fill(lender);await page.getByLabel('Reason for outside report access',{exact:true}).fill('October lender reporting approved by owner');await submit('Allow report recipient','report-recipient.allow')
  await page.getByRole('button',{name:'New report schedule',exact:true}).click()
  await page.getByLabel('Schedule name',{exact:true}).fill(`Cedar lender ${width}`);await page.getByLabel('Report or package',{exact:true}).selectOption('management-package');await page.getByLabel('Saved report or package',{exact:true}).selectOption(pkg.id)
  await page.getByLabel('Delivery format',{exact:true}).selectOption('pdf');await page.getByLabel('Delivery frequency',{exact:true}).selectOption('month-lock');await page.getByLabel('Report dates',{exact:true}).selectOption('occurrence');await page.getByLabel('Delivery recipients',{exact:true}).fill(lender);await page.getByLabel('Enable this schedule',{exact:true}).check();await page.getByLabel(/I approve emailing this selected report/).check();await shot('consented-schedule')
  await submit('Save report schedule','report-schedule.save');await expect(page.getByRole('button',{name:`Disable Cedar lender ${width}`,exact:true})).toBeVisible();await shot('schedule-enabled')
  if(width===390){const requested=await command('period.request-reopen',{period:'2026-10',reason:'Accountant reviewed a second report delivery'},accountant);await command('period.decide-reopen',{id:requested.requests.find(r=>r.status==='pending').id,decision:'approve',note:'Owner approved reopening'})}
  const close=await command('close.tasks',{period:'2026-10'});for(const task of close.tasks)if(task.status!=='done')await command('close.task',{id:task.id,revision:task.revision,done:true})
  await page.goto(origin+'/app/close?period=2026-10');await expect(page.getByRole('button',{name:'Lock October 2026',exact:true})).toBeEnabled();await submit('Lock October 2026','period.lock');await app.cron()
  await report('delivery');const deliveries=(await view('report-delivery')).history.filter(d=>d.recipient===lender);assert.equal(deliveries.length,1);assert.equal(deliveries[0].status,'accepted')
  const original=page.locator(`a[href="/api/pantry/report-delivery/${deliveries[0].id}/attachment"]`);await expect(original).toBeVisible();const originalDownload=page.waitForEvent('download');await original.click();assert.equal(await (await originalDownload).failure(),null);await shot('delivery-recorded')
  assert.ok(mail.some(m=>[m.to].flat().includes(lender)&&m.attachments?.length===1))
  await submit(`Disable Cedar lender ${width}`,'report-schedule.disable');await expect(page.getByRole('button',{name:`Disable Cedar lender ${width}`,exact:true})).toHaveCount(0);await shot('schedule-disabled')
  assert.deepEqual(errors,[]);await page.close()
 }
}
