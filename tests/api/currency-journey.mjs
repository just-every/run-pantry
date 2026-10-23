import assert from 'node:assert/strict'
export async function currencyScenario(h){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01'});await h.command('chart.start',{});const {accounts}=await h.view('state'),acct=Object.fromEntries(accounts.map(a=>[a.code,a.id]))
 const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic Canadian customer'}),vendor=await h.command('contact.save',{kind:'vendor',name:'Synthetic European vendor'})
 const inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-09-01',dueDate:'2026-09-30',lines:[{description:'synthetic-pantry-2',quantity:'1',rate:'7500.00',accountId:acct['4000'],taxCode:'exempt'}]});await h.command('invoice.approve',{id:inv.id,revision:inv.revision});const issued=await h.command('invoice.issue',{id:inv.id})
 const draft=await h.command('bill.save',{vendorId:vendor.id,reference:'synthetic-pantry-3',billDate:'2026-09-01',dueDate:'2026-09-30',lines:[{description:'synthetic-pantry-4',amount:'1100.00',accountId:acct['6200']}]})
 const bill=await h.command('bill.record',{id:draft.id,revision:draft.revision})
 const rates=[];for(const [currency,date,value] of [['CAD','2026-09-01','0.75'],['CAD','2026-09-30','0.77'],['EUR','2026-09-01','1.10'],['EUR','2026-09-30','1.12']])rates.push(await h.command('currency.rate',{currency,date,usdPerUnit:value,source:'Synthetic published rate sheet',overrideReason:date.endsWith('30')?'Reviewed closing rate override':''}))
 return {acct,inv:issued,bill,rates}
}
