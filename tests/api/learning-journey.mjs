import assert from 'node:assert/strict'
// Public commands resolve the real quarterly questions; no canned proposal or
// direct database insertion supplies the recommendation under test.
export async function learningScenario(h){
 await h.command('entity.save',{legalName:'synthetic-pantry-1',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2025-01-01'});await h.command('chart.start',{})
 const state=await h.view('state'),acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 const prepaid=await h.command('account.save',{code:'1510',name:'Prepaid insurance',type:'asset',subtype:'other'}),expense=await h.command('account.save',{code:'6910',name:'Insurance expense',type:'expense',subtype:'other'})
 const vendor=await h.command('contact.save',{kind:'vendor',name:'Synthetic Insurance'}),other=await h.command('contact.save',{kind:'vendor',name:'Different Insurance'})
 const bank=await h.command('bank-account.save',{name:'synthetic-pantry-2',institution:'synthetic-pantry-3',accountId:acct['1000'],numberLast4:'4821',openingDate:'2025-01-01',openingBalance:'10000'})
 await h.command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-4.csv',content:'Date,Description,Amount\n2026-01-01,Synthetic Insurance,-1200.00\n2026-04-01,Synthetic Insurance,-1200.00\n2026-07-01,Synthetic Insurance,-1200.00\n2026-07-02,Different Insurance,-1200.00\n',opening:'10000',closing:'5200',start:'2026-01-01',end:'2026-07-31',confirmLast4:'4821'})
 const settings=(await h.view('questions')).agent.settings;await h.command('books-agent.save',{...settings,emailOn:false,fileDays:0,depositDays:0})
 await h.command('books-agent.run',{})
 const questions=(await h.view('questions')).open.filter(q=>q.kind==='unfiled'&&q.facts['The bank says']==='Synthetic Insurance')
 assert.equal(questions.length,3)
 for(const question of questions){const effects=await h.command('question.preview',{id:question.id,accountId:prepaid.id,note:'Quarterly insurance prepaid; recognize over coverage months'});await h.command('question.answer',{id:question.id,accountId:prepaid.id,previewToken:effects.effects.token,note:'Quarterly insurance prepaid; recognize over coverage months'})}
 await h.command('learned.check',{})
 const proposal=(await h.view('learned-recognition')).proposals.find(p=>p.vendor_id===vendor.id);assert.ok(proposal)
 return {acct,prepaid,expense,vendor,other,bank,proposal}
}
