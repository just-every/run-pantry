import assert from 'node:assert/strict'

// Runs inside the existing invoices-out registration with real command and read
// routes. The caller supplies its initialized account chart and operating bank.
export async function voidJourney(h, { acct, bank }) {
  const customer=await h.command('contact.save',{kind:'customer',name:'Invoice void customer',email:'void-customer@example.test'})
  const make=async(customerId=customer.id)=>{
    let i=await h.command('invoice.save-draft',{customerId,issueDate:'2026-10-01',dueDate:'2026-10-01',lines:[{description:'Cancelled work',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
    i=await h.command('invoice.approve',{id:i.id,revision:i.revision})
    return h.command('invoice.issue',{id:i.id})
  }
  const inv=await make()
  await h.command('invoice.send',{id:inv.id})
  const path=new URL(h.mail.at(-1).text.match(/http:\/\/[^\s]+\/i\/[A-Za-z0-9_-]{32}/)[0]).pathname
  await h.command('collections.prepare',{})
  const collection=(await h.view('collections')).cases.find(c=>c.invoice_id===inv.id)
  assert.ok(collection)
  const reviewer=await h.member('void-reviewer@example.test','viewer')
  const request={id:inv.id,revision:inv.revision,date:'2026-10-20',reason:'Work cancelled before delivery'}
  await h.command('invoice.void',request,reviewer,403)
  await h.command('invoice.void',{...request,reason:''},h.owner,400)
  await h.command('invoice.void',{...request,revision:'stale'},h.owner,409)
  const before=(await h.view('sales')).invoices.find(i=>i.id===inv.id)
  const taxBefore=await h.view('reports/sales-tax?from=2026-10-01&to=2026-10-31&basis=accrual')
  const result=await h.command('invoice.void',request)
  assert.equal(result.status,'void'); assert.equal(result.open_cents,0)
  assert.equal(result.number,before.number); assert.equal(result.journal_id,before.journal_id)
  assert.equal(result.issued_document_revision,before.issued_document_revision)
  assert.ok(result.void_reversal_id)
  await h.command('invoice.void',request,h.owner,409)
  for(const suffix of ['', '/invoice.pdf', '/pay'])assert.equal((await h.send(path+suffix,suffix==='/pay'?{method:'card'}:undefined)).status,404)
  await h.command('invoice.send',{id:inv.id},h.owner,409)
  await h.command('collections.approve',{id:inv.id,revision:collection.revision},h.owner,409)
  const count=()=>h.mail.filter(m=>m.subject.includes(inv.number)).length, mailBefore=count()
  await h.cron(Date.parse('2026-10-31T12:00:00Z'))
  assert.equal(count(),mailBefore)
  const earlier=await h.view('reports/receivables?to=2026-10-19'),later=await h.view('reports/receivables?to=2026-10-20')
  assert.equal(earlier.items.find(i=>i.id===inv.id).open,10000)
  assert.equal(later.items.some(i=>i.id===inv.id),false)
  assert.equal(earlier.agrees,true);assert.equal(later.agrees,true)
  const taxAfter=await h.view('reports/sales-tax?from=2026-10-01&to=2026-10-31&basis=accrual')
  assert.equal(taxAfter.exempt,taxBefore.exempt-10000)
  assert.equal(taxAfter.ledger.ties,true)
  const journal=(await h.view('journal')).entries,original=journal.find(e=>e.id===inv.journal_id),reversal=journal.find(e=>e.id===result.void_reversal_id)
  assert.deepEqual(reversal.lines.map(l=>[l.account_id,l.debit_cents,l.credit_cents]),original.lines.map(l=>[l.account_id,l.credit_cents,l.debit_cents]))
  const history=await h.view(`customers/${customer.id}?to=2026-10-20`)
  assert.equal(history.summary.open_balance_cents,0)
  assert.ok(history.rows.some(r=>r.id===inv.id))
  // A settled receivable cannot be cancelled under cover of a void.
  const settled=await make()
  await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-10',amount:'10',bankAccountId:bank.id,allocations:[{targetId:settled.id,amount:'10'}]})
  const current=(await h.view('sales')).invoices.find(i=>i.id===settled.id)
  await h.command('invoice.void',{...request,id:current.id,revision:current.revision},h.owner,409)
  assert.equal((await h.view('sales')).invoices.find(i=>i.id===settled.id).open_cents,9000)
}

export async function erasedVoidJourney(h,{acct,bank}) {
  const customer=await h.command('contact.save',{kind:'customer',name:'Cedar cancellation contact',email:'cancelled@example.test'})
  let inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-01',lines:[{description:'Cancelled project',quantity:'1',rate:'100',accountId:acct['4000'],taxCode:'exempt'}]})
  await h.command('invoice.approve',{id:inv.id,revision:inv.revision});inv=await h.command('invoice.issue',{id:inv.id})
  const voided=await h.command('invoice.void',{id:inv.id,revision:inv.revision,date:'2026-10-20',reason:`Cancellation requested by ${customer.email}`})
  const preview=await h.command('erasure.preview',{kind:'contact',id:customer.id})
  assert.deepEqual(preview.blockers,[],'a void is a closed receivable for erasure')
  await h.command('erasure.execute',{kind:'contact',id:customer.id,fingerprint:preview.fingerprint,requester:'Customer',channel:'email',reason:'Remove private contact facts',confirm:'ERASE'})
  const retained=(await h.view('sales')).invoices.find(i=>i.id===inv.id)
  assert.equal(retained.status,'void');assert.equal(retained.void_reversal_id,voided.void_reversal_id)
  assert.ok(!retained.void_reason.includes(customer.email))
  assert.equal((await h.view('reports/receivables?to=2026-10-20')).agrees,true)
}
