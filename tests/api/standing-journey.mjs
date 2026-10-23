import assert from 'node:assert/strict'
export async function standingScenario(h,{lines=100,grant=true}={}){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2026-01-01'});await h.command('chart.start',{})
 const state=await h.view('state'),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id])),bank=await h.command('bank-account.save',{name:'synthetic-pantry-2',institution:'synthetic-pantry-3',accountId:acct['1000'],numberLast4:'4821',openingDate:'2026-01-01',openingBalance:'10000'})
 const rule=(await h.command('bank-rule.save',{name:'Synthetic recurring charges',mode:'suggest',direction:'out',descriptionContains:'Synthetic',splits:[{accountId:acct['6200'],percent:'100'}]})).rule
 const permission=grant?await h.command('agent-permission.grant',{name:'Reviewed recurring charges',ruleId:rule.id,ruleRevision:rule.revision,bankAccountId:bank.id,payee:'Synthetic permitted',maxAmount:'15.00',confirm:true}):null
 const rows=Array.from({length:lines},(_,i)=>{const date=new Date(Date.UTC(2026,0,1+i)).toISOString().slice(0,10);return `${date},Synthetic ${i%2===0?'permitted':'held'},-10.00`})
 await h.command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-4.csv',content:'Date,Description,Amount\n'+rows.join('\n')+'\n',opening:'10000',closing:(10000-lines*10).toFixed(2),start:'2026-01-01',end:new Date(Date.UTC(2026,0,lines)).toISOString().slice(0,10),confirmLast4:'4821'})
 return {acct,bank,rule,permission}
}
