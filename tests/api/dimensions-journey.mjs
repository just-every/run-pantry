import assert from 'node:assert/strict'
import { books, harness } from './harness.mjs'

export async function dimensionsJourney(t) {
 const h=await harness();t.after(()=>h.close())
 const {acct}=await books(h)
 const before=await h.view('dimensions')
 const reader=await h.member('synthetic-pantry-dimension-reader@example.test','viewer')
 await h.command('dimensions.settings',{revision:before.settings.revision,class:true,location:true,project:true},reader,403)
 await h.command('dimensions.settings',{revision:before.settings.revision,class:true,location:true,project:true})
 await h.command('dimensions.settings',{revision:before.settings.revision,class:false},h.owner,409)
 for(const [kind,names] of [['class',['Studio','Support']],['location',['New York','Remote']],['project',['Cedar website','Cypress care']]])for(const name of names)await h.command('dimension.save',{kind,name})
 await h.command('dimension.save',{kind:'class',name:'studio'},h.owner,409)
 await h.command('dimension.require',{accountId:acct['6200'],kinds:['class']})
 const vendor=await h.command('contact.save',{kind:'vendor',name:'Design supplier',email:'synthetic-pantry-vendor@example.test'})
 const customer=await h.command('contact.save',{kind:'customer',name:'Cedar Workshop',email:'synthetic-pantry-customer@example.test'})
 const bank=await h.command('bank-account.save',{name:'Checking',institution:'Synthetic bank',numberLast4:'1234',accountId:acct['1000'],openingDate:'2026-01-01',openingBalance:'0'})
 const tags={className:'Studio',locationName:'New York',projectName:'Cedar website'}
 const billBody={vendorId:vendor.id,reference:'DIM-1',billDate:'2026-09-15',post:true,lines:[{description:'Project software',accountId:acct['6200'],amount:'400'}]}
 const journals=(await h.view('journal')).entries.length
 await h.command('bill.save',billBody,h.owner,409)
 assert.equal((await h.view('journal')).entries.length,journals,'refused bill leaves no posting')
 assert.equal((await h.view('sales')).bills.length,0,'refused bill is atomic')
 const bill=await h.command('bill.save',{...billBody,lines:billBody.lines.map(l=>({...l,...tags}))})
 assert.deepEqual(bill.lines.map(l=>[l.class_name,l.location_name,l.project_name]),[['Studio','New York','Cedar website']])
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-15',lines:[{description:'Website',quantity:'1',rate:'1200',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});const invoice=await h.command('invoice.issue',{id:draft.id})
 assert.equal(invoice.lines[0].class_name,'Studio')
 for(const [direction,id,amount] of [['received',invoice.id,'600'],['paid',bill.id,'200']])await h.command('payment.record',{direction,contactId:direction==='paid'?vendor.id:customer.id,date:'2026-09-20',amount,bankAccountId:bank.id,allocations:[{targetId:id,amount}]})
 const journal=await h.command('journal.save-draft',{date:'2026-09-16',memo:'Remote support project',lines:[{accountId:acct['6200'],debit:'100',className:'Support',locationName:'Remote',projectName:'Cypress care'},{accountId:acct['1000'],credit:'100'}]})
 await h.command('journal.post',{id:journal.id,revision:journal.revision})
 const missing=await h.command('journal.save-draft',{date:'2026-09-17',memo:'Unclassified draft',lines:[{accountId:acct['6200'],debit:'5'},{accountId:acct['1000'],credit:'5'}]})
 await h.command('journal.post',{id:missing.id,revision:missing.revision},h.owner,409)
 await h.command('journal.save-draft',{date:'2026-09-17',memo:'Unknown class',lines:[{accountId:acct['6200'],debit:'5',className:'Unknown'},{accountId:acct['1000'],credit:'5'}]},h.owner,409)
 const journalBeforeRefusal=(await h.view('journal')).entries,issuedJournal=journalBeforeRefusal.find(e=>e.id===invoice.journal_id)
 await h.command('journal.reclassify',{lineIds:[issuedJournal.lines.find(l=>l.account_id===acct['4000']).id],dimensionKind:'class',toDimensionName:'Support'},h.owner,409)
 assert.equal((await h.view('journal')).entries.length,journalBeforeRefusal.length,'refused document recoding adds no entry')
 for(const basis of ['accrual','cash']) {
  const unsplit=await h.view(`reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=${basis}`)
  for(const kind of ['class','location','project']) {
   const r=await h.view(`reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=${basis}&columns=${kind}`)
   for(const row of [...r.rows,...r.totals])assert.equal(row.values.slice(0,-1).reduce((s,n)=>s+n,0),row.values.at(-1))
   assert.equal(r.totals.find(t=>t.id==='income').values.at(-1),unsplit.totalIncome)
   assert.equal(r.totals.find(t=>t.id==='expenses').values.at(-1),unsplit.totalExpenses)
   const studio=r.columns.findIndex(c=>c.label===(kind==='class'?'Studio':kind==='location'?'New York':'Cedar website'))
   assert.equal(r.totals.find(t=>t.id==='net-income').values[studio],basis==='cash'?40000:80000)
   for(const format of ['csv','pdf','xlsx'])assert.equal((await h.send(`/api/pantry/reports/profit-and-loss/export?from=2026-09-01&to=2026-09-30&basis=${basis}&columns=${kind}&format=${format}`,undefined,{cookie:h.owner})).status,200)
  }
 }
 await h.command('discount-settings.save',{discountAccountId:acct['4900']})
 const discountedDraft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-01',lines:[{description:'Studio work',quantity:'1',rate:'1200',accountId:acct['4000'],taxCode:'exempt',...tags},{description:'Support work',quantity:'1',rate:'800',accountId:acct['4000'],taxCode:'exempt',className:'Support',locationName:'Remote',projectName:'Cypress care'}],discounts:[{type:'percent',value:'10'},{type:'amount',value:'100',lines:[2],afterTax:true}]})
 await h.command('invoice.approve',{id:discountedDraft.id,revision:discountedDraft.revision})
 const discounted=await h.command('invoice.issue',{id:discountedDraft.id})
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-02',amount:'850',bankAccountId:bank.id,allocations:[{targetId:discounted.id,amount:'850'}]})
 for(const basis of ['cash','accrual']){
  const split=await h.view(`reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=${basis}&columns=class`),net=split.totals.find(t=>t.id==='net-income')
  for(const [name,expected] of [['Studio',108000],['Support',62000]])assert.equal(net.values[split.columns.findIndex(c=>c.label===name)],basis==='cash'?expected/2:expected,'before/after-tax discounts keep source dimensions on both bases')
 }
 for(const basis of ['cash','accrual'])for(const [kind,value] of [['class','Studio'],['location','New York'],['project','Cedar website']]){
  const query=new URLSearchParams({from:'2026-09-16',to:'2026-09-30',basis,dimension:kind,dimensionValue:'value:'+value})
  const ledger=await h.view('reports/general-ledger?'+query),account=ledger.accounts.find(a=>a.id===acct['6200'])
  assert.equal(account.opening,basis==='cash'?0:40000);assert.equal(account.closing,basis==='cash'?20000:40000)
  assert.ok(ledger.accounts.every(a=>a.rows.every(l=>l[`${kind}_name`]===value)))
  for(const [metric,row] of [['opening',null],['closing',null],...account.rows.map(l=>['running',l])]){
   const line=JSON.stringify([account.id,metric,...(row?[row.id]:[])])
   const detail=await h.view('reports/detail?'+new URLSearchParams({...Object.fromEntries(query),report:'general-ledger',line}))
   assert.equal(detail.ties,true);assert.ok(detail.rows.every(r=>r[`${kind}_name`]===value));assert.equal(detail.context.dimension,kind)
  }
  const trial=await h.view('reports/trial-balance?'+query)
  const trialLine=JSON.stringify([acct['6200'],'debit'])
  assert.equal(trial.rows.find(a=>a.id===acct['6200']).net,account.closing)
  const detail=await h.view('reports/detail?'+new URLSearchParams({...Object.fromEntries(query),report:'trial-balance',line:trialLine}))
  assert.equal(detail.ties,true);assert.equal(detail.figure,account.closing)
  for(const report of ['general-ledger','trial-balance'])for(const format of ['csv','pdf','xlsx']){
   const exported=await h.send(`/api/pantry/reports/${report}/export?${query}&format=${format}`,undefined,{cookie:h.owner})
   assert.equal(exported.status,200)
   if(format==='csv')assert.ok(exported.value.includes(`${kind} · ${value}`),'export states its dimension filter')
  }
 }
 await h.view('reports/general-ledger?from=2026-09-01&to=2026-09-30&dimension=unknown&dimensionValue=unassigned',h.owner,400)
 await h.view('reports/general-ledger?from=2026-09-01&to=2026-09-30&dimension=class&dimensionValue=value:Unknown',h.owner,404)
 await statementDimensions(h,acct,reader)
 const issuedScope=(await h.view('activity')).audit.filter(a=>a.action==='report.issued').map(a=>JSON.parse(a.detail)).filter(a=>['general-ledger','trial-balance'].includes(a.report))
 assert.ok(issuedScope.every(i=>i.dimension&&i.dimensionValue),'issued copies freeze the dimension filter')
 const service=await h.command('item.save',{kind:'service',name:'Design hours',rate:'100',accountId:acct['4000'],taxCategory:'non-taxable'})
 const project=await h.command('time-project.save',{customerId:customer.id,name:'Cedar website'})
 await h.command('time.save',{customerId:customer.id,projectId:project.id,itemId:service.id,date:'2026-09-18',hours:'4'})
 const profit=await h.view('dimensions/project?name=Cedar%20website&from=2026-09-01&to=2026-09-30&basis=accrual')
 assert.deepEqual([profit.income,profit.costs,profit.profit,profit.minutes,profit.unbilledMinutes,profit.unbilledCents],[120000,40000,80000,240,240,40000])
 await h.command('bill.save',{...billBody,reference:'DIM-WRONG-CASE',lines:billBody.lines.map(l=>({...l,...tags,className:'studio'}))},h.owner,409)
 const folded=await h.view('dimensions/project?name=cedar%20website&from=2026-09-01&to=2026-09-30&basis=accrual')
 assert.deepEqual([folded.name,folded.profit],['Cedar website',80000],'project lookup uses the catalogue spelling consistently')
 const creditTags={className:'Support',locationName:'Remote',projectName:'Cypress care'}
 await h.command('vendor-credit.record',{vendorId:vendor.id,reference:'DIM-UNCODED-CREDIT',date:'2026-10-15',amount:'100',accountId:acct['6200']},h.owner,409)
 const credit=await h.command('vendor-credit.record',{vendorId:vendor.id,reference:'DIM-CREDIT',date:'2026-10-15',amount:'100',accountId:acct['6200'],...creditTags,allocations:[{targetId:bill.id,amount:'100'}]})
 assert.deepEqual([credit.class_name,credit.location_name,credit.project_name],Object.values(creditTags))
 for(const basis of ['cash','accrual']){
  const r=await h.view(`reports/profit-and-loss?from=2026-10-15&to=2026-10-15&basis=${basis}&columns=class`),expenses=r.totals.find(t=>t.id==='expenses')
  assert.equal(expenses.values[r.columns.findIndex(c=>c.label==='Support')],-10000,'vendor credit keeps deliberate coding through settlement')
  assert.equal(expenses.values.at(-1),basis==='cash'?0:-10000)
 }
 const recurring={name:'Dimension software renewal',vendorId:vendor.id,startDate:'2026-10-01',endDate:'2026-10-01',unit:'month',every:1,lines:[{description:'Dimension recurring software',accountId:acct['6200'],amount:'25',...tags}]}
 await h.command('recurring-bill.save',{...recurring,lines:recurring.lines.map(({className,...line})=>line)},h.owner,409)
 const template=await h.command('recurring-bill.save',recurring)
 assert.equal(template.lines[0].className,'Studio')
 await h.command('recurring-bill.generate',{through:'2026-10-01'})
 const generated=(await h.view('sales')).bills.find(b=>b.reference==='Dimension software renewal 2026-10-01')
 assert.ok(generated);assert.equal(generated.lines[0].class_name,'Studio')
 await h.command('bill.record',{id:generated.id,revision:generated.revision})
 const postedRecurring=(await h.view('journal')).entries.find(e=>e.source_id===generated.id)
 assert.deepEqual([postedRecurring.lines[0].class_name,postedRecurring.lines[0].location_name,postedRecurring.lines[0].project_name],Object.values(tags))
 await h.command('write-off.bulk',{kind:'bill',ceiling:'30',date:'2026-10-20',accountId:acct['6200'],ids:[generated.id]},h.owner,409)
 await h.command('write-off.bulk',{kind:'bill',ceiling:'30',date:'2026-10-20',accountId:acct['6200'],ids:[generated.id],...creditTags})
 const writtenBill=(await h.view('sales')).vendorCredits.find(c=>c.write_off&&c.allocations.some(a=>a.target_id===generated.id))
 assert.deepEqual([writtenBill.class_name,writtenBill.location_name,writtenBill.project_name],Object.values(creditTags))
 const writtenCustomer=await h.command('contact.save',{kind:'customer',name:'Dimension write-off customer'})
 const smallDraft=await h.command('invoice.save-draft',{customerId:writtenCustomer.id,issueDate:'2026-10-20',lines:[{description:'Small dimension balance',quantity:'1',rate:'50',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 await h.command('invoice.approve',{id:smallDraft.id,revision:smallDraft.revision});await h.command('invoice.issue',{id:smallDraft.id})
 await h.command('write-off.bulk',{kind:'invoice',ceiling:'50',date:'2026-10-21',accountId:acct['6200'],ids:[smallDraft.id],...creditTags})
 const writtenInvoice=(await h.view('sales')).invoices.find(c=>c.write_off&&c.credit_for===smallDraft.id)
 assert.equal(writtenInvoice.lines[0].class_name,'Support')
 const creditEntry=(await h.view('journal')).entries.find(e=>e.id===writtenInvoice.journal_id)
 assert.deepEqual([creditEntry.lines[1].class_name,creditEntry.lines[1].location_name,creditEntry.lines[1].project_name],Object.values(creditTags))
 const settledWriteOff=await h.view('reports/profit-and-loss?from=2026-10-21&to=2026-10-21&basis=cash&columns=class')
 assert.equal(settledWriteOff.totals.find(t=>t.id==='expenses').values[settledWriteOff.columns.findIndex(c=>c.label==='Support')],5000)
 const catalogue=await h.view('dimensions'),studio=catalogue.values.find(v=>v.kind==='class'&&v.name==='Studio')
 await h.command('dimension.save',{...studio,active:false})
 await h.command('bill.save',{...billBody,reference:'DIM-INACTIVE',lines:billBody.lines.map(l=>({...l,...tags}))},h.owner,409)
 const original=await h.view('journal'),posted=original.entries.find(e=>e.id===bill.journal_id)
 const reversed=await h.command('journal.reverse',{id:journal.id,date:'2026-09-22',memo:'Reverse support cost'})
 assert.equal(reversed.lines[0].class_name,'Support')
 assert.equal((await h.view(`reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=accrual&columns=class`)).totals.find(r=>r.id==='expenses').values.at(-1),40000)
 assert.equal(posted.lines.find(l=>l.account_id===acct['6200']).class_name,'Studio','deactivation does not rewrite posted evidence')
 for(const [action,kind] of [['dimensions.settings','dimension-settings'],['dimension.save','dimension'],['dimension.required','account']])assert.ok((await h.view('activity?kind='+kind)).audit.some(a=>a.action===action))
 return {h,acct,tags,invoice,bill,customer,vendor,bank}
}

// All statement variants use the selected line coding, including opening and
// calculated earnings, and carry it through native/scoped reads and evidence.
async function statementDimensions(h,acct,reader) {
 const credential=await h.command('integration.create',{name:'synthetic-pantry-34',scopes:['reports:read']})
 const before=(await h.view('journal')).entries
 for(const basis of ['accrual','cash']) for(const report of ['profit-and-loss','balance-sheet']) {
  const base={from:'2026-09-01',to:'2026-09-30',basis}
  for(const kind of ['class','location','project']) {
   const columns=await h.view(`reports/${report}?`+new URLSearchParams({...base,columns:kind}),reader)
   for(const row of [...columns.rows,...columns.totals]) {
    assert.equal(row.values.slice(0,-1).reduce((a,n)=>a+n,0),row.values.at(-1),`${report} ${basis} ${kind} columns tie`)
    for(const [i,c] of columns.columns.entries()) {
     const q={...base,report,line:row.id,columns:kind,column:c.id}
     const d=await h.view('reports/detail?'+new URLSearchParams(q),reader)
     assert.equal(d.ties,true,JSON.stringify(q));assert.equal(d.figure,row.values[i])
     if(c.id!=='total') assert.ok(d.rows.every(r=>(r[`${kind}_name`]||'')===(c.id==='unassigned'?'':c.id.slice(6))))
    }
   }
   const filters=columns.columns.filter(c=>c.id!=='total')
   for(const c of filters) {
    const filter={dimension:kind,dimensionValue:c.id}
    const single=await h.view(`reports/${report}?`+new URLSearchParams({...base,...filter}),reader)
    const total=report==='profit-and-loss'?single.netIncome:single.totalLiabilities+single.totalEquity
    assert.equal(total,columns.totals.find(r=>r.id===(report==='profit-and-loss'?'net-income':'liabilities-and-equity')).values[columns.columns.indexOf(c)])
    for(const mode of ['prior-period','prior-year','months','quarters','ytd',...(report==='profit-and-loss'?['customer']:[])]) {
     const params=new URLSearchParams({...base,...filter,columns:mode})
     const r=await h.view(`reports/${report}?`+params,reader)
     for(const row of r.totals) for(const [i,column] of r.columns.entries()) {
      if(['months','quarters'].includes(mode)&&i!==0&&!(column.from<='2026-09-30'&&column.to>='2026-09-01'))continue
      const d=await h.view('reports/detail?'+new URLSearchParams({...Object.fromEntries(params),report,line:row.id,column:column.id}),reader)
      assert.equal(d.ties,true,`${report}/${mode}/${row.id}/${column.id}`);assert.equal(d.figure,row.values[i])
     }
     // Scope persists through an integration credential without a session.
     if(c===filters[0]) {
      const scoped=await h.send(`/api/pantry/integration/v1/reports/${report}?${params}`,undefined,{headers:{authorization:`Bearer ${credential.token}`}})
      assert.equal(scoped.status,200);assert.deepEqual(scoped.value,r)
     }
    }
    for(const mode of ['single','prior-period']) for(const format of ['csv','pdf','xlsx']) {
     const exported=await h.send(`/api/pantry/reports/${report}/export?`+new URLSearchParams({...base,...filter,columns:mode,format}),undefined,{cookie:reader})
     assert.equal(exported.status,200);if(format==='csv')assert.ok(exported.value.includes(`${kind} · ${c.label}`),'download identifies the filter')
    }
   }
   const splitExport=await h.send(`/api/pantry/reports/${report}/export?`+new URLSearchParams({...base,columns:kind,format:'csv'}),undefined,{cookie:reader})
   assert.equal(splitExport.status,200);assert.ok(splitExport.value.includes('Unassigned'))
  }
 }
 for(const [line,figure] of [['bridge:accrual',80000],['bridge:recorded',-80000],['bridge:settled',40000],['bridge:cash',40000]]) {
  const d=await h.view('reports/detail?'+new URLSearchParams({report:'profit-and-loss',line,from:'2026-09-01',to:'2026-09-30',basis:'cash',dimension:'class',dimensionValue:'value:Studio'}),reader)
  assert.equal(d.figure,figure);assert.equal(d.ties,true)
 }
 await h.view('reports/balance-sheet?to=2026-09-30&columns=class&dimension=class&dimensionValue=unassigned',h.owner,400)
 await groupedAndCustomDimensions(h,acct,reader)
 assert.deepEqual((await h.view('journal')).entries,before,'dimension statements and exports never alter posted books')
}

async function groupedAndCustomDimensions(h,acct,reader) {
 const from='2026-09-01',to='2026-09-30'
 for(const basis of ['cash','accrual']) {
  const base={from,to,basis},filter={dimension:'class',dimensionValue:'value:Studio'}
  for(const report of ['sales-by-customer','expenses-by-vendor','sales-by-item','transactions','journal']) {
   const unsplit=await h.view(`reports/${report}?`+new URLSearchParams(base),reader)
   const pieces=[]
   for(const name of ['Studio','Support','']) {
    const q={...base,dimension:'class',dimensionValue:name?'value:'+name:'unassigned'}
    const r=await h.view(`reports/${report}?`+new URLSearchParams(q),reader);pieces.push(r)
    const figures=['transactions','journal'].includes(report)?[...r.rows.flatMap(row=>r.moneyColumns.map(i=>[JSON.stringify([row.id,String(i)]),row.cells[i]])),...r.totals.map((t,i)=>[JSON.stringify(['total',String(i)]),t.amount])]:[...r.rows.map(row=>[row.id,row.amount]),['total',r.total]]
    for(const [line,amount] of figures) {
     const d=await h.view('reports/detail?'+new URLSearchParams({...q,report,line}),reader)
     assert.equal(d.figure,amount);assert.equal(d.ties,true);assert.ok(d.rows.every(row=>(row.class_name||'')===name))
    }
    for(const format of ['csv','pdf','xlsx']) {
     const r=await h.send(`/api/pantry/reports/${report}/export?`+new URLSearchParams({...q,format}),undefined,{cookie:reader})
     assert.equal(r.status,200);if(format==='csv')assert.ok(r.value.includes('class · '+(name||'Unassigned')))
    }
   }
   if(['transactions','journal'].includes(report))for(const [i,total] of unsplit.totals.entries())assert.equal(pieces.reduce((n,p)=>n+p.totals[i].amount,0),total.amount)
   else assert.equal(pieces.reduce((n,p)=>n+p.total,0),unsplit.total)
  }
  const definition={name:'synthetic-pantry-34 '+basis,source:'profit-and-loss',...base,filters:filter,layout:[{id:'income',kind:'section',label:'Income',accountTypes:['income']},{id:'expense',kind:'section',label:'Expense',accountTypes:['expense']},{id:'net',kind:'formula',label:'Project margin',expression:'row("income") - row("expense")',unit:'money'}]}
  const saved=await h.command('custom-report.save',{definition,sharedRoles:['viewer']})
  const native=await h.view('reports/profit-and-loss?'+new URLSearchParams({...base,...filter}),reader)
  const rendered=await h.view(`custom-reports/${saved.id}/render`,reader)
  assert.equal(rendered.report.rows.find(r=>r.id==='net').values.amount,native.netIncome)
  const pending=[`custom-reports/${saved.id}/figures?row=net&column=amount`]
  while(pending.length) {
   const d=await h.view(pending.pop(),reader)
   assert.deepEqual(d.context.filters,filter)
   if(d.rows){assert.equal(d.ties,true);assert.ok(d.rows.every(r=>r.class_name==='Studio'))}
   for(const o of d.operands)pending.push(o.href.replace('/api/pantry/',''))
  }
  const split=await h.command('custom-report.save',{definition:{...definition,name:'Split '+basis,filters:{},comparison:'class',allColumns:true},sharedRoles:['viewer']})
  const matrix=(await h.view(`custom-reports/${split.id}/render`,reader)).report
  const nativeMatrix=await h.view('reports/profit-and-loss?'+new URLSearchParams({...base,columns:'class'}),reader)
  const net=matrix.rows.find(r=>r.id==='net')
  for(const [i,c] of nativeMatrix.columns.entries()) {
   assert.equal(net.values[c.id],nativeMatrix.totals.find(r=>r.id==='net-income').values[i])
   const root=await h.view(`custom-reports/${split.id}/figures?row=net&column=${encodeURIComponent(c.id)}`,reader)
   for(const o of root.operands) {
    const d=await h.view(o.href.replace('/api/pantry/',''),reader)
    assert.equal(d.ties,true);if(c.id!=='total')assert.ok(d.rows.every(r=>(r.class_name||'')===(c.id==='unassigned'?'':c.id.slice(6))))
   }
  }
  const pkg=await h.command('management-package.save',{name:'Dimension board '+basis,reportIds:[saved.id,split.id],sharedRoles:['viewer']})
  const packageRender=await h.view(`management-packages/${pkg.id}/render`,reader)
  assert.equal(packageRender.reports[0].report.rows.find(r=>r.id==='net').values.amount,native.netIncome)
  for(const kind of ['custom-reports','management-packages'])for(const format of ['json','csv','pdf','xlsx']) {
   const r=await h.send(`/api/pantry/${kind}/${kind==='custom-reports'?saved.id:pkg.id}/export.${format}`,undefined,{cookie:reader})
   assert.equal(r.status,200);if(format==='csv')assert.ok(r.value.includes('Dimension filter: class · Studio'))
  }
 }
}
