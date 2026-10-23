import test from 'node:test'
import assert from 'node:assert/strict'
import { searchHarness,searchScenario } from './search-scenario.mjs'

test('SEARCH-001 amount, range, reference and words find current records without counting inaccessible books', async t=>{
 const h=await searchHarness();t.after(()=>h.close())
 const {acct,bank,vendor,inv,payment,bill,check}=await searchScenario(h)
 const flat=v=>v.groups.flatMap(g=>g.records), find=async q=>flat(await h.view('search?'+new URLSearchParams(q)))
 for(const q of ['1234.56','$1,234.56','1,234.56']) {
  const results=await find({q});assert.ok(results.some(r=>r.id===inv.id));assert.ok(results.some(r=>r.id===payment.id));assert.ok(results.some(r=>r.type==='bank-line'))
 }
 assert.ok((await find({min:'1200',max:'1300'})).some(r=>r.id===inv.id))
 assert.deepEqual((await find({q:'1047',type:'bill'})).map(r=>r.id).sort(),[bill.id,check.checks[0].expense_bill_id].sort())
 assert.equal((await find({q:'1047',type:'check'}))[0].number,'1047')
 assert.ok((await find({q:'synthetic-pantry-4 alias'})).some(r=>r.id===bill.id))
 assert.ok((await find({q:'synthetic-pantry-20.pdf'})).some(r=>r.type==='document'))
 assert.equal((await find({q:'cedar wood'}))[0].id,bill.id)
 assert.equal((await find({q:'pine supplies'}))[0].id,bill.id)
 assert.ok((await find({q:vendor.name})).some(r=>r.id===bill.id))
 assert.ok((await find({q:'45.00',account:acct['6200']})).some(r=>r.id===bill.id))
 assert.equal((await find({q:'45.00',from:'2026-04-01',type:'bill'})).length,0)
 assert.equal((await find({q:'%'})).length,0,'wildcards are literal')
 const sales=await h.member('synthetic-pantry-10@example.test','sales')
 assert.equal(flat(await h.view('search?q=987.65',sales)).length,0)
 assert.deepEqual(flat(await h.view('search?q=1234.56',sales)).map(r=>r.id),[inv.id])
 const accountant=await h.member('synthetic-pantry-11@example.test','accountant',{bankAccounts:[]})
 assert.equal(flat(await h.view('search?q=987.65',accountant)).length,0)
 assert.equal(flat(await h.view('search?type=bank-line',accountant)).length,0)
 for(const r of await find({q:'1234.56'})) assert.equal((await find({type:r.type,record:r.id}))[0].id,r.id)
 await h.view('search?min=500&max=100',undefined,400)
 const integration=await h.command('integration.create',{name:'synthetic-pantry-12',scopes:['invoices:read']})
 const api=await h.send('/api/pantry/integration/v1/search?q=1234.56',undefined,{headers:{authorization:`Bearer ${integration.token}`}})
 assert.equal(api.status,200,JSON.stringify(api.value));assert.deepEqual(flat(api.value).map(r=>r.id),[inv.id])
})
