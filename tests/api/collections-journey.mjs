export async function collectionsScenario(h){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01'});await h.command('chart.start',{})
 const state=await h.view('state'),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id])),invoices=[],customers=[]
 const bank=await h.command('bank-account.save',{name:'synthetic-pantry-2',institution:'synthetic-pantry-3',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'0'})
 for(let n=0;n<5;n++){const customer=await h.command('contact.save',{kind:'customer',name:'Synthetic customer '+n,email:`synthetic-pantry-${n+10}@example.test`});customers.push(customer)
  const i=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-01-01',dueDate:'2026-01-31',lines:[{description:'synthetic-pantry-4',quantity:'1',rate:'100.00',accountId:acct['4000'],taxCode:'exempt'}]});await h.command('invoice.approve',{id:i.id,revision:i.revision});await h.command('invoice.issue',{id:i.id});invoices.push(i)
 }
 await h.command('collections.prepare',{})
 return {acct,bank,invoices,customers}
}
