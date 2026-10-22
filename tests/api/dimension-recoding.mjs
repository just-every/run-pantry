import assert from 'node:assert/strict'
import {dimensionSeed} from './dimension-extensions.mjs'

export async function dimensionRecoding(t){
 const {h,acct,bank,tags,other}=await dimensionSeed(t)
 const customer=await h.command('contact.save',{kind:'customer',name:'Cedar Studio'}),vendor=await h.command('contact.save',{kind:'vendor',name:'Brightline Software'})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-08-15',lines:[{description:'Project design',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});const invoice=await h.command('invoice.issue',{id:draft.id})
 const bill=await h.command('bill.save',{vendorId:vendor.id,billDate:'2026-08-15',reference:'synthetic-pantry-70',post:true,lines:[{description:'Design subscription',amount:'60',accountId:acct['6200'],...tags}]})
 const creditDraft=await h.command('invoice.save-draft',{kind:'credit',creditFor:invoice.id,customerId:customer.id,issueDate:'2026-09-05',lines:[{description:'Design allowance',quantity:'1',rate:'10',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 await h.command('invoice.approve',{id:creditDraft.id,revision:creditDraft.revision});const credit=await h.command('invoice.issue',{id:creditDraft.id})
 const payment=await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-09-10',amount:'40',bankAccountId:bank.id,allocations:[{targetId:invoice.id,amount:'40'}]})
 await h.command('payment.record',{direction:'paid',contactId:vendor.id,date:'2026-09-10',amount:'30',bankAccountId:bank.id,allocations:[{targetId:bill.id,amount:'30'}]})
 const original=(await h.view('journal')).entries,targets=[invoice,credit,bill].map(d=>original.find(e=>e.id===d.journal_id))
 const sourceLines=targets.map(e=>e.lines.find(l=>[acct['4000'],acct['6200']].includes(l.account_id)))
 const before=await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')
 const viewer=await h.member('synthetic-pantry-recoding@example.test','viewer')
 await h.command('journal.reclassify',{lineIds:sourceLines.map(l=>l.id),dimensionKind:'class',toDimensionName:'Support'},viewer,403)
 // Concurrent identical corrections create one complete batch, never two.
 const attempts=await Promise.all([1,2].map(()=>h.send('/api/pantry/command/journal.reclassify',{lineIds:sourceLines.map(l=>l.id),dimensionKind:'class',toDimensionName:'Support'},{cookie:h.owner})))
 assert.deepEqual(attempts.map(r=>r.status).sort(),[200,409])
 const after=(await h.view('journal')).entries
 const immutable=e=>JSON.parse(JSON.stringify(e,(k,v)=>['reclassified_by','document_correction_root'].includes(k)?undefined:v))
 for(const e of targets)assert.deepEqual(immutable(after.find(j=>j.id===e.id)),immutable(e),'original posting values are retained')
 // Compare the immutable source values independently of the derived reclassification link.
 for(const l of sourceLines){const posted=after.flatMap(e=>e.lines).find(x=>x.id===l.id);for(const k of ['debit_cents','credit_cents','account_id','class_name','location_name','project_name'])assert.equal(posted[k],l[k])}
 for(const [from,to,accrual,cash]of [['2026-08-01','2026-08-31',4000,0],['2026-09-01','2026-09-30',-1000,1000]])for(const basis of ['accrual','cash']){
  const r=await h.view('reports/profit-and-loss?'+new URLSearchParams({from,to,basis,dimension:'class',dimensionValue:'value:Support'}))
  assert.equal(r.netIncome,basis==='cash'?cash:accrual,`${basis} uses document date or settlement date`);if(r.bridge)assert.equal(r.bridge.ties,true)
 }
 assert.equal((await h.view('reports/profit-and-loss?from=2026-09-01&to=2026-09-30&basis=cash')).netIncome,before.netIncome)
 for(const basis of ['cash','accrual']){const q=new URLSearchParams({from:'2026-08-01',to:'2026-10-31',basis,dimension:'class',dimensionValue:'value:Support'});const sales=await h.view('reports/sales-by-customer?'+q),spend=await h.view('reports/expenses-by-vendor?'+q);assert.equal(sales.rows.find(r=>r.id===customer.id).amount,basis==='cash'?4000:9000);assert.equal(spend.rows.find(r=>r.id===vendor.id).amount,basis==='cash'?3000:6000)}
 const ar=await h.view('reports/receivables?to=2026-09-30&dimension=class&dimensionValue=value:Support')
 const ap=await h.view('reports/payables?to=2026-09-30&dimension=class&dimensionValue=value:Support')
 assert.deepEqual([ar.itemsTotal,ap.itemsTotal],[5000,3000])
 const laterPayment=await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-05',amount:'50',bankAccountId:bank.id,allocations:[{targetId:invoice.id,amount:'50'}]})
 const paid=await h.view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=cash&dimension=class&dimensionValue=value:Support');assert.equal(paid.totalIncome,5000)
 const correction=attempts.find(r=>r.status===200).value.reclassified[0]
 await h.command('journal.reverse',{id:correction.correcting_entry_id,date:'2026-10-20',memo:'Wrong path'},h.owner,409)
 const dest=(await h.view('journal')).entries.find(e=>e.id===correction.correcting_entry_id).lines.find(l=>l.line_no===1)
 await h.command('journal.reclassify',{lineIds:[dest.id],dimensionKind:'location',toDimensionName:'Remote'})
 const settled=await h.view('reports/general-ledger?from=2026-09-01&to=2026-10-31&basis=cash&dimension=location&dimensionValue=value:Remote')
 assert.ok(settled.accounts.flatMap(a=>a.rows).some(l=>l.memo.includes('dimension correction')))
 // A locked settlement period prevents changing recognition in it, atomically.
 const statement=await h.command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-71.csv',content:'Posting Date,Description,Amount\n09/10/2026,Customer payment,40\n09/10/2026,Vendor payment,-30',opening:'0',closing:'10',start:'2026-09-01',end:'2026-09-30',confirmLast4:'3131'})
 let recon=await h.view('reconciliation/'+statement.statement.id)
 for(const line of recon.lines.filter(l=>!l.match_id)){recon=await h.view('reconciliation/'+statement.statement.id);const posting=recon.postings.find(p=>!p.match_id&&Number(p.amount)===line.amount_cents);assert.ok(posting);await h.command('match.approve',{bankLineIds:[line.id],journalLineIds:[posting.id]})}
 await h.command('reconciliation.complete',{statementId:statement.statement.id})
 const close=await h.command('close.tasks',{period:'2026-09'})
 for(const task of close.tasks)await h.command('close.task',{id:task.id,revision:task.revision,done:true})
 await h.command('period.lock',{period:'2026-09'})
 const current=(await h.view('journal')).entries,billCorrection=attempts.find(r=>r.status===200).value.reclassified.find(r=>r.original_line_id===sourceLines[2].id)
 const billDestination=current.find(e=>e.id===billCorrection.correcting_entry_id).lines.find(l=>l.line_no===1)
 const refused=await h.command('journal.reclassify',{lineIds:[billDestination.id],dimensionKind:'project',toDimensionName:'Cypress'},h.owner,409)
 assert.match(refused.error,/locked/i)
 assert.equal((await h.view('journal')).entries.length,current.length)
 await h.command('journal.reverse',{id:laterPayment.journal_id,date:'2026-10-20',memo:'Returned customer payment'})
 assert.equal((await h.view('reports/profit-and-loss?from=2026-10-01&to=2026-10-31&basis=cash&dimension=class&dimensionValue=value:Support')).totalIncome,0)
}

