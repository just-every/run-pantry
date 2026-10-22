import assert from 'node:assert/strict'
import {books,harness} from './harness.mjs'
import {downloadSpreadsheet} from '../xlsx.mjs'

export async function reportExportParity(t){
 const h=await harness();t.after(h.close);const {acct}=await books(h)
 const settings=(await h.view('dimensions')).settings
 await h.command('dimensions.settings',{revision:settings.revision,class:true,location:true,project:true})
 for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await h.command('dimension.save',{kind,name})
 const tags={className:'Studio',locationName:'New York',projectName:'Cedar'}
 const bank=await h.command('bank-account.save',{name:'Operating checking',institution:'Synthetic bank',accountId:acct['1000'],numberLast4:'3131',openingDate:'2024-01-01',openingBalance:'0'})
 const customer=await h.command('contact.save',{kind:'customer',name:'Cedar Workshop'}),vendor=await h.command('contact.save',{kind:'vendor',name:'Brightline Software'})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-01',lines:[{description:'Cedar design',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt',...tags}]})
 await h.command('invoice.approve',{id:draft.id,revision:draft.revision});const inv=await h.command('invoice.issue',{id:draft.id})
 const bill=await h.command('bill.save',{vendorId:vendor.id,billDate:'2026-10-01',reference:'synthetic-pantry-101',post:true,lines:[{description:'Studio software',amount:'20',accountId:acct['6200'],...tags}]})
 for(const [direction,contactId,targetId,amount]of [['received',customer.id,inv.id,'40'],['paid',vendor.id,bill.id,'10']])await h.command('payment.record',{direction,contactId,date:'2026-10-10',amount,bankAccountId:bank.id,method:'ach',allocations:[{targetId,amount}],...tags})
 const adjustment=await h.command('journal.save-draft',{date:'2026-12-31',memo:'Cedar annual adjustment',adjusting:true,lines:[{accountId:acct['6200'],debit:'2',...tags},{accountId:acct['3000'],credit:'2',...tags}]});await h.command('journal.post',{id:adjustment.id,revision:adjustment.revision})
 const budget=await h.command('budget.save',{name:'Cedar plan',startMonth:'2026-01',cells:[{accountId:acct['4000'],month:'2026-10',amount:'120',...tags}]})
 const journal=await h.view('journal')
 const paths=['cash-flow','receivables','payables','adjusting-entries','contractors','budget-actual','project-profitability']
 for(const basis of ['cash','accrual'])for(const kind of paths){
  const query=new URLSearchParams({from:'2026-10-01',to:'2026-10-31',basis,budget:budget.id,projectName:'Cedar',year:'2026',dimension:'class',dimensionValue:'value:Studio'})
  const csv=await h.send(`/api/pantry/reports/${kind}/export?${query}&format=csv`,undefined,{cookie:h.owner});assert.equal(csv.status,200,JSON.stringify(csv.value));assert.doesNotMatch(csv.value,/undefined/)
  const pdf=await h.send(`/api/pantry/reports/${kind}/export?${query}&format=pdf`,undefined,{cookie:h.owner});assert.equal(pdf.status,200);assert.match(pdf.value,/%PDF/)
  const xlsx=await downloadSpreadsheet(h.origin,`reports/${kind}/export?${query}&format=xlsx`,h.owner)
  if(kind==='cash-flow'){const r=await h.view('reports/cash-flow?'+query);assert.equal(xlsx.find(row=>row[0]==='Closing cash')[1],r.closing/100);assert.match(csv.value,/Indirect method - accrual starting income/)}
  if(kind==='receivables'||kind==='payables'){const r=await h.view('reports/'+kind+'?'+query);assert.equal(xlsx.find(row=>row[0]==='Open items')[1],r.itemsTotal/100);assert.match(csv.value,/Open items - accrual basis/)}
  if(kind==='budget-actual'){const r=await h.view(`budgets/${budget.id}/report?${query}`);assert.deepEqual(xlsx.find(row=>row[0]==='Net income').slice(1,4),[r.netIncome.budget/100,r.netIncome.actual/100,r.netIncome.variance/100])}
  if(kind==='project-profitability'){const r=await h.view('dimensions/project?name=Cedar&'+query);assert.equal(xlsx.find(row=>row[0]==='Profit')[1],r.profit/100)}
  if(kind==='adjusting-entries'){assert.ok(xlsx.some(row=>row.includes('Cedar annual adjustment')));assert.match(csv.value,/2026-12-31/)}
 }
 for(const basis of ['cash','accrual']){
  const pkg=await h.view('package/2026-10?basis='+basis),query=`basis=${basis}`
  const xlsx=await downloadSpreadsheet(h.origin,`package/2026-10/export?${query}&format=xlsx`,h.owner)
  assert.equal(xlsx.find(row=>row[0]==='balanceSheet.totalAssets')[1],pkg.balanceSheet.totalAssets/100)
  assert.equal(xlsx.find(row=>row[0]==='profitAndLoss.period.netIncome')[1],pkg.profitAndLoss.period.netIncome/100)
  assert.ok(xlsx.some(row=>row[3]==='Open items - accrual basis'));assert.ok(xlsx.some(row=>row[3]==='Whole-business evidence'))
  for(const format of ['pdf','csv']){const file=await h.send(`/api/pantry/package/2026-10/export?${query}&format=${format}`,undefined,{cookie:h.owner});assert.equal(file.status,200);assert.ok(file.value.includes('balanceSheet.totalAssets'))}
 }
 assert.deepEqual((await h.view('journal')).entries,journal.entries,'Exports do not alter posted books')
 await h.command('contractor.save',{contactId:vendor.id,is1099:true,legalName:'Brightline Software LLC',tinKind:'ein',tin:'000000001',address:'1 Synthetic Lane',city:'Albany',state:'NY',zip:'12207'})
 await h.command('payment.record',{direction:'paid',contactId:vendor.id,date:'2025-10-10',amount:'700',bankAccountId:bank.id,method:'check',allocations:[],...tags})
 const reader=await h.member('synthetic-pantry-102@example.test','viewer')
 for(const format of ['pdf','xlsx']){
  await h.view(`reports/contractors/2025/1099-nec.${format}`,reader,403)
  const file=await h.send(`/api/pantry/reports/contractors/2025/1099-nec.${format}`,undefined,{cookie:h.owner});assert.equal(file.status,200)
 }
 const filing=await downloadSpreadsheet(h.origin,'reports/contractors/2025/1099-nec.xlsx',h.owner)
 assert.equal(filing[1][12],700);assert.equal(filing[1][7],'00-0000001')
 const activity=await h.view('activity');assert.ok(activity.audit.some(a=>a.action==='contractor.1099-export'))
}
