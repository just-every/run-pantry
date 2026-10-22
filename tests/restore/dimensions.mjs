import assert from 'node:assert/strict'

export async function dimensionsForRestore(context,origin){
 const command=async(op,data,status=200)=>{const r=await context.request.post(origin+'/api/pantry/command/'+op,{headers:{origin},data});assert.equal(r.status(),status,await r.text());return r.json()}
 const view=async(path)=>{const r=await context.request.get(origin+'/api/pantry/'+path);assert.equal(r.status(),200,await r.text());return r.json()}
 const state=await view('state'),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 await command('dimensions.settings',{revision:state.dimensions.settings.revision,class:true,location:true,project:true})
 const values=[]
 for(const [kind,name] of [['class','Archive studio'],['class','Archive retired class'],['location','Archive New York'],['project','Archive project']])values.push(await command('dimension.save',{kind,name}))
 await command('dimension.require',{accountId:acct['6200'],kinds:['class']})
 const tags={className:'Archive studio',locationName:'Archive New York',projectName:'Archive project'}
 const journal=await command('journal.save-draft',{date:'2026-09-19',memo:'Archived dimension coding',lines:[{accountId:acct['6200'],debit:'50',...tags},{accountId:acct['1000'],credit:'50'}]})
 await command('journal.post',{id:journal.id,revision:journal.revision})
 const retired=values.find(v=>v.name==='Archive retired class')
 const historical=await command('journal.save-draft',{date:'2026-09-20',memo:'Historical dimension coding',lines:[{accountId:acct['6200'],debit:'10',...tags,className:retired.name},{accountId:acct['1000'],credit:'10'}]})
 await command('journal.post',{id:historical.id,revision:historical.revision})
 await command('dimension.save',{...retired,active:false})
 await command('dimension.payroll',{role:'wages',...tags})
 await command('dimension.processor',{role:'fees',...tags})
 const plan=await command('budget.save',{name:'Archived dimension budget',startMonth:'2026-01',cells:[{accountId:acct['6200'],month:'2026-09',amount:'75',...tags}]})
 const vendor=await command('contact.save',{kind:'vendor',name:'Archive Dimension Vendor',defaultClass:tags.className,defaultLocation:tags.locationName,defaultProject:tags.projectName})
 const credit=await command('vendor-credit.record',{vendorId:vendor.id,reference:'Archived coded credit',date:'2026-09-21',amount:'10',accountId:acct['6200'],...tags})
 const recurring=await command('recurring-bill.save',{vendorId:vendor.id,name:'Archived coded renewal',startDate:'2027-01-01',unit:'month',every:1,lines:[{description:'Archive recurring coding',accountId:acct['6200'],amount:'25',...tags}]})
 return {credit,recurring,vendorDefaults:[vendor.default_class,vendor.default_location,vendor.default_project],dimensions:await view('dimensions'),plan,expenseAccount:acct['6200'],vendor:vendor.id,journal:journal.id,historical:historical.id}
}
export async function assertDimensionsRestored(context,origin,expected){
 const get=async(path)=>{const r=await context.request.get(origin+'/api/pantry/'+path);assert.equal(r.status(),200,await r.text());return r.json()}
 assert.deepEqual(await get('dimensions'),expected.dimensions,'enabled settings, catalogue, requirements and payroll/processor mapping survive native restore')
 assert.deepEqual(await get(`budgets/${expected.plan.id}`),expected.plan,'detailed dimension budget cells and rollups survive restore')
 const state=await get('state'),vendor=state.contacts.find(c=>c.id===expected.vendor)
 assert.deepEqual([vendor.default_class,vendor.default_location,vendor.default_project],expected.vendorDefaults)
 const sales=await get('sales')
 assert.deepEqual(sales.vendorCredits.find(c=>c.id===expected.credit.id),expected.credit,'coded vendor credit survives restore')
 const recurring=sales.recurringBills.find(r=>r.id===expected.recurring.id)
 assert.deepEqual(recurring.lines,expected.recurring.lines,'future recurring bill keeps dimension coding')
 const entries=(await get('journal')).entries
 assert.equal(entries.find(e=>e.id===expected.journal).lines[0].class_name,'Archive studio')
 assert.equal(entries.find(e=>e.id===expected.historical).lines[0].class_name,'Archive retired class','inactive historical coding is preserved')
 const refused=await context.request.post(origin+'/api/pantry/command/bill.save',{headers:{origin},data:{vendorId:expected.vendor,reference:'Archive required-dimension probe',billDate:'2026-09-20',lines:[{description:'Unclassified bill',amount:'1',accountId:expected.expenseAccount}]}})
 assert.equal(refused.status(),409,'restored required-account policy still refuses an unclassed bill')
}
