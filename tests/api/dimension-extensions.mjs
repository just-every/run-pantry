import assert from 'node:assert/strict'
import {books,harness} from './harness.mjs'

async function seed(t,options={}){
 const h=await harness(options);t.after(()=>h.close());const {acct}=await books(h)
 const settings=(await h.view('dimensions')).settings
 await h.command('dimensions.settings',{revision:settings.revision,class:true,location:true,project:true})
 for(const [kind,names] of [['class',['Studio','Support']],['location',['New York','Remote']],['project',['Cedar','Cypress']]])for(const name of names)await h.command('dimension.save',{kind,name})
 const bank=await h.command('bank-account.save',{name:'Checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'3131',openingDate:'2026-01-01',openingBalance:'0'})
 return {h,acct,bank,tags:{className:'Studio',locationName:'New York',projectName:'Cedar'},other:{className:'Support',locationName:'Remote',projectName:'Cypress'}}
}
async function lines(h,bank,rows,name='synthetic-pantry-61'){
 await h.command('statement.import',{bankAccountId:bank.id,fileName:name+'.csv',content:'Posting Date,Description,Amount\n'+rows.map(([date,description,amount])=>`${date},${description},${amount}`).join('\n'),opening:'0',closing:rows.reduce((s,r)=>s+Number(r[2]),0).toFixed(2),start:'2026-11-01',end:'2026-11-30',confirmLast4:'3131'})
 return (await h.view('bank/lines')).lines
}
export async function dimensionRules(t){
 const {h,acct,bank,tags,other}=await seed(t)
 const imported=await lines(h,bank,Array.from({length:7},(_,i)=>[`11/${String(i+1).padStart(2,'0')}/2026`,'Dimension routine',-10]))
 for(const [i,l] of imported.entries())await h.command('bank-line.dimensions',{id:l.id,...(i<6?tags:other)})
 const body={name:'Dimension review',descriptionContains:'Dimension routine',direction:'out',accountId:acct['6200'],priority:0,mode:'suggest',dimensionConditions:tags,dimensionActions:other}
 const preview=await h.command('bank-rule.preview',body)
 assert.equal(preview.suggested.length,6);assert.equal(preview.earlier.length,6)
 const suggestion=await h.command('bank-rule.save',{...body,fileExisting:true});assert.equal(suggestion.filed,0)
 const automatic=await h.command('bank-rule.save',{...body,name:'Dimension automatic',priority:1,mode:'automatic',fileExisting:true});assert.equal(automatic.filed,0)
 await h.command('bank-rule.retire',{id:suggestion.rule.id,revision:suggestion.rule.revision})
 const saved=await h.command('bank-rule.save',{...body,name:'Dimension automatic',id:automatic.rule.id,revision:automatic.rule.revision,mode:'automatic',fileExisting:true})
 assert.equal(saved.filed,6)
 const queue=await h.view('bank/lines'),filed=queue.lines.filter(l=>l.rule_id===automatic.rule.id)
 assert.equal(filed.length,6)
 for(const line of filed){assert.deepEqual(line.rule_snapshot.dimension_conditions,tags);assert.deepEqual(line.rule_snapshot.dimension_actions,other)}
 const postings=(await h.view('journal')).entries.filter(e=>e.memo.includes('by rule Dimension automatic'))
 assert.equal(postings.length,6)
 assert.ok(postings.every(e=>e.lines.filter(l=>l.account_id===acct['6200']).every(l=>l.class_name==='Support'&&l.location_name==='Remote'&&l.project_name==='Cypress')))
 const earlierRevision=filed[0].rule_revision
 await h.command('bank-rule.save',{...body,name:'Dimension automatic',id:saved.rule.id,revision:saved.rule.revision,mode:'automatic',dimensionActions:tags})
 assert.equal((await h.view('bank/lines')).lines.find(l=>l.id===filed[0].id).rule_revision,earlierRevision)
 await h.command('bank-line.dimensions',{id:filed[0].id,...tags},h.owner,409)
 const undo=await h.command('bank-rule.undo',{matchId:filed[0].match_id})
 const reversal=(await h.view('journal')).entries.find(e=>e.id===undo.reversal)
 assert.equal(reversal.lines.find(l=>l.account_id===acct['6200']).class_name,'Support')
 // A linked dimension correction preserves its source lines and trial balance.
 const original=postings[1],expense=original.lines.find(l=>l.account_id===acct['6200']),before=(await h.view('reports/trial-balance?to=2026-11-30')).rows
 const moved=await h.command('journal.reclassify',{lineIds:[expense.id],dimensionKind:'class',toDimensionName:'Studio',memo:'Correct project class'})
 const after=(await h.view('journal')).entries,correction=after.find(e=>e.id===moved.reclassified[0].correcting_entry_id)
 assert.deepEqual(correction.lines.map(l=>[l.class_name,l.debit_cents,l.credit_cents]),[['Studio',1000,0],['Support',0,1000]])
 const actualOriginal=after.find(e=>e.id===original.id).lines
 assert.equal(actualOriginal.find(l=>l.id===expense.id).reclassified_by,correction.id)
 const stored=rows=>rows.map(({reclassified_by,...row})=>row)
 assert.deepEqual(stored(actualOriginal),stored(original.lines),'original postings stay unchanged')
 const balances=rows=>rows.map(({id,net,debitBalance,creditBalance})=>({id,net,debitBalance,creditBalance}))
 assert.deepEqual(balances((await h.view('reports/trial-balance?to=2026-11-30')).rows),balances(before))
 await h.command('journal.reclassify',{lineIds:[expense.id],dimensionKind:'class',toDimensionName:'Studio'},h.owner,409)
}
export async function dimensionSuggestions(t){
 let answer={receipt:true,vendor:'Paper merchant',date:'2026-11-07',total:'10.00',tax:'0.00',currency:'USD',category:'6200',note:''}
 const {h,acct,bank,tags,other}=await seed(t,{outbound:async request=>{
  assert.equal(new URL(request.url).hostname,'api.anthropic.com')
  return Response.json({id:'synthetic-pantry-63',type:'message',role:'assistant',content:[{type:'text',text:JSON.stringify(answer)}],stop_reason:'end_turn'})
 }})
 const vendor=await h.command('contact.save',{kind:'vendor',name:'Dimension supplier',defaultAccountId:acct['6200'],defaultClass:'Support',defaultLocation:'Remote',defaultProject:'Cypress'})
 const imported=await lines(h,bank,[['11/01/2026',vendor.name,-10],['11/02/2026',vendor.name,-10],['11/03/2026',vendor.name,-10],['11/07/2026','Paper merchant',-10]])
 const byDate=date=>imported.find(l=>l.posted_date===date)
 const file=async(line,dimensions)=>h.command('match.approve',{bankLineIds:[line.id],create:[{type:'fee',direction:'out',amount:'10',accountId:acct['6200'],contactId:vendor.id,...dimensions}]})
 let q=await h.view('bank/lines');assert.deepEqual(q.suggestions[byDate('2026-11-01').id].dimensions,other)
 await file(byDate('2026-11-01'),other)
 q=await h.view('bank/lines');assert.equal(q.suggestions[byDate('2026-11-02').id].source,'history')
 await file(byDate('2026-11-02'),tags)
 q=await h.view('bank/lines');assert.deepEqual(q.suggestions[byDate('2026-11-03').id].dimensions,tags)
 const preview=await h.command('bank-queue.preview',{ids:[byDate('2026-11-03').id]})
 await h.command('bank-queue.accept',{items:preview.items.map(i=>({id:i.id,fingerprint:i.fingerprint}))})
 const history=q.suggestionRates.find(r=>r.source==='history')
 assert.equal(history.changed,1,'same account/payee with changed dimensions is a changed decision')
 q=await h.view('bank/lines');assert.deepEqual([q.suggestionRates.find(r=>r.source==='history').accepted,q.suggestionRates.find(r=>r.source==='history').changed],[1,1])
 await h.command('reader.save',{provider:'anthropic',model:'claude-sonnet-5-5',key:'synthetic-pantry-64'})
 const form=new FormData();form.set('file',new Blob([Buffer.from([0xff,0xd8,0xff,0xe0,1])],{type:'image/jpeg'}),'synthetic-pantry-64.jpg')
 const capture=await fetch(h.origin+'/api/pantry/receipts/capture',{method:'POST',headers:{origin:h.origin,cookie:h.owner},body:form});assert.equal(capture.status,200)
 const captured=await capture.json(),receipt=(await h.view('receipts')).review.find(r=>r.id===captured.id)
 await h.command('receipt.dimensions',{id:receipt.id,revision:receipt.revision,...tags})
 q=await h.view('bank/lines');const document=q.suggestions[byDate('2026-11-07').id]
 assert.equal(document.source,'document');assert.deepEqual(document.dimensions,tags)
 await h.command('match.approve',{bankLineIds:[byDate('2026-11-07').id],create:[{type:'fee',amount:'10',accountId:acct['6200'],...other}]})
 q=await h.view('bank/lines');assert.equal(q.suggestionRates.find(r=>r.source==='document').changed,1)
}
export async function dimensionBudgets(t){
 const {h,acct,tags,other}=await seed(t)
 for(const [account,amount,dims,side] of [[acct['4000'],'200',other,'credit'],[acct['6200'],'50',tags,'debit']]){
  const journal=await h.command('journal.save-draft',{date:'2026-09-15',memo:'Dimension budget actual',lines:[{accountId:account,[side]:amount,...dims},{accountId:acct['1000'],[side==='debit'?'credit':'debit']:amount}]});await h.command('journal.post',{id:journal.id,revision:journal.revision})
 }
 const cells=[{accountId:acct['4000'],month:'2026-09',amount:'1000',...tags},{accountId:acct['4000'],month:'2026-09',amount:'500',...other},{accountId:acct['6200'],month:'2026-09',amount:'400',...tags},{accountId:acct['6200'],month:'2026-09',amount:'100',...other}]
 const plan=await h.command('budget.save',{name:'Dimension plan',startMonth:'2026-01',cells})
 assert.equal(plan.cells.length,4)
 for(const basis of ['cash','accrual'])for(const dimension of ['class','location']){
  const query=`from=2026-09-01&to=2026-09-30&basis=${basis}`,unsplit=await h.view(`budgets/${plan.id}/report?${query}`)
  const groups=[]
  for(const option of unsplit.dimensionOptions.filter(d=>d.kind===dimension)){
   const scope=new URLSearchParams({dimension,dimensionValue:option.id}),r=await h.view(`budgets/${plan.id}/report?${query}&${scope}`);groups.push(r)
   for(const metric of ['actual','budget','variance']){
    const detail=await h.view('reports/detail?'+new URLSearchParams({report:'budget-actual',line:JSON.stringify(['net-income',metric]),budget:plan.id,from:'2026-09-01',to:'2026-09-30',basis,dimension,dimensionValue:option.id}))
    assert.equal(detail.ties,true);assert.equal(detail.figure,r.netIncome[metric]);assert.ok(detail.rows.every(row=>(row[`${dimension}_name`]||'')===(option.id==='unassigned'?'':option.id.slice(6))))
   }
   const csv=await h.send(`/api/pantry/budgets/${plan.id}/report.csv?${query}&${scope}`,undefined,{cookie:h.owner});assert.equal(csv.status,200);assert.ok(csv.value.includes(dimension))
  }
  for(const metric of ['actual','budget','variance'])assert.equal(groups.reduce((s,r)=>s+r.netIncome[metric],0),unsplit.netIncome[metric])
 }
 const csv=await h.command('budget.save',{name:'Class CSV',startMonth:'2026-01',csv:'Account,Month,Amount,Class,Location\n4000,2026-09,1000,Studio,New York\n4000,2026-09,500,Support,Remote'})
 assert.deepEqual(csv.cells.map(c=>c.class_name).sort(),['Studio','Support'])
 const easel={lines:[{id:'design',name:'Design'}],calculation:{currency:'USD',cells:[{line:'design',department:'studio',month:'2026-09',amount:100000},{line:'design',department:'support',month:'2026-09',amount:50000}]}}
 const mapped=await h.command('budget.save',{name:'Mapped Easel classes',startMonth:'2026-01',easel,mapping:{design:{accountId:acct['4000']}},departmentMapping:{studio:tags,support:other}})
 assert.deepEqual(mapped.cells.map(c=>[c.class_name,c.amount_cents]).sort(),[['Studio',100000],['Support',50000]])
 const copied=await h.command('budget.save',{name:'Next year by dimension',startMonth:'2027-01',copyActuals:true,percentChange:'5',basis:'accrual'})
 assert.equal(copied.cells.find(c=>c.account_id===acct['6200']).class_name,'Studio')
 assert.equal(copied.cells.find(c=>c.account_id===acct['6200']).amount_cents,5250)
 await h.command('budget.save',{name:'Duplicate dimension cell',startMonth:'2026-01',cells:[cells[0],cells[0]]},h.owner,400)
 await h.command('budget.save',{name:'Unknown dimension',startMonth:'2026-01',cells:[{...cells[0],className:'Unknown'}]},h.owner,409)
}

export async function dimensionTaxAndCash(t) {
 const {h,acct,bank,tags,other}=await seed(t)
 const reader=await h.member('synthetic-pantry-tax-reader@example.test','viewer')
 const customer=await h.command('contact.save',{kind:'customer',name:'Dimension taxable customer'})
 const tax=await h.command('tax-code.save',{name:'Dimension NY',rate:'10',state:'NY',accountId:acct['2200']})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-03',lines:[{description:'Studio taxable sale',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:tax.id,...tags},{description:'Support taxable sale',quantity:'1',rate:'300',accountId:acct['4000'],taxCode:tax.id,...other}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});await h.command('invoice.issue',{id:draft.id})
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-12',amount:'220',bankAccountId:bank.id,allocations:[{targetId:draft.id,amount:'220'}]})
 for(const [date,memo,lines] of [['2026-09-30','Opening cash by dimension',[{accountId:acct['1000'],debit:'40',...other},{accountId:acct['3000'],credit:'40',...other}]],['2026-10-15','Different coded cash sides',[{accountId:acct['6200'],debit:'10',...tags},{accountId:acct['1000'],credit:'10',...other}]]]){
  const j=await h.command('journal.save-draft',{date,memo,lines});await h.command('journal.post',{id:j.id,revision:j.revision})
 }
 const from='2026-10-01',to='2026-10-31'
 const before=(await h.view('journal')).entries
 for(const [kind,values] of [['class',['Studio','Support','']],['location',['New York','Remote','']],['project',['Cedar','Cypress','']]]) {
  const flows=[]
  for(const name of values) {
   const scope={dimension:kind,dimensionValue:name?'value:'+name:'unassigned'},q={from,to,...scope}
   const flow=await h.view('reports/cash-flow?'+new URLSearchParams(q),reader);flows.push(flow)
   const figures=[...flow.operating,...flow.investing,...flow.financing].map(l=>[l.id,l.amount])
   figures.push(['operating',flow.totalOperating],['investing',flow.totalInvesting],['financing',flow.totalFinancing],['net-change',flow.netChange],['opening',flow.opening],['closing',flow.closing])
   for(const [line,amount] of figures) {
    const d=await h.view('reports/cash-flow/detail?'+new URLSearchParams({...q,line}),reader)
    assert.equal(d.ties,true);assert.equal(d.figure,amount);assert.ok(d.rows.every(r=>(r[`${kind}_name`]||'')===name))
    const csv=await h.send('/api/pantry/reports/cash-flow/detail/export?'+new URLSearchParams({...q,line}),undefined,{cookie:reader})
    assert.equal(csv.status,200);assert.ok(csv.value.includes('dimensionValue'))
   }
   const file=await h.send('/api/pantry/reports/cash-flow.csv?'+new URLSearchParams(q),undefined,{cookie:reader})
   assert.equal(file.status,200);assert.ok(file.value.includes(`${kind} · ${name||'Unassigned'}`))
   for(const basis of ['cash','accrual']) {
    const tq={...q,basis},r=await h.view('reports/sales-tax?'+new URLSearchParams(tq),reader)
    assert.equal(r.totals.taxable,name===values[0]?(basis==='cash'?5000:10000):name===values[1]?(basis==='cash'?15000:30000):0)
    for(const metric of ['taxable','charged','collected','owed']) {
     const d=await h.view('reports/detail?'+new URLSearchParams({...tq,report:'sales-tax',line:JSON.stringify(['total',metric])}),reader)
     assert.equal(d.ties,true);assert.equal(d.figure,r.totals[metric]);assert.ok(d.rows.every(row=>(row[`${kind}_name`]||'')===name))
    }
    for(const a of r.ledger.accounts)for(const part of ['opening','fromSales','other','closing','owed']) {
     const d=await h.view('reports/detail?'+new URLSearchParams({...tq,report:'sales-tax',line:JSON.stringify(['account',a.id,part])}),reader)
     assert.equal(d.ties,true);assert.equal(d.figure,a[part])
    }
    for(const format of ['pdf','csv','xlsx'])assert.equal((await h.send('/api/pantry/reports/sales-tax/export?'+new URLSearchParams({...tq,format}),undefined,{cookie:reader})).status,200)
   }
  }
  const whole=await h.view('reports/cash-flow?'+new URLSearchParams({from,to}),reader)
  for(const metric of ['opening','closing','totalOperating','totalInvesting','totalFinancing','netChange'])assert.equal(flows.reduce((n,r)=>n+r[metric],0),whole[metric],`cash-flow ${kind}/${metric} splits tie to the whole report`)
  assert.equal(flows[0].ties,false,'different coded sides do not claim a filtered cash tie')
 }
 assert.deepEqual((await h.view('journal')).entries,before)
}

export async function dimensionAgeing(t) {
 const {h,acct,bank,tags,other}=await seed(t)
 const customer=await h.command('contact.save',{kind:'customer',name:'Mixed project customer'}),vendor=await h.command('contact.save',{kind:'vendor',name:'Mixed project vendor'})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-01',lines:[{description:'Studio sale',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...tags},{description:'Support sale',quantity:'1',rate:'300',accountId:acct['4000'],taxCode:'exempt',...other}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});const invoice=await h.command('invoice.issue',{id:draft.id})
 const bill=await h.command('bill.save',{vendorId:vendor.id,reference:'synthetic-pantry-36',billDate:'2026-10-01',post:true,lines:[{description:'Studio cost',amount:'100',accountId:acct['6200'],...tags},{description:'Support cost',amount:'200',accountId:acct['6200'],...other}]})
 const received=await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-05',amount:'200',bankAccountId:bank.id,allocations:[{targetId:invoice.id,amount:'200'}]})
 await h.command('payment.record',{direction:'paid',contactId:vendor.id,date:'2026-10-05',amount:'150',bankAccountId:bank.id,allocations:[{targetId:bill.id,amount:'150'}]})
 const credit=await h.command('invoice.save-draft',{kind:'credit',creditFor:invoice.id,customerId:customer.id,issueDate:'2026-10-10',lines:[{description:'Support allowance',quantity:'1',rate:'250',accountId:acct['4000'],taxCode:'exempt',...other}]})
 await h.command('invoice.approve',{id:credit.id,revision:credit.revision});await h.command('invoice.issue',{id:credit.id})
 await h.command('vendor-credit.record',{vendorId:vendor.id,reference:'synthetic-pantry-37',date:'2026-10-10',amount:'60',accountId:acct['6200'],...tags,allocations:[{targetId:bill.id,amount:'30'}]})
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-12',amount:'10',bankAccountId:bank.id,allocations:[]})
 const viewer=await h.member('synthetic-pantry-ageing-reader@example.test','viewer')
 const before=(await h.view('journal')).entries
 const reports=['receivables','payables','receivables-summary','payables-summary','open-invoices','unpaid-bills','customer-balances','vendor-balances']
 for(const to of ['2026-10-06','2026-10-15'])for(const [kind,values] of [['class',['Studio','Support','']],['location',['New York','Remote','']],['project',['Cedar','Cypress','']]]){
  for(const report of reports) {
   const split=[]
   for(const name of values) {
    const q={from:'2026-10-01',to,dimension:kind,dimensionValue:name?'value:'+name:'unassigned'},r=await h.view(`reports/${report}?`+new URLSearchParams(q),viewer);split.push(r)
    const figures=['receivables','payables'].includes(report)?[...r.items.map(i=>[JSON.stringify(['item',i.id]),i.open]),...r.buckets.map((b,i)=>[JSON.stringify(['bucket',b]),r.totals[i]]),...[['items',r.itemsTotal],['unapplied',r.unapplied],['subledger',r.subledger],['control',r.control.balance]].map(([p,n])=>[JSON.stringify([p]),n])]:[...r.rows.flatMap(row=>r.moneyColumns.map(i=>[JSON.stringify([row.id,String(i)]),row.cells[i]])),...r.totals.map((t,i)=>[JSON.stringify(['total',String(i)]),t.amount])]
    for(const [line,amount] of figures) {
     const d=await h.view('reports/detail?'+new URLSearchParams({...q,report,line}),viewer)
     assert.equal(d.figure,amount);assert.equal(d.ties,true,`${report}/${to}/${kind}/${name}/${line}`)
     const csv=await h.send('/api/pantry/reports/detail/export?'+new URLSearchParams({...q,report,line}),undefined,{cookie:viewer})
     assert.equal(csv.status,200)
    }
    if(!['receivables','payables'].includes(report))for(const format of ['pdf','csv','xlsx'])assert.equal((await h.send(`/api/pantry/reports/${report}/export?`+new URLSearchParams({...q,format}),undefined,{cookie:viewer})).status,200)
   }
   const whole=await h.view(`reports/${report}?`+new URLSearchParams({from:'2026-10-01',to}),viewer)
   if(['receivables','payables'].includes(report))for(const metric of ['itemsTotal','unapplied','subledger'])assert.equal(split.reduce((n,r)=>n+r[metric],0),whole[metric],`${report} ${kind} ${metric} shares sum to total`)
   else for(const [i,total] of whole.totals.entries())assert.equal(split.reduce((n,r)=>n+r.totals[i].amount,0),total.amount)
  }
 }
 const scope={to:'2026-10-15',dimension:'class',dimensionValue:'value:Studio'}
 const ar=await h.view('reports/receivables?'+new URLSearchParams(scope)),ap=await h.view('reports/payables?'+new URLSearchParams(scope))
 assert.deepEqual([ar.itemsTotal,ar.unapplied,ap.itemsTotal,ap.unapplied],[0,0,4000,3000])
 const support=await h.view('reports/receivables?to=2026-10-15&dimension=class&dimensionValue=value:Support')
 assert.deepEqual([support.itemsTotal,support.unapplied],[0,5000],'over-credit remains unapplied on its own source dimension')
 for(const basis of ['cash','accrual']) {
  const filter={dimension:'class',dimensionValue:'value:Support',basis},query=new URLSearchParams(filter)
  const pkg=await h.view('package/2026-10?'+query,viewer)
  assert.equal(pkg.dimension.label,'class · Support');assert.match(pkg.scopeNote,/whole-business evidence/)
  for(const [key,report] of [['trialBalance','trial-balance'],['balanceSheet','balance-sheet'],['generalLedger','general-ledger'],['cashFlow','cash-flow'],['receivables','receivables'],['payables','payables']])assert.deepEqual(pkg[key],await h.view(`reports/${report}?`+new URLSearchParams({...filter,from:'2026-10-01',to:'2026-10-31'}),viewer))
  assert.deepEqual(pkg.profitAndLoss.period,await h.view('reports/profit-and-loss?'+new URLSearchParams({...filter,from:'2026-10-01',to:'2026-10-31'}),viewer))
  assert.deepEqual(pkg.profitAndLoss.yearToDate,await h.view('reports/profit-and-loss?'+new URLSearchParams({...filter,from:'2026-01-01',to:'2026-10-31'}),viewer))
  const csv=await h.send('/api/pantry/package/2026-10/general-ledger.csv?'+query,undefined,{cookie:viewer})
  assert.equal(csv.status,200);assert.ok(csv.value.includes('class · Support'))
  const response=await fetch(`${h.origin}/api/pantry/package/2026-10/accountant-package.zip?${query}`,{headers:{cookie:viewer}})
  assert.equal(response.status,200)
  const archive=Buffer.from(await response.arrayBuffer());let offset=0,checked=0
  while(archive.readUInt32LE(offset)===0x04034b50) {
   const size=archive.readUInt32LE(offset+18),nameSize=archive.readUInt16LE(offset+26),extra=archive.readUInt16LE(offset+28),name=archive.subarray(offset+30,offset+30+nameSize).toString(),start=offset+30+nameSize+extra,body=archive.subarray(start,start+size).toString()
   if(name.endsWith('.csv')){assert.match(body.split('\r\n')[0],/^Dimension scope,/);checked++}
   if(name.endsWith('profit-and-loss.csv'))assert.ok(body.includes('Dimension scope,class · Support'))
   if(name.endsWith('close-checklist.csv'))assert.ok(body.includes('Whole business evidence (not filtered)'))
   if(name.endsWith('README.txt'))assert.ok(body.includes('Financial dimension: class · Support'))
   offset=start+size
  }
  assert.ok(checked>=8)
 }
 assert.deepEqual((await h.view('journal')).entries,before)
 await h.command('journal.reverse',{id:received.journal_id,date:'2026-10-20',memo:'Customer payment returned'})
 const reopened=await h.view('reports/receivables?to=2026-10-31&dimension=class&dimensionValue=value:Studio')
 assert.equal(reopened.itemsTotal,5000,'the later payment reversal restores the same cumulative line share')
}

export async function dimensionPaymentReports(t) {
 const {h,acct,bank,tags,other}=await seed(t)
 const vendor=await h.command('contact.save',{kind:'vendor',name:'Dimension contractor'}),customer=await h.command('contact.save',{kind:'customer',name:'Dimension payer'})
 await h.command('contractor.save',{contactId:vendor.id,is1099:true})
 const pay=(direction,amount,method,coding={},reference='synthetic-pantry-38')=>h.command('payment.record',{direction,amount,method,reference,contactId:direction==='paid'?vendor.id:customer.id,date:'2026-10-05',bankAccountId:bank.id,...coding,allocations:[]})
 await pay('paid','40','unrecorded')
 for(const accountId of [acct['1000'],acct['1200'],acct['2000']])await h.command('dimension.require',{accountId,kinds:['class']})
 const before=(await h.view('journal')).entries.length
 await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-05',amount:'100',bankAccountId:bank.id,allocations:[]},h.owner,409)
 assert.equal((await h.view('journal')).entries.length,before,'missing required payment coding leaves no posting')
 const received=await pay('received','100','ach',tags),cash=await pay('paid','10','cash',tags),check=await pay('paid','20','check',other),card=await pay('paid','30','card',tags)
 const credential=await h.command('integration.create',{name:'synthetic-pantry-39',scopes:['payments:write','payments:read','reports:read','post']})
 const body={direction:'received',contactId:customer.id,date:'2026-10-06',amount:'25',bankAccountId:bank.id,reference:'synthetic-pantry-40',...other,allocations:[]}
 const requests=await Promise.all([1,2].map(()=>h.send('/api/pantry/integration/v1/payments',body,{headers:{authorization:`Bearer ${credential.token}`,'idempotency-key':'synthetic-pantry-40'}})))
 assert.ok(requests.every(r=>r.status===200));assert.equal(requests[0].value.id,requests[1].value.id)
 const entries=(await h.view('journal')).entries
 for(const [payment,coding] of [[received,tags],[cash,tags],[check,other],[card,tags],[requests[0].value,other]])for(const l of entries.find(e=>e.id===payment.journal_id).lines)assert.deepEqual([l.class_name,l.location_name,l.project_name],Object.values(coding))
 await h.command('journal.reverse',{id:check.journal_id,date:'2026-10-20',memo:'Cancelled dimension check'})
 for(const to of ['2026-10-15','2026-10-31'])for(const report of ['deposits','check-detail','contractor-summary']) {
  const whole=await h.view(`reports/${report}?from=2026-10-01&to=${to}`),pieces=[]
  for(const name of ['Studio','Support','']) {
   const q={from:'2026-10-01',to,dimension:'class',dimensionValue:name?'value:'+name:'unassigned'},r=await h.view(`reports/${report}?`+new URLSearchParams(q));pieces.push(r)
   const figures=[...r.rows.flatMap(row=>r.moneyColumns.map(i=>[JSON.stringify([row.id,String(i)]),row.cells[i]])),...r.totals.map((t,i)=>[JSON.stringify(['total',String(i)]),t.amount])]
   for(const [line,amount] of figures){const d=await h.view('reports/detail?'+new URLSearchParams({...q,report,line}));assert.equal(d.ties,true);assert.equal(d.figure,amount)}
   for(const format of ['csv','pdf','xlsx'])assert.equal((await h.send(`/api/pantry/reports/${report}/export?`+new URLSearchParams({...q,format}),undefined,{cookie:h.owner})).status,200)
   const scoped=await h.send(`/api/pantry/integration/v1/reports/${report}?`+new URLSearchParams(q),undefined,{headers:{authorization:`Bearer ${credential.token}`}})
   assert.equal(scoped.status,200);assert.deepEqual(scoped.value,r)
  }
  for(const [i,total] of whole.totals.entries())assert.equal(pieces.reduce((n,r)=>n+r.totals[i].amount,0),total.amount)
  if(report==='deposits')assert.equal(pieces[0].totals[0].amount,10000)
  if(report==='check-detail')assert.equal(pieces[1].totals[0].amount,to==='2026-10-15'?2000:0)
  if(report==='contractor-summary')assert.equal(pieces[0].totals[0].amount,1000,'card payments stay excluded from the operational eligible-method subtotal')
 }
 await pay('paid','2500','ach',other,'synthetic-pantry-41')
 for(const [name,expected] of [['Studio',1000],['Support',250000],['',0]]) {
  const q={year:'2026',dimension:'class',dimensionValue:name?'value:'+name:'unassigned'}
  const r=await h.view('reports/contractors?'+new URLSearchParams(q)),v=r.contractors.find(c=>c.id===vendor.id)
  assert.equal(v.box1,expected);assert.equal(v.overThreshold,true,'a subset never hides a whole-year filing threshold')
  assert.equal(r.forms.find(f=>f.id===vendor.id).box1,251000,'filing figures retain the whole year')
  for(const metric of ['box1','excluded','unrecorded','reversed']) {
   const d=await h.view('reports/detail?'+new URLSearchParams({...q,report:'contractors',line:JSON.stringify([vendor.id,metric]),from:'2026-01-01',to:'2026-12-31',basis:'cash'}))
   assert.equal(d.figure,v[metric]);assert.equal(d.ties,true)
  }
 }
}

export async function dimensionReconciliationReports(t) {
 const {h,acct,tags,other}=await seed(t)
 // Reconciliations retain a saved whole-statement proof and expose coded book contributions.
 acct['1010']=(await h.command('account.save',{code:'1010',name:'Project reserve',type:'asset',subtype:'bank'})).id
 const reserve=await h.command('bank-account.save',{name:'Dimension reserve',institution:'Synthetic bank',accountId:acct['1010'],numberLast4:'4242',openingDate:'2026-01-01',openingBalance:'0'})
 const post=async(amount,coding)=>{const j=await h.command('journal.save-draft',{date:'2026-10-15',memo:'Dimension reserve receipt',lines:[{accountId:acct['1010'],debit:amount,...coding},{accountId:acct['4000'],credit:amount,...coding}]});await h.command('journal.post',{id:j.id,revision:j.revision})}
 await post('50',tags);await post('25',other);await post('10',{});await post('5',tags)
 const imported=await h.command('statement.import',{bankAccountId:reserve.id,fileName:'synthetic-pantry-42.csv',content:'Posting Date,Description,Amount\n10/15/2026,Studio receipt,50\n10/15/2026,Support receipt,25\n10/15/2026,Unassigned receipt,10',opening:'0',closing:'85',start:'2026-10-01',end:'2026-10-31',confirmLast4:'4242'})
 let state=await h.view('reconciliation/'+imported.statement.id)
 for(const line of state.lines.filter(l=>!l.match_id)) {
  state=await h.view('reconciliation/'+imported.statement.id)
  const posting=state.postings.find(p=>!p.match_id&&Number(p.amount)===line.amount_cents)
  assert.ok(posting,JSON.stringify(line))
  await h.command('match.approve',{bankLineIds:[line.id],journalLineIds:[posting.id]})
 }
 await h.command('reconciliation.complete',{statementId:imported.statement.id})
 const q={from:'2026-10-01',to:'2026-10-31'},whole=await h.view('reports/reconciliations?'+new URLSearchParams(q)),pieces=[]
 for(const name of ['Studio','Support','']) {
  const scope={...q,dimension:'class',dimensionValue:name?'value:'+name:'unassigned'},r=await h.view('reports/reconciliations?'+new URLSearchParams(scope));pieces.push(r)
  const row=r.rows.find(row=>row.id===imported.statement.id)
  assert.equal(row.cells[8],'Whole statement reconciled')
  if(name==='Studio')assert.deepEqual(row.cells.slice(2,8),[0,0,5500,500,5000,-5000])
  for(const index of r.moneyColumns) {
   const detail=await h.view('reports/detail?'+new URLSearchParams({...scope,report:'reconciliations',line:JSON.stringify([row.id,String(index)])}))
   assert.equal(detail.ties,true);assert.equal(detail.figure,row.cells[index]);assert.ok(detail.rows.every(source=>source.key.startsWith('statement:')||source.class_name===name))
  }
  for(const format of ['pdf','csv','xlsx'])assert.equal((await h.send('/api/pantry/reports/reconciliations/export?'+new URLSearchParams({...scope,format}),undefined,{cookie:h.owner})).status,200)
 }
 for(const index of whole.moneyColumns)assert.equal(pieces.reduce((n,r)=>n+r.rows[0].cells[index],0),whole.rows[0].cells[index])
 await post('7',tags)
 assert.deepEqual((await h.view('reports/reconciliations?'+new URLSearchParams({...q,dimension:'class',dimensionValue:'value:Studio'}))).rows[0].cells,pieces[0].rows[0].cells,'later backdated postings do not change the saved dimension contribution')


}
