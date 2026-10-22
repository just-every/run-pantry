import assert from 'node:assert/strict'
import {dimensionSeed} from './dimension-extensions.mjs'

export async function dimensionReportSplits(t){
 const {h,acct,tags,other}=await dimensionSeed(t)
 const customer=await h.command('contact.save',{kind:'customer',name:'Cedar Workshop'}),vendor=await h.command('contact.save',{kind:'vendor',name:'Brightline Software'})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-01',lines:[{description:'Design',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...tags},{description:'Support',quantity:'1',rate:'50',accountId:acct['4000'],taxCode:'exempt',...other}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});await h.command('invoice.issue',{id:draft.id})
 await h.command('bill.save',{vendorId:vendor.id,billDate:'2026-10-02',reference:'synthetic-pantry-72',post:true,lines:[{description:'Subscription',amount:'25',accountId:acct['6200'],...tags}]})
 const adjusting=await h.command('journal.save-draft',{date:'2026-12-31',memo:'Annual dimension adjustment',adjusting:true,lines:[{accountId:acct['6200'],debit:'5',...tags},{accountId:acct['3000'],credit:'5',...other}]});await h.command('journal.post',{id:adjusting.id,revision:adjusting.revision})
 const integration=await h.command('integration.create',{name:'synthetic-pantry-73',scopes:['reports:read']})
 const viewer=await h.member('synthetic-pantry-splits@example.test','viewer'),sales=await h.member('synthetic-pantry-sales@example.test','sales')
 const kinds=['adjusting-entries','trial-balance','general-ledger','sales-by-customer','expenses-by-vendor','sales-by-item','cash-flow','sales-tax','receivables','payables','receivables-summary','payables-summary','open-invoices','unpaid-bills','customer-balances','vendor-balances','transactions','journal','deposits','check-detail','reconciliations','contractor-summary']
 for(const basis of ['cash','accrual'])for(const split of ['class','location','project'])for(const kind of kinds){
  const q={from:'2026-10-01',to:'2026-10-31',basis,columns:split},query=new URLSearchParams(q)
  const r=await h.view(`reports/${kind}?${query}`,viewer)
  assert.equal(r.dimension,split);assert.equal(r.basis,r.whole.basis)
  assert.deepEqual(r.whole,await h.view(`reports/${kind}?`+new URLSearchParams({...q,columns:'single'}),viewer))
  for(const section of r.sections)assert.deepEqual(section.report,await h.view(`reports/${kind}?`+new URLSearchParams({...q,columns:'single',dimension:split,dimensionValue:section.scope.id}),viewer))
  if(basis==='accrual'&&split==='class'){const scoped=await h.send(`/api/pantry/integration/v1/reports/${kind}?${query}`,undefined,{headers:{authorization:`Bearer ${integration.token}`}})
  assert.equal(scoped.status,200);assert.deepEqual(scoped.value,r)}
  if(basis==='accrual'&&split==='class')for(const format of ['csv','pdf','xlsx']){
   const file=await h.send(`/api/pantry/reports/${kind}/export?${query}&format=${format}`,undefined,{cookie:viewer});assert.equal(file.status,200)
   if(format==='csv'){assert.ok(file.value.includes('Studio'));assert.ok(file.value.includes('Unassigned'))}
  }
  if(['sales-by-customer','expenses-by-vendor','sales-by-item'].includes(kind))assert.equal(r.rows.find(x=>x.id==='total').values.reduce((n,v)=>n+v,0),r.rows.find(x=>x.id==='total').amount)
 }
 await h.view('reports/audit-log/splits?from=2026-01-01&to=2026-12-31&basis=cash&split=class',sales,403)
 const q='from=2026-01-01&to=2026-12-31&basis=accrual',audit=await h.view('reports/audit-log/splits?'+q+'&split=class',viewer)
 const originalEvent=audit.whole.rows.find(row=>row.cells[2]==='invoice.issue')
 assert.ok(originalEvent)
 for(const name of ['Studio','Support'])assert.ok(audit.sections.find(s=>s.scope.value===name).report.rows.some(row=>row.id===originalEvent.id),'mixed-line event retains each frozen membership')
 // Editing current draft coding never changes the earlier event's memberships.
 const edited=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-10',lines:[{description:'Later draft',quantity:'1',rate:'1',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 const before=await h.view('reports/audit-log?'+q+'&dimension=class&dimensionValue=value:Studio')
 const oldEvent=before.rows.find(row=>row.details.subject_id===edited.id)
 await h.command('invoice.save-draft',{id:edited.id,revision:edited.revision,customerId:customer.id,issueDate:'2026-10-10',lines:[{description:'Later draft changed',quantity:'1',rate:'1',accountId:acct['4000'],taxCode:'exempt',...other}]})
 const retained=await h.view('reports/audit-log?'+q+'&dimension=class&dimensionValue=value:Studio')
 assert.ok(retained.rows.some(row=>row.id===oldEvent.id))
 for(const format of ['csv','pdf','xlsx'])assert.equal((await h.send('/api/pantry/reports/audit-log/export?'+q+'&columns=class&format='+format,undefined,{cookie:viewer})).status,200)
 for(const source of ['trial-balance','sales-by-customer','expenses-by-vendor']){
  const saved=await h.command('custom-report.save',{definition:{name:'Dimension '+source,source,from:'2026-10-01',to:'2026-10-31',basis:'accrual',comparison:'class',allColumns:true}})
  const rendered=await h.view(`custom-reports/${saved.id}/render`)
  const columns=rendered.report.columns
  assert.ok(columns.some(c=>c.id==='value:Studio'));assert.ok(columns.some(c=>c.id==='unassigned'))
  for(const row of rendered.report.rows)if(row.values.total!==undefined)assert.equal(columns.filter(c=>c.id.startsWith('value:')||c.id==='unassigned').reduce((n,c)=>n+(row.values[c.id]??0),0),row.values.total)
 }
 for(const split of ['class','location','project']){
  const query=new URLSearchParams({name:'Cedar',from:'2026-10-01',to:'2026-10-31',basis:'accrual',split}),r=await h.view('dimensions/project/splits?'+query)
  for(const row of r.rows)assert.equal(row.values.reduce((n,v)=>n+v,0),row.amount)
  for(const section of r.sections)for(const row of section.figures){const detail=await h.view('reports/detail?'+new URLSearchParams({report:'project-profitability',projectName:'Cedar',from:'2026-10-01',to:'2026-10-31',basis:'accrual',dimension:split,dimensionValue:section.scope.id,line:row.id}));assert.equal(detail.ties,true);assert.equal(detail.figure,row.amount)}
 }
 const aq={from:'2026-01-01',to:'2026-12-31',basis:'accrual',columns:'class'},adjusted=await h.view('reports/adjusting-entries?'+new URLSearchParams(aq))
 assert.ok(adjusted.rows.length)
 for(const section of adjusted.sections)for(const row of section.figures){const detail=await h.view('reports/detail?'+new URLSearchParams({...aq,report:'adjusting-entries',dimension:'class',dimensionValue:section.scope.id,line:row.id,columns:'single'}));assert.equal(detail.ties,true);assert.equal(detail.figure,row.amount)}
 const budget=await h.command('budget.save',{name:'Cedar annual plan',startMonth:'2026-01',basis:'accrual',cells:[{accountId:acct['4000'],month:'2026-10',amount:'120',...tags},{accountId:acct['6200'],month:'2026-10',amount:'30',...other}]})
 for(const split of ['class','location']){
  const query=new URLSearchParams({from:'2026-10-01',to:'2026-10-31',basis:'accrual',split}),r=await h.view(`budgets/${budget.id}/splits?${query}`)
  for(const row of r.rows)assert.equal(row.values.reduce((n,v)=>n+v,0),row.amount)
  assert.equal((await h.send(`/api/pantry/budgets/${budget.id}/splits/export?${query}`,undefined,{cookie:viewer})).status,200)
 }
}
