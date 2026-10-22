import assert from 'node:assert/strict'
import {providerWorker} from './provider-worker.mjs'
import {TOKEN} from './worker.mjs'

export async function reportDeliverySeed(t,browser){
 const mail=[]
 const app=await providerWorker({bindings:{MAIL_PROVIDER:'resend',MAIL_API_KEY:'synthetic-pantry-110'},outbound:async request=>{assert.equal(new URL(request.url).hostname,'api.resend.com');mail.push(await request.json());return Response.json({id:'synthetic-pantry-'+mail.length})}});t.after(()=>app.close())
 const owner=await browser.newContext();t.after(()=>owner.close());const {origin}=app
 await owner.request.post(origin+'/auth/bootstrap',{headers:{origin},data:{token:TOKEN,displayName:'Rosa Rivera'},maxRedirects:0})
 await owner.request.post(origin+'/setup',{headers:{origin},form:{confirm:'yes'},maxRedirects:0})
 const command=async(op,data,context=owner)=>{const r=await context.request.post(origin+'/api/pantry/command/'+op,{headers:{origin},data});assert.equal(r.status(),200,await r.text());return r.json()}
 const view=async(path,context=owner)=>{const r=await context.request.get(origin+'/api/pantry/'+path);assert.equal(r.status(),200,await r.text());return r.json()}
 await command('entity.save',{legalName:'Juniper Studio LLC',entityType:'single-member-llc',state:'NY',fiscalYearStart:1,taxMethod:'cash',booksStart:'2025-01-01'})
 await command('chart.start',{});let state=await view('state');const acct=Object.fromEntries(state.accounts.map(a=>[a.code,a.id]))
 await command('dimensions.settings',{revision:state.dimensions.settings.revision,class:true,location:true,project:true})
 for(const [kind,name]of [['class','Studio'],['location','New York'],['project','Cedar']])await command('dimension.save',{kind,name})
 const tags={className:'Studio',locationName:'New York',projectName:'Cedar'}
 const bank=await command('bank-account.save',{name:'Operating checking',institution:'Juniper Bank',accountId:acct['1000'],numberLast4:'3131',openingDate:'2025-01-01',openingBalance:'0'})
 const vendor=await command('contact.save',{kind:'vendor',name:'Brightline Software'})
 await command('contractor.save',{contactId:vendor.id,is1099:true,legalName:'Brightline Software LLC',tinKind:'ein',tin:'000000001',address:'1 Synthetic Lane',city:'Albany',state:'NY',zip:'12207'})
 const bill=await command('bill.save',{vendorId:vendor.id,billDate:'2025-10-10',reference:'Studio annual service',post:true,lines:[{description:'Annual design support',amount:'700',accountId:acct['6200'],...tags}]})
 await command('payment.record',{direction:'paid',contactId:vendor.id,date:'2025-10-10',amount:'700',bankAccountId:bank.id,method:'check',reference:'1047',allocations:[{targetId:bill.id,amount:'700'}],...tags})
 const journal=await command('journal.save-draft',{date:'2026-10-15',memo:'Cedar project consulting',lines:[{accountId:acct['1000'],debit:'100',...tags},{accountId:acct['4000'],credit:'100',...tags}]});await command('journal.post',{id:journal.id,revision:journal.revision})
 for(const [year,date,description,amount,opening,closing]of [['2025','10/10/2025','Brightline service','-700','0','-700'],['2026','10/15/2026','Cedar consulting','100','-700','-600']]){
  const imported=await command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-'+year+'.csv',content:`Posting Date,Description,Amount\n${date},${description},${amount}`,opening,closing,start:year+'-10-01',end:year+'-10-31',confirmLast4:'3131'})
  const r=await view('reconciliation/'+imported.statement.id),line=r.lines[0],posting=r.postings.find(p=>Number(p.amount)===line.amount_cents&&!p.match_id);assert.ok(posting)
  await command('match.approve',{bankLineIds:[line.id],journalLineIds:[posting.id]});await command('reconciliation.complete',{statementId:imported.statement.id})
 }
 const budget=await command('budget.save',{name:'Cedar annual plan',startMonth:'2026-01',cells:[{accountId:acct['4000'],month:'2026-10',amount:'120',...tags}]})
 const custom=await command('custom-report.save',{definition:{name:'Cedar operating result',source:'profit-and-loss',from:'2026-10-01',to:'2026-10-31',basis:'cash',allColumns:true}})
 const pkg=await command('management-package.save',{name:'Cedar lender packet',reportIds:[custom.id],cover:'October operating review',commentary:['Owner reviewed Cedar results']})
 const email='synthetic-pantry-111@example.test';await command('member.save',{email,name:'Jordan Lee',role:'accountant'})
 const message=mail.findLast(m=>[m.to].flat().includes(email)),token=new URL(message.text.match(/http:\/\/[^\s]+\/auth\/confirm\?token=[^\s]+/)[0]).searchParams.get('token')
 const accountant=await browser.newContext();t.after(()=>accountant.close());const confirmed=await accountant.request.post(origin+'/auth/confirm',{headers:{origin},data:{token},maxRedirects:0});assert.equal(confirmed.status(),303)
 return {app,origin,owner,accountant,command,view,mail,budget,pkg}
}
