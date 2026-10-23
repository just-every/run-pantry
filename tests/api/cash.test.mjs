import test from 'node:test'
import assert from 'node:assert/strict'
import { books,harness } from './harness.mjs'

test('CASH-001 weekly source items tie, customer medians set dates and what-if work never posts',async t=>{
 const h=await harness({bindings:{GUSTO_CLIENT_ID:'synthetic-pantry-1',GUSTO_CLIENT_SECRET:'synthetic-pantry-2',GUSTO_ENV:'demo'},outbound:async request=>{
  const url=new URL(request.url);assert.equal(url.origin,'https://api.gusto-demo.com')
  if(url.pathname==='/oauth/token')return Response.json({access_token:'synthetic-pantry-3',refresh_token:'synthetic-pantry-4',expires_in:3600})
  if(url.pathname==='/v1/token_info')return Response.json({scope:'companies:read payrolls:read',resource:{type:'Company',uuid:'synthetic-pantry-5'}})
  if(url.pathname==='/v1/companies/synthetic-pantry-5')return Response.json({uuid:'synthetic-pantry-5',name:'synthetic-pantry-6'})
  if(url.pathname==='/v1/companies/synthetic-pantry-5/payrolls'){
   if(url.searchParams.get('processing_statuses')!=='unprocessed')return Response.json([])
   assert.equal(url.searchParams.get('include'),'totals')
   return Response.json([{uuid:'synthetic-pantry-7',check_date:'2027-03-13',processed:false,totals:{gross_pay:'1000.00',net_pay:'800.00',employee_taxes:'200.00',employer_taxes:'100.00',tax_debit:'300.00',net_pay_debit:'800.00',company_debit:'1100.00'}}])
  }
  assert.fail('Unexpected provider endpoint: '+url.pathname)
 }});t.after(()=>h.close())
 const {acct}=await books(h),bank=await h.command('bank-account.save',{name:'synthetic-pantry-8',institution:'synthetic-pantry-9',accountId:acct['1000'],numberLast4:'4821',openingDate:'2025-01-01',openingBalance:'0'})
 const customer=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-10',termsDays:30}),second=await h.command('contact.save',{kind:'customer',name:'synthetic-pantry-11',termsDays:30}),vendor=await h.command('contact.save',{kind:'vendor',name:'synthetic-pantry-12',termsDays:0})
 const invoice=async(customerId,date,amount='100.00')=>{const i=await h.command('invoice.save-draft',{customerId,issueDate:date,lines:[{description:'synthetic-pantry-13',quantity:'1',rate:amount,accountId:acct['4000'],taxCode:'exempt'}]});await h.command('invoice.approve',{id:i.id,revision:i.revision});await h.command('invoice.issue',{id:i.id});return i}
 for(const [contact,days] of [[customer,[20,30,46]],[second,[10,20]]])for(const [index,n] of days.entries()){
  const issue=`2026-${String(8+index).padStart(2,'0')}-01`,paid=new Date(Date.parse(issue+'T00:00:00Z')+n*86400000).toISOString().slice(0,10),i=await invoice(contact.id,issue)
  await h.command('payment.record',{direction:'received',contactId:contact.id,date:paid,amount:'100.00',bankAccountId:bank.id,allocations:[{targetId:i.id,amount:'100.00'}]})
 }
 const first=await invoice(customer.id,'2027-03-01','1000.00'),other=await invoice(second.id,'2027-03-01','2000.00')
 const bill=await h.command('bill.save',{vendorId:vendor.id,reference:'synthetic-pantry-14',billDate:'2027-03-01',dueDate:'2027-03-20',post:true,evidenceWaived:'synthetic-pantry-15',lines:[{description:'synthetic-pantry-16',accountId:acct['6200'],amount:'300.00'}]})
 await h.command('bill.schedule',{id:bill.id,revision:bill.revision,date:'2027-03-10'})
 const recurring=await h.command('recurring.save',{customerId:second.id,startDate:'2027-04-01',endDate:'2027-04-01',unit:'month',every:1,mode:'draft',termsDays:0,lines:[{description:'synthetic-pantry-17',quantity:'1',rate:'50.00',accountId:acct['4000'],taxCode:'exempt'}]})
 await h.command('recurring-bill.save',{vendorId:vendor.id,name:'synthetic-pantry-18',startDate:'2027-04-02',endDate:'2027-04-02',unit:'month',every:1,termsDays:0,lines:[{description:'synthetic-pantry-19',accountId:acct['6200'],amount:'25.00'}]})
 const auth=await h.command('gusto.connect',{}),state=new URL(auth.url).searchParams.get('state')
 assert.equal((await h.send('/api/pantry/gusto/callback?code=synthetic-pantry-20&state='+state,undefined,{cookie:h.owner})).status,303)
 const before=await h.view('reports/trial-balance?to=2027-05-31&basis=accrual')
 const view=await h.view('cash-planner?asOf=2027-03-01'),items=view.weeks.flatMap(w=>w.items)
 assert.equal(view.weeks.length,13);assert.equal(items.find(i=>i.id===first.id).date,'2027-03-31');assert.equal(items.find(i=>i.id===other.id).date,'2027-03-31')
 assert.match(items.find(i=>i.id===first.id).reason,/median 30 days/);assert.match(items.find(i=>i.id===other.id).reason,/fewer than three/)
 assert.equal(items.find(i=>i.id===bill.id).date,'2027-03-10')
 assert.equal(items.find(i=>i.kind==='payroll').amount,-110000)
 assert.equal(items.find(i=>i.kind==='recurring-invoice').amount,5000);assert.equal(items.find(i=>i.kind==='recurring-bill').amount,-2500)
 let running=view.opening
 for(const week of view.weeks){assert.equal(week.opening,running);assert.equal(week.change,week.items.reduce((n,i)=>n+i.amount,0));running+=week.change;assert.equal(week.closing,running)}
 const scenario=await h.view('cash-planner?'+new URLSearchParams({asOf:'2027-03-01',whatIf:JSON.stringify([{label:'synthetic-pantry-21',date:'2027-03-01',amount:'-15000.00'}])}))
 assert.ok(scenario.lowWeeks.includes('2027-03-01'));assert.equal(scenario.weeks[0].closing,view.weeks[0].closing-1500000)
 assert.deepEqual(await h.view('reports/trial-balance?to=2027-05-31&basis=accrual'),before)
 const sales=await h.member('synthetic-pantry-22@example.test','sales');await h.view('cash-planner',sales,403)
 await h.view('cash-planner?whatIf=%7Bbad',undefined,400)
})
