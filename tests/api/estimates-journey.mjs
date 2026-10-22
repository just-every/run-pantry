import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import { books, at } from './harness.mjs'

export async function estimatesJourney(h){
 const {acct}=await books(h),day='2026-10-15',due='2026-11-14'
 const bank=await h.command('bank-account.save',{name:'Estimate checking',institution:'Local',accountId:acct['1000'],numberLast4:'0091',openingDate:'2026-01-01',openingBalance:'0.00'})
 const liability=await h.command('account.save',{code:'2300',name:'Customer deposits',type:'liability',subtype:'other'})
 const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic Estimate Customer',email:'estimates@example.test',termsDays:30})
 const body={customerId:customer.id,issueDate:day,dueDate:due,lines:[{description:'Design project',quantity:'1',rate:'12000.00',accountId:acct['4000'],taxCode:'exempt'}]}
 const accept=async(est,name='Alex Customer')=>{
  const sent=await h.command('estimate.send',{id:est.id,revision:est.revision}),path=sent.public_path
  const page=await h.send(path);assert.equal(page.status,200);assert.match(page.value,/Accept estimate/)
  const pdf=await h.send(path+'/estimate.pdf'),privatePdf=await h.send(`/api/pantry/estimates/${est.id}/pdf`,undefined,{cookie:h.owner})
  assert.equal(pdf.status,200);assert.equal(pdf.value,privatePdf.value)
  const email=h.mail.findLast(m=>m.subject.includes(sent.number)),bytes=Buffer.from(email.attachments[0].content,'base64')
  assert.equal(bytes.toString(),pdf.value)
  const downloaded=await fetch(h.origin+path+'/estimate.pdf');assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()),bytes)
  assert.equal(createHash('sha256').update(bytes).digest('hex'),sent.pdf_sha256)
  const accepted=await h.send(path+'/accept',undefined,{raw:new URLSearchParams({name,revision:est.revision}).toString(),headers:{'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.45'}})
  assert.equal(accepted.status,200,JSON.stringify(accepted.value));assert.match(accepted.value,/Accepted by Alex Customer/)
  return h.view(`estimates/${est.id}`)
 }
 const estimate=await accept(await h.command('estimate.save-draft',body))
 assert.deepEqual([estimate.acceptance.name,estimate.acceptance.ip,estimate.acceptance.revision],['Alex Customer','192.0.2.45',estimate.revision])
 const dep=await h.command('customer-deposit.record',{customerId:customer.id,date:day,amount:'3000.00',bankAccountId:bank.id,liabilityAccountId:liability.id,method:'check',reference:'synthetic-deposit-1'})
 const checkBooks=async(receivable,held,revenue)=>{
  const [tb,bs,pl,ar]=await Promise.all([h.view(`reports/trial-balance?to=${day}&basis=accrual`),h.view(`reports/balance-sheet?to=${day}&basis=accrual`),h.view(`reports/profit-and-loss?from=2026-01-01&to=${day}&basis=accrual`),h.view(`reports/receivables?to=${day}`)])
  const net=id=>tb.rows.find(r=>r.id===id)?.net??0
  assert.deepEqual([net(acct['1000']),net(acct['1200']),net(liability.id),net(acct['4000'])],[300000,receivable,0-held,0-revenue])
  assert.equal(tb.balanced,true);assert.equal(bs.balanced,true);assert.equal(ar.agrees,true)
  assert.deepEqual([bs.totalAssets,bs.totalLiabilities,bs.totalEquity,pl.totalIncome],[300000+receivable,held,revenue,revenue])
 }
 await checkBooks(0,300000,0)
 assert.equal((await h.view('customer-deposits')).deposits[0].remaining_cents,300000)
 const convert=async(mode,extra={})=>{
  const request={id:estimate.id,revision:estimate.revision,requestId:crypto.randomUUID(),issueDate:day,dueDate:due,mode,...extra}
  const result=await h.command('estimate.convert',request)
  assert.equal((await h.command('estimate.convert',request)).invoice.id,result.invoice.id)
  const approved=await h.command('invoice.approve',{id:result.invoice.id,revision:result.invoice.revision})
  return h.command('invoice.issue',{id:approved.id})
 }
 const first=await convert('percent',{percent:'30',depositId:dep.id,depositAmount:'3000.00'})
 assert.deepEqual([first.total_cents,first.open_cents],[360000,60000])
 await checkBooks(60000,0,360000)
 const second=await convert('percent',{percent:'40'});await checkBooks(540000,0,840000)
 const third=await convert('balance');await checkBooks(900000,0,1200000)
 assert.deepEqual([second.total_cents,third.total_cents],[480000,360000])
 const done=await h.view(`estimates/${estimate.id}`)
 assert.deepEqual([done.billed_cents,done.remaining_cents,done.conversions.length],[1200000,0,3])
 await h.command('estimate.convert',{id:estimate.id,revision:estimate.revision,requestId:crypto.randomUUID(),issueDate:day,mode:'balance'},h.owner,409)
 const held=(await h.view('customer-deposits')).deposits[0]
 assert.equal(held.remaining_cents,0);assert.equal(held.applications.length,1)
 const receipts=await h.view(`reports/deposits?from=${day}&to=${day}`)
 assert.equal(receipts.totals[0].amount,300000)
 const ar=await h.view(`reports/receivables?to=${day}`)
 assert.equal(ar.agrees,true)
 assert.equal(ar.items.find(r=>r.id===first.id).open,60000)
 const history=await h.view(`customers/${customer.id}`)
 assert.equal(history.sections.estimates.rows[0].id,estimate.id)
 assert.equal(history.sections.estimates.rows[0].conversions.length,3)
 assert.ok(history.deliveries.some(d=>d.kind==='estimate'))
 assert.equal((await h.view(`estimates/${estimate.id}/preview`)).document.notes.some(n=>n.includes('no payment offer')),false)
 const invDoc=await h.view(`invoice-documents/${first.id}/preview`)
 assert.deepEqual(invDoc.document.totals.slice(-2),[['Advance customer deposit applied','-$3,000.00'],['Amount due','$600.00']])
 assert.ok(invDoc.document.notes.some(n=>n.includes('previously billed')&&n.includes('remaining')))
 return {acct,customer,bank,liability,body,accept,estimate,dep,first,second,third}
}

export async function estimateInheritedJourney(h,x){
 const {acct,customer,bank,liability,body,accept,estimate,dep,first}=x,day=body.issueDate,due=body.dueDate
 const viewer=await h.member('estimate-viewer@example.test','viewer')
 const sales=await h.member('estimate-sales@example.test','sales',{canPost:true})
 const bookkeeper=await h.member('estimate-books@example.test','bookkeeper')
 const salesRead=await h.view(`estimates/${estimate.id}`,sales)
 assert.equal(Object.hasOwn(salesRead.acceptance,'ip'),false)
 assert.deepEqual((await h.view('estimates',sales)).deposits,[])
 for(const role of ['time-only','payables-clerk']){
  const restricted=await h.member(`synthetic-pantry-${role}@example.test`,role,{canPost:true})
  for(const door of ['estimates',`estimates/${estimate.id}`,`estimates/${estimate.id}/preview`,`estimates/${estimate.id}/pdf`,'customer-deposits'])await h.view(door,restricted,403)
  await h.command('estimate.save-draft',body,restricted,403)
  await h.command('estimate.send',{id:estimate.id,revision:estimate.revision},restricted,403)
  await h.command('estimate.convert',{id:estimate.id,revision:estimate.revision,requestId:crypto.randomUUID(),issueDate:day,mode:'balance'},restricted,403)
 }
 const another=await h.command('contact.save',{kind:'customer',name:'Synthetic Other Customer',email:'other-estimate@example.test'})
 const issued=async(d)=>{const a=await h.command('invoice.approve',{id:d.id,revision:d.revision});return h.command('invoice.issue',{id:a.id})}
 const form=(revision,name='Alex Customer')=>({raw:new URLSearchParams({revision,name}).toString(),headers:{'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.45'}})
 // Signed-in role refusal, origins, exact revisions and owner revocation are
 // asserted through the same transport as the screens.
 await h.command('estimate.save-draft',body,viewer,403)
 await h.command('customer-deposit.record',{customerId:customer.id,date:day,amount:'1.00',bankAccountId:bank.id,liabilityAccountId:liability.id,method:'check',reference:'refused'},bookkeeper,403)
 await h.command('estimate.convert',{id:estimate.id,revision:estimate.revision,requestId:crypto.randomUUID(),issueDate:day,mode:'balance',depositId:dep.id,depositAmount:'1.00'},sales,403)
 assert.equal((await h.send('/api/pantry/estimates')).status,401)
 let revised=await h.command('estimate.save-draft',{...body,lines:[{...body.lines[0],rate:'10.00'}]})
 revised=await h.command('estimate.send',{id:revised.id,revision:revised.revision})
 const oldPath=revised.public_path,oldRevision=revised.revision
 await h.command('estimate.link-revoke',{id:revised.id,revision:revised.revision},bookkeeper,403)
 revised=await h.command('estimate.save-draft',{...revised.input,id:revised.id,revision:revised.revision,memo:'Revised scope'})
 assert.equal((await h.send(oldPath)).status,404)
 assert.equal((await h.send(oldPath+'/accept',undefined,form(oldRevision))).status,404)
 revised=await h.command('estimate.send',{id:revised.id,revision:revised.revision})
 assert.equal((await h.send(revised.public_path+'/accept',undefined,form(oldRevision))).status,409)
 const platformAccepted=await h.send(revised.public_path+'/accept',undefined,{raw:new URLSearchParams({revision:revised.revision,name:'Alex Customer'}).toString(),headers:{'content-type':'application/x-www-form-urlencoded','x-forwarded-for':'192.0.2.45'}})
 assert.equal(platformAccepted.status,200);assert.notEqual((await h.view(`estimates/${revised.id}`)).acceptance.ip,'192.0.2.45')
 assert.equal((await h.send(revised.public_path+'/accept',undefined,{...form(revised.revision),headers:{...form(revised.revision).headers,origin:'https://outside.example'}})).status,403)
 assert.equal((await h.send(revised.public_path+'/accept',undefined,{...form(revised.revision),raw:'name='+ 'x'.repeat(5000)})).status,413)
 await h.command('estimate.link-revoke',{id:revised.id,revision:revised.revision})
 assert.equal((await h.send(revised.public_path)).status,404)
 // Item, template/custom field and exact INVOICE-010 economics inherit the
 // native pricing functions. An estimate shows proposed terms without an offer.
 const discount=await h.command('account.save',{code:'4950',name:'Estimate discounts',type:'income',subtype:'other'})
 await h.command('discount-settings.save',{discountAccountId:discount.id})
 const tax=await h.command('tax-code.save',{name:'Estimate California',rate:'8.25',accountId:acct['2200'],state:'CA'})
 const item=await h.command('item.save',{name:'Estimate service',kind:'service',description:'Accepted design service',rate:'500.00',accountId:acct['4000'],taxCategory:'taxable',taxCode:tax.id})
 const templateInput={name:'Estimate project',layout:'banner',accentColor:'#174838',textColor:'#202234',address:'18 Project Street',remitTo:'Project remittance',termsDays:30,paymentInstructions:'Reference the invoice number',footer:'Project footer',message:'Accepted project scope',fields:[{key:'po',label:'PO number',defaultValue:''}]}
 const template=await h.command('invoice-template.save',templateInput)
 const profile=await h.view(`customers/${customer.id}`)
 await h.command('customer.invoice-template',{customerId:customer.id,revision:profile.customer.revision,templateId:template.id})
 let economic=await h.command('estimate.save-draft',{...body,lines:[{itemId:item.id,quantity:'2'},{kind:'delivery',description:'Delivery',quantity:'1',rate:'40.00',accountId:acct['4000'],taxCode:tax.id}],discounts:[{type:'percent',value:'10'}],deposit:{amount:'300.00',date:day,method:'check',bankAccountId:bank.id,reference:'estimate-at-issue'},earlyPayment:{percent:'2',days:10},customFields:{po:'PO-007'}})
 assert.deepEqual([economic.subtotal_cents,economic.tax_cents,economic.total_cents],[104000,7755,101755])
 const preview=await h.view(`estimates/${economic.id}/preview`)
 assert.equal(preview.document.layout,'banner');assert.ok(preview.document.facts.some(([k,v])=>k==='PO number'&&v==='PO-007'))
 assert.ok(preview.document.notes.some(n=>n.includes('no payment offer')))
 economic=await accept(economic)
 const retained=await h.view(`estimates/${economic.id}/preview`)
 await h.command('invoice-template.save',{...templateInput,id:template.id,revision:template.revision,message:'Changed for future work'})
 assert.equal((await h.view(`estimates/${economic.id}/preview`)).sha256,retained.sha256)
 // Estimates can state terms while the accountant has not yet decided tax
 // treatment. The converted offer must wait for that decision at approval.
 const conversion=await h.command('estimate.convert',{id:economic.id,revision:economic.revision,requestId:'synthetic-full-conversion',issueDate:day,dueDate:due,mode:'full'})
 assert.deepEqual(conversion.invoice.lines.map(l=>[l.quantity_milli,l.item_id,l.discount_cents,l.tax_cents]),[[2000,item.id,10000,7425],[1000,null,0,330]])
 assert.equal(conversion.invoice.total_cents,101755)
 await h.command('invoice.approve',{id:conversion.invoice.id,revision:conversion.invoice.revision},h.owner,409)
 await h.command('tax-code.early-treatment',{id:tax.id,revision:tax.revision,treatment:'reduce'})
 const refreshed=await h.command('estimate.refresh-invoice',{id:economic.id,invoiceId:conversion.invoice.id,revision:conversion.invoice.revision})
 const atIssue=await issued(refreshed.invoice)
 assert.deepEqual([atIssue.total_cents,atIssue.open_cents,atIssue.early_offer.payBy],[101755,71755,69720])
 // Refresh changes only the offer's evidence; accepted line economics and
 // the immutable sent estimate remain unchanged.
 const newEconomic=await accept(await h.command('estimate.save-draft',{...economic.input,deposit:null}))
 const full=await h.command('estimate.convert',{id:newEconomic.id,revision:newEconomic.revision,requestId:'synthetic-full-decided',issueDate:day,dueDate:due,mode:'full'})
 const fullIssued=await issued(full.invoice)
 assert.equal(fullIssued.early_offer.payBy,99720)
 assert.equal((await h.view(`invoice-documents/${fullIssued.id}/preview`)).document.templateName,'Estimate project')
 const advanceTerm=await accept(await h.command('estimate.save-draft',{...body,lines:[{...body.lines[0],rate:'100.00'}],earlyPayment:{percent:'2',days:10}}))
 const allAdvance=await h.command('customer-deposit.record',{customerId:customer.id,date:day,amount:'100',bankAccountId:bank.id,liabilityAccountId:liability.id,method:'check',reference:'synthetic-early-advance'})
 const allConverted=await h.command('estimate.convert',{id:advanceTerm.id,revision:advanceTerm.revision,requestId:'synthetic-early-full',issueDate:day,mode:'full',depositId:allAdvance.id,depositAmount:'100'})
 const allIssued=await issued(allConverted.invoice)
 assert.equal(allIssued.open_cents,0);assert.equal(allIssued.early_offer.payBy,0)
 assert.equal((await h.view('customer-deposits')).deposits.find(d=>d.id===allAdvance.id).remaining_cents,200)
 assert.deepEqual((await h.view(`invoice-documents/${allIssued.id}/preview`)).document.totals.at(-1),['Amount due','$0.00'])
 const progressTerm=await accept(await h.command('estimate.save-draft',{...body,earlyPayment:{percent:'2',days:10}}))
 const progressAdvance=await h.command('customer-deposit.record',{customerId:customer.id,date:day,amount:'3000',bankAccountId:bank.id,liabilityAccountId:liability.id,method:'check',reference:'synthetic-progress-term'})
 const progress=await h.command('estimate.convert',{id:progressTerm.id,revision:progressTerm.revision,requestId:'synthetic-progress-term',issueDate:day,mode:'percent',percent:'30',depositId:progressAdvance.id,depositAmount:'3000'})
 assert.equal(progress.invoice.early_offer.payBy,52800)
 const refreshedProgress=await h.command('estimate.refresh-invoice',{id:progressTerm.id,invoiceId:progress.invoice.id,revision:progress.invoice.revision})
 assert.equal(refreshedProgress.invoice.early_offer.payBy,52800)
 const progressIssued=await issued(refreshedProgress.invoice)
 assert.equal(progressIssued.open_cents,60000)
 assert.ok((await h.view(`invoice-documents/${progressIssued.id}/preview`)).document.notes.some(n=>n.includes('$528.00')))
 // Milestones and simultaneous requests reserve accepted value atomically.
 const milestone=await accept(await h.command('estimate.save-draft',{...body,lines:[{...body.lines[0],rate:'100.00'}]}))
 const request={id:milestone.id,revision:milestone.revision,requestId:'synthetic-concurrent',issueDate:day,mode:'milestone',milestone:'Discovery',amount:'60.00'}
 const duplicate=await Promise.all([h.send('/api/pantry/command/estimate.convert',request,{cookie:h.owner}),h.send('/api/pantry/command/estimate.convert',request,{cookie:h.owner})])
 assert.ok(duplicate.every(r=>r.status===200));assert.equal(duplicate[0].value.invoice.id,duplicate[1].value.invoice.id)
 await h.command('estimate.convert',{...request,requestId:'synthetic-over-cap',amount:'60.00'},h.owner,409)
 const remainder=await h.command('estimate.convert',{...request,requestId:'synthetic-remainder',mode:'balance'})
 assert.equal(remainder.invoice.total_cents,4000)
 await h.command('invoice.save-draft',{...body,id:remainder.invoice.id,revision:remainder.invoice.revision},h.owner,409)
 // Deposit-only receipt reversals cannot free money already applied. Reversing
 // its application restores both the liability and invoice's open balance.
 await h.command('journal.reverse',{id:dep.journal_id,date:day,memo:'Receipt correction'},h.owner,409)
 const applied=(await h.view('customer-deposits')).deposits.find(d=>d.id===dep.id).applications[0]
 const payment=at((await h.view('sales')).payments,p=>p.id===applied.payment_id)
 await h.command('journal.reverse',{id:payment.journal_id,date:day,memo:'Correct application'})
 assert.equal((await h.view('customer-deposits')).deposits.find(d=>d.id===dep.id).remaining_cents,300000)
 const again={depositId:dep.id,invoiceId:first.id,amount:'3000.00',date:day,requestId:'synthetic-apply-again'}
 await h.command('customer-deposit.apply',again)
 await h.command('customer-deposit.apply',again)
 assert.equal((await h.view(`reports/receivables?to=${day}`)).agrees,true)
 // The scoped public API covers the new records without leaking the link,
 // peer address, editable input or retained PDF bytes.
 const credential=await h.command('integration.create',{name:'Synthetic estimate reader',scopes:['estimates:read','customer-deposits:read','contacts:read']})
 const api=async(path)=>h.send('/api/pantry/integration/v1/'+path,undefined,{headers:{authorization:`Bearer ${credential.token}`}})
 const list=await api('estimates'),detail=await api('estimates/'+estimate.id)
 assert.equal(list.status,200);assert.equal(detail.status,200)
 assert.doesNotMatch(JSON.stringify(detail.value),/192\.0\.2\.45|link_token|pdf_base64|"input"|"pricing"/)
 assert.equal((await api('customer-deposits')).status,200)
 const contactHistory=(await api('contact-history?contactId='+customer.id)).value.records
 assert.ok(contactHistory.some(r=>r.kind==='estimate'));assert.ok(contactHistory.some(r=>r.kind==='customer-deposit'))
 assert.ok((await api('customer-deposit-applications')).value.records.length)
 const invoiceOnly=await h.command('integration.create',{name:'Synthetic invoice reader',scopes:['invoices:read']})
 assert.equal((await h.send('/api/pantry/integration/v1/estimates',undefined,{headers:{authorization:`Bearer ${invoiceOnly.token}`}})).status,403)
 return {sales,bookkeeper,viewer}
}

export async function estimateErasureJourney(h){
 const {acct}=await books(h)
 await h.command('entity.save',{revision:(await h.view('state')).settings.entity.revision,legalName:'Juniper Lane Design LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2010-01-01',policies:''})
 const bank=await h.command('bank-account.save',{name:'Archive checking',institution:'Local',accountId:acct['1000'],numberLast4:'0012',openingDate:'2010-01-01',openingBalance:'0.00'})
 const c=await h.command('contact.save',{kind:'customer',name:'Synthetic Archived Customer LLC',email:'archive-estimate@example.test',phone:'555-0100',internalNotes:'Private customer note'})
 let e=await h.command('estimate.save-draft',{customerId:c.id,issueDate:'2018-01-01',lines:[{description:'Archived design',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
 e=await h.command('estimate.send',{id:e.id,revision:e.revision})
 await h.send(e.public_path+'/accept',undefined,{raw:new URLSearchParams({name:'Alex Archived',revision:e.revision}).toString(),headers:{'content-type':'application/x-www-form-urlencoded','cf-connecting-ip':'192.0.2.61'}})
 const converted=await h.command('estimate.convert',{id:e.id,revision:e.revision,requestId:'synthetic-archive-full',issueDate:'2018-01-02',mode:'full'})
 await h.command('invoice.approve',{id:converted.invoice.id,revision:converted.invoice.revision})
 const inv=await h.command('invoice.issue',{id:converted.invoice.id})
 await h.command('payment.record',{direction:'received',contactId:c.id,date:'2018-01-03',amount:'100',bankAccountId:bank.id,reference:'synthetic-archive-paid',method:'check',allocations:[{targetId:inv.id,amount:'100'}]})
 const before=await h.view('reports/trial-balance?to=2026-12-31&basis=accrual')
 const p=await h.command('erasure.preview',{kind:'contact',id:c.id})
 assert.equal(p.blockers.length,0)
 const retained=p.retained.find(r=>r.table==='pt_estimate_documents')
 assert.ok(retained);assert.equal(retained.clock,'2018-01-03')
 const receipt=await h.command('erasure.execute',{kind:'contact',id:c.id,fingerprint:p.fingerprint,requester:'privacy@example.test',reason:'Remove obsolete customer identity',channel:'email',confirm:'ERASE'})
 assert.ok(receipt.id)
 const est=await h.view(`estimates/${e.id}`)
 assert.equal(est.public_path,null);assert.equal(est.acceptance.ip,null);assert.notEqual(est.acceptance.name,'Alex Archived')
 assert.equal((await h.send(e.public_path)).status,404)
 const state=await h.view('erasure'),item=state.ready.find(r=>r.table==='pt_estimate_documents')
 assert.ok(item)
 const expired=await h.command('retention.erase',{ids:[item.key],revision:state.revision,confirm:'ERASE'})
 assert.equal(expired.erased[0].sha256,e.pdf_sha256)
 assert.equal((await h.send(`/api/pantry/estimates/${e.id}/pdf`,undefined,{cookie:h.owner})).status,410)
 assert.deepEqual(await h.view('reports/trial-balance?to=2026-12-31&basis=accrual'),before)
 // A sent estimate without a transaction has no retention claim; erasure
 // removes its dependents and the customer without a dangling foreign key.
 const unused=await h.command('contact.save',{kind:'customer',name:'Synthetic unused estimate',email:'unused-estimate@example.test'})
 const draft=await h.command('estimate.save-draft',{customerId:unused.id,issueDate:'2026-10-01',lines:[{description:'Unaccepted scope',quantity:'1',rate:'10',accountId:acct['4000'],taxCode:'exempt'}]})
 const sent=await h.command('estimate.send',{id:draft.id,revision:draft.revision})
 const preview=await h.command('erasure.preview',{kind:'contact',id:unused.id})
 await h.command('erasure.execute',{kind:'contact',id:unused.id,fingerprint:preview.fingerprint,requester:'privacy@example.test',reason:'Remove unused enquiry',channel:'email',confirm:'ERASE'})
 assert.equal((await h.send(sent.public_path)).status,404)
}
