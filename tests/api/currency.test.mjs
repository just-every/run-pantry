import test from 'node:test'
import assert from 'node:assert/strict'
import { harness } from './harness.mjs'
import { currencyScenario } from './currency-journey.mjs'
test('CURRENCY-001 source-attested rates, exact home totals and retained nonposting comparisons',async t=>{
 const h=await harness();t.after(()=>h.close());const {inv,bill,rates}=await currencyScenario(h),before=await h.view('reports/trial-balance?asOf=2026-09-30&basis=accrual')
 const quote=await h.command('currency.quote',{rateId:rates[0].id,amount:'10000.00'});assert.equal(quote.homeCents,750000)
 for(const [kind,native,rate,amount,newRate,gain] of [['invoice',inv,rates[0],'10000.00',rates[1],20000],['bill',bill,rates[2],'1000.00',rates[3],-2000]]){
  const view=await h.command('currency.link',{kind,targetId:native.id,revision:native.revision,rateId:rate.id,amount,confirm:true}),d=view.documents.find(d=>d.target_id===native.id)
  const p=await h.command('currency.preview',{id:d.id,rateId:newRate.id,date:'2026-09-30',retain:true});assert.equal(p.realizedGainCents,gain);assert.equal(p.unrealizedGainCents,gain);assert.equal(p.revaluation.reversesOn,'2026-10-01');assert.equal(p.postsNothing,true);assert.match(p.revaluation.status,/preview only/)
 }
 assert.deepEqual(await h.view('reports/trial-balance?asOf=2026-09-30&basis=accrual'),before)
 await h.command('currency.link',{kind:'bill',targetId:bill.id,revision:bill.revision,rateId:rates[2].id,amount:'999',confirm:true},undefined,400)
 const half=await h.command('currency.rate',{currency:'CAD',date:'2026-09-01',usdPerUnit:'0.5',source:'Synthetic half cent test'});assert.equal((await h.command('currency.quote',{rateId:half.id,amount:'0.01'})).homeCents,1)
 await h.command('currency.rate',{currency:'CAD',date:'2026-09-01',usdPerUnit:'1e6',source:'synthetic-pantry-5'},undefined,400)
 const reader=await h.member('synthetic-pantry-6@example.test','viewer');await h.view('currency',reader,403);await h.command('currency.rate',{currency:'CAD'},reader,403)
 const accountant=await h.member('synthetic-pantry-7@example.test','accountant');assert.equal((await h.view('currency',accountant)).documents.length,2)
})
