import assert from 'node:assert/strict'
import {mkdir} from 'node:fs/promises'
import {chromium} from '@playwright/test'
import {worker,TOKEN} from './worker.mjs'

export async function erasureJourney(t) {
  const app=await worker();t.after(()=>app.close())
  const browser=await chromium.launch({headless:true,args:['--use-mock-keychain','--password-store=basic']});t.after(()=>browser.close())
  const dir=process.env.PANTRY_SCREENSHOTS??'/tmp/sx-pantry-c29';await mkdir(dir,{recursive:true})
  for(const width of [1440,390]) {
    const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage()
    if(width===1440) {
      assert.equal((await context.request.post(app.origin+'/auth/bootstrap',{headers:{origin:app.origin},data:{token:TOKEN,displayName:'Olivia Owner'},maxRedirects:0})).status(),303)
      assert.equal((await context.request.post(app.origin+'/setup',{headers:{origin:app.origin},form:{confirm:'yes'},maxRedirects:0})).status(),303)
    } else {
      await context.addCookies(await browser.contexts()[0].cookies())
    }
    const cmd=async(op,data)=>{const r=await context.request.post(app.origin+'/api/pantry/command/'+op,{headers:{origin:app.origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
    if(width===1440) {
      await cmd('entity.save',{legalName:'Cedar Studio LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2010-01-01',policies:''});await cmd('chart.start',{})
      const state=await(await context.request.get(app.origin+'/api/pantry/state')).json(),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
      const bank=await cmd('bank-account.save',{name:'Operating checking',institution:'Community Bank',accountId:acct['1000'],numberLast4:'4821',openingDate:'2010-01-01',openingBalance:'0'})
      for(const w of [1440,390]) {
        const c=await cmd('contact.save',{kind:'customer',name:`Cedar Studio ${w}`,email:`cedar-${w}@example.test`,phone:'555-0198',billingAddress:'18 Cedar Lane',internalNotes:'Please use the side entrance'})
        let i=await cmd('invoice.save-draft',{customerId:c.id,issueDate:'2018-09-01',lines:[{description:'Design consultation',quantity:'1',rate:'100.00',accountId:acct['4000'],taxCode:'exempt'}]})
        await cmd('invoice.approve',{id:i.id,revision:i.revision});i=await cmd('invoice.issue',{id:i.id})
        await cmd('payment.record',{direction:'received',contactId:c.id,date:'2018-09-05',amount:'100.00',bankAccountId:bank.id,allocations:[{targetId:i.id,amount:'100.00'}]})
        await cmd('contact.save',{kind:'customer',name:`Unconverted enquiry ${w}`,email:`enquiry-${w}@example.test`})
      }
    }
    const errors=[];page.on('pageerror',e=>errors.push(String(e)))
    await page.goto(app.origin+'/app/settings')
    await page.getByRole('heading',{name:'Erase personal data',exact:true}).waitFor()
    const subject=page.getByLabel('Person or contact',{exact:true})
    await subject.selectOption({label:`Cedar Studio ${width} · customer`})
    await page.getByRole('button',{name:'Preview erasure',exact:true}).click()
    await page.getByRole('heading',{name:`Erasure preview · Cedar Studio ${width}`}).waitFor()
    const privacy=page.getByRole('heading',{name:'Erase personal data',exact:true}).locator('../..')
    await privacy.screenshot({path:`${dir}/erasure-preview-${width}.png`})
    await page.getByLabel('Requester',{exact:true}).fill('customer-request@example.test')
    await page.getByLabel('Request channel',{exact:true}).selectOption('email')
    await page.getByLabel('Reason for erasure',{exact:true}).fill('The former customer asked us to remove contact details.')
    await page.getByLabel('Type ERASE to confirm',{exact:true}).fill('ERASE')
    await page.getByRole('button',{name:'Erase personal data',exact:true}).click()
    await page.getByRole('heading',{name:/Erasure receipt/}).waitFor()
    await page.getByRole('heading',{name:'Ready to erase',exact:true}).waitFor()
    await privacy.screenshot({path:`${dir}/erasure-receipt-${width}.png`})
    await page.getByLabel('Retention in whole years').fill('10')
    await page.getByRole('button',{name:'Save retention period'}).click()
    await page.getByText('No expired items awaiting confirmation.',{exact:true}).waitFor()
    await page.getByLabel('Retention in whole years').fill('1')
    await page.getByRole('button',{name:'Save retention period'}).click()
    await page.getByText(/IRS Publication 583/).waitFor()
    const retention=page.getByRole('heading',{name:'Retention and ready to erase',exact:true}).locator('../..')
    await retention.screenshot({path:`${dir}/retention-ready-${width}.png`})
    await page.getByLabel('Type ERASE for expired items').fill('ERASE')
    await page.getByRole('button',{name:'Confirm expired items'}).click()
    await page.getByText('No expired items awaiting confirmation.',{exact:true}).waitFor()
    await retention.screenshot({path:`${dir}/retention-erased-${width}.png`})
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true)
    await page.goto(app.origin+'/app/activity')
    await page.getByRole('heading',{name:'Activity',exact:true}).first().waitFor()
    const marker=page.getByText(/values removed by erasure/).first()
    await page.getByText('Inspect history',{exact:true}).first().waitFor()
    await marker.locator('..').locator('summary').click()
    await marker.waitFor()
    await marker.locator('..').screenshot({path:`${dir}/activity-erased-${width}.png`})
    assert.deepEqual(errors,[])
    // Keep the first native context solely for the second viewport's test session.
    if(width===390)await context.close()
  }
}
