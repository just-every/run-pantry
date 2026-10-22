import assert from 'node:assert/strict'
import {books,harness} from './harness.mjs'

// One accounting review: source lines, decisions, postings and audit reconcile.
export async function queueJourney(t){
 const h=await harness();t.after(()=>h.close())
 const {acct}=await books(h),day='2026-10-15'
 const bank=await h.command('bank-account.save',{name:'Review checking',institution:'Local',accountId:acct['1000'],numberLast4:'3131',openingDate:'2026-01-01',openingBalance:'0'})
 const card=await h.command('bank-account.save',{name:'Review card',institution:'Local card',accountId:acct['2100'],numberLast4:'3132',openingDate:'2026-01-01',openingBalance:'0'})
 const vendor=await h.command('contact.save',{kind:'vendor',name:'Review Stationer',defaultAccountId:acct['6200']})
 const customer=await h.command('contact.save',{kind:'customer',name:'Review Customer'})
 const tax=await h.command('tax-code.save',{name:'Review 10%',rate:'10',accountId:acct['2200']})
 const draft=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:day,lines:[{description:'Review service',quantity:'1',rate:'1000',accountId:acct['4000'],taxCode:'exempt'}]})
 const approved=await h.command('invoice.approve',{id:draft.id,revision:draft.revision}),invoice=await h.command('invoice.issue',{id:approved.id})
 const amounts=[-6000,-20000,-500,100000,...Array.from({length:46},(_,i)=>-1000-i)]
 const descriptions=['Three-way review','synthetic-pantry-31-card','Personal purchase','Customer collection',...Array(46).fill(vendor.name)]
 await h.command('statement.import',{bankAccountId:bank.id,fileName:'synthetic-pantry-31.csv',content:'Posting Date,Description,Amount\n'+amounts.map((n,i)=>`10/15/2026,${descriptions[i]},${(n/100).toFixed(2)}`).join('\n'),opening:'0',closing:(amounts.reduce((a,b)=>a+b,0)/100).toFixed(2),start:day,end:day,confirmLast4:'3131'})
 const lines=async()=>(await h.view('bank/lines')).lines
 const all=await lines();assert.equal(all.length,50);assert.ok(all.every(l=>!l.match_id))
 const split=all.find(l=>l.description===descriptions[0]),transfer=all.find(l=>l.description===descriptions[1]),personal=all.find(l=>l.description===descriptions[2]),collection=all.find(l=>l.description===descriptions[3])
 const splitMatch=await h.command('match.approve',{bankLineIds:[split.id],create:[
  {type:'fee',amount:'33',accountId:acct['6100'],contactId:vendor.id,taxCodeId:tax.id,memo:'Reviewed split',className:'Studio',locationName:'Albany',projectName:'Cedar'},
  {type:'fee',amount:'17',accountId:acct['6200'],memo:'Software share'},
  {type:'fee',amount:'10',accountId:acct['6300'],memo:'Office share'}]})
 const posted=(await h.view('journal')).entries.filter(e=>e.source_kind==='bank')
 const tagged=posted.flatMap(e=>e.lines).find(l=>l.class_name==='Studio'&&l.account_id===acct['6100'])
 assert.deepEqual([tagged.debit_cents,tagged.memo,tagged.contact_id,tagged.location_name,tagged.project_name],[3000,'Reviewed split',vendor.id,'Albany','Cedar'])
 assert.equal(posted.flatMap(e=>e.lines).find(l=>l.account_id===acct['2200']).debit_cents,300)
 await h.command('match.approve',{bankLineIds:[transfer.id],create:[{type:'transfer',amount:'200',direction:'out',otherBankAccountId:card.id}]})
 await h.command('bank-line.exclude',{id:personal.id,kind:'personal',reason:'Owner personal purchase, retained for review'})
 const excluded=(await lines()).find(l=>l.id===personal.id)
 assert.equal(excluded.excluded_reason,'Owner personal purchase, retained for review');assert.equal(excluded.excluded_by,'owner@example.test')
 await h.command('match.approve',{bankLineIds:[personal.id],create:[{type:'fee',amount:'5',accountId:acct['6200']}]},h.owner,409)
 await h.command('bank-rule.save',{name:'Excluded personal',descriptionContains:descriptions[2],accountId:acct['6200'],fileExisting:true})
 assert.equal((await lines()).find(l=>l.id===personal.id).match_id,null)
 await h.command('match.approve',{bankLineIds:[collection.id],create:[{type:'receipt',amount:'1000',contactId:customer.id,allocations:[{targetId:invoice.id,amount:'1000'}]}]})
 assert.equal((await h.view('sales')).invoices.find(i=>i.id===invoice.id).open_cents,0)
 const ordinary=(await lines()).filter(l=>l.description===vendor.name),selected=ordinary.slice(0,20).map(l=>l.id)
 let preview=await h.command('bank-queue.preview',{ids:selected})
 assert.equal(preview.items.length,20);assert.ok(preview.items.every(i=>i.available&&i.suggestion.accountId===acct['6200']))
 // One stale source invalidates the complete batch, leaving the other 19 open.
 await h.command('bank-line.exclude',{id:selected[0],kind:'duplicate',reason:'Review a possible duplicate'})
 await h.command('bank-queue.accept',{items:preview.items.map(i=>({id:i.id,fingerprint:i.fingerprint}))},h.owner,409)
 assert.ok((await lines()).filter(l=>selected.includes(l.id)).every(l=>!l.match_id))
 const held=(await lines()).find(l=>l.id===selected[0])
 await h.command('bank-line.exclude',{id:held.id,revision:held.exclusion_revision,restore:true,reason:'Verified unique source transaction'})
 preview=await h.command('bank-queue.preview',{ids:selected})
 await h.command('bank-queue.accept',{items:preview.items.map(i=>({id:i.id,fingerprint:i.fingerprint}))})
 const rest=ordinary.slice(20).map(l=>l.id),restPreview=await h.command('bank-queue.preview',{ids:rest})
 await h.command('bank-queue.accept',{items:restPreview.items.map(i=>({id:i.id,fingerprint:i.fingerprint}))})
 let queue=await lines();assert.equal(queue.filter(l=>l.match_id).length,49);assert.equal(queue.filter(l=>l.excluded_at).length,1)
 const undo=queue.find(l=>l.id===selected[1])
 await h.command('match.undo',{id:undo.match_id,reason:'Recheck one classification'})
 queue=await lines();assert.equal(queue.find(l=>l.id===undo.id).match_id,null)
 const tb=await h.view('reports/trial-balance?to=2026-10-31&basis=accrual'),net=id=>tb.rows.find(r=>r.id===id)?.net??0
 const ordinaryAmount=ordinary.reduce((n,l)=>n+l.amount_cents,0)
 assert.equal(tb.balanced,true);assert.equal(net(acct['1000']),74000+ordinaryAmount-undo.amount_cents)
 assert.equal(net(acct['2100']),20000)
 const activity=await h.view('activity'),events=activity.audit
 assert.ok(events.some(e=>e.action==='bank-line.exclude'));assert.ok(events.some(e=>e.action==='bank-line.restore'))
 assert.ok(events.some(e=>e.action==='bank-queue.accept'));assert.ok(events.some(e=>e.action==='match.undo'))
 const readOnly=await h.member('synthetic-pantry-31@example.test','viewer')
 await h.command('bank-queue.preview',{ids:[split.id]},readOnly,403)
 // Split undo reverses all three newly created entries and keeps its tags.
 await h.command('match.undo',{id:splitMatch.id,reason:'Recheck split'})
 const reversals=(await h.view('journal')).entries.filter(e=>e.source_kind==='reversal')
 assert.ok(reversals.some(e=>e.lines.some(l=>l.class_name==='Studio'&&l.credit_cents===3000)))
 assert.equal((await h.view('reports/trial-balance?to=2026-10-31&basis=accrual')).balanced,true)
}
