import assert from 'node:assert/strict'

export function refundProvider() {
  const intents = new Map(), refunds = new Map()
  let status = 'succeeded'
  return { intents, refunds, pending: () => { status = 'pending' }, succeed: () => { status = 'succeeded'; for (const r of refunds.values()) r.status = status },
    async outbound(request) {
      const url = new URL(request.url)
      assert.equal(url.host, 'api.stripe.com')
      if (url.pathname === '/v1/account') return Response.json({id:'synthetic-pantry-account',country:'US',default_currency:'usd'})
      if (url.pathname.startsWith('/v1/payment_intents/')) return Response.json(intents.get(url.pathname.split('/').at(-1)))
      if (url.pathname === '/v1/refunds') {
        const key = request.headers.get('idempotency-key'), b = new URLSearchParams(await request.text())
        assert.ok(key)
        if (!refunds.has(key)) refunds.set(key,{id:`synthetic-pantry-refund-${refunds.size}`,status,amount:Number(b.get('amount')),currency:'usd',payment_intent:b.get('payment_intent'),created:Date.parse('2026-10-26T12:00:00Z')/1000})
        return Response.json(refunds.get(key))
      }
      if (url.pathname.startsWith('/v1/refunds/')) return Response.json([...refunds.values()].find(r=>r.id===url.pathname.split('/').at(-1)))
      throw new Error(`Unexpected Stripe request ${request.method} ${url.pathname}`)
    } }
}

export async function recordedRefundJourney({h,pay,customer,bank,bea,ann}) {
  const body={sourceKind:'payment',sourceId:pay.id,amount:'200',date:'2026-09-12',bankAccountId:bank.id,method:'recorded',reason:'Return the customer overpayment'}
  await h.command('customer-refund.prepare',{...body,amount:'200.01'},bea,409)
  let refund=await h.command('customer-refund.prepare',body,bea)
  await h.command('customer-refund.post',{id:refund.id},ann,409)
  await h.command('customer-refund.approve',{id:refund.id,revision:refund.revision},bea,403)
  refund=await h.command('customer-refund.approve',{id:refund.id,revision:refund.revision},ann)
  const other=await h.command('customer-refund.prepare',{...body,amount:'0.01'},h.owner,409)
  assert.match(other.error,/available/)
  refund=await h.command('customer-refund.post',{id:refund.id},ann)
  assert.equal(refund.status,'succeeded')
  assert.equal((await h.command('customer-refund.post',{id:refund.id},ann)).journal_id,refund.journal_id)
  const ar=await h.view('reports/receivables?to=2026-09-30')
  assert.deepEqual([ar.unapplied,ar.subledger,ar.agrees],[0,0,true])
  assert.equal((await h.view(`customers/${customer.id}?asOf=2026-09-30`)).summary.open_balance_cents,0)
  const journal=(await h.view('journal')).entries.find(e=>e.id===refund.journal_id)
  assert.equal(journal.lines.reduce((n,l)=>n+l.debit_cents-l.credit_cents,0),0)
  await h.command('journal.reverse',{id:pay.journal_id,date:'2026-09-13',memo:'Invalid reversal after refund'},ann,409)
}

/** Shared HTTP scenario used with a network fake and with the held Stripe test account. */
export async function stripeRefundScenario({h,acct,createIntent,key,date='2026-10-26'}) {
  await h.command('stripe.connect',{secretKey:key})
  const state=await h.view('state'), bank=state.bankAccounts.find(b=>b.institution==='Stripe')
  const customer=await h.command('contact.save',{kind:'customer',name:'Cedar refund customer',email:'refund@example.test'})
  const make=async(amount,early=false)=>{
    let inv=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:date,dueDate:date,...(early?{earlyPayment:{percent:'2',days:'10'}}:{}),lines:[{description:'Completed design work',quantity:'1',rate:amount,accountId:acct['4000'],taxCode:'exempt'}]})
    await h.command('invoice.approve',{id:inv.id,revision:inv.revision});return h.command('invoice.issue',{id:inv.id})
  }
  const inv=await make('1000'), intent=await createIntent({amount:120000,invoiceId:inv.id})
  const payment=await h.command('payment.record',{direction:'received',contactId:customer.id,date,amount:'1200',bankAccountId:bank.id,reference:intent.id,allocations:[{targetId:inv.id,amount:'1000'}]})
  const body={sourceKind:'payment',sourceId:payment.id,method:'stripe',amount:'200',date,bankAccountId:bank.id,reason:'Return the $200 overpayment'}
  let refund=await h.command('customer-refund.prepare',body)
  refund=await h.command('customer-refund.approve',{id:refund.id,revision:refund.revision})
  refund=await h.command('customer-refund.post',{id:refund.id})
  if(refund.status==='pending') return {refund,payment,invoice:inv,customer,bank}
  assert.equal(refund.status,'succeeded');assert.ok(refund.provider_id)
  assert.equal((await h.command('customer-refund.post',{id:refund.id})).journal_id,refund.journal_id)
  await h.command('customer-refund.prepare',{...body,amount:'0.01'},h.owner,409)
  const ar=await h.view(`reports/receivables?to=${date}`);assert.equal(ar.agrees,true)
  assert.equal((await h.view(`customers/${customer.id}`)).summary.open_balance_cents,0)
  assert.equal((await h.view('sales')).invoices.find(i=>i.id===inv.id).open_cents,0)
  return {refund,payment,invoice:inv,customer,bank}
}

export async function creditRefundJourney({h,acct,bank,provider,paid}) {
  const {customer,invoice,payment}=paid
  const credit=async(amount)=>{
    let c=await h.command('invoice.save-draft',{kind:'credit',customerId:customer.id,creditFor:invoice.id,issueDate:'2026-10-26',lines:[{description:'Goodwill allowance',quantity:'1',rate:amount,accountId:acct['4000'],taxCode:'exempt'}]})
    await h.command('invoice.approve',{id:c.id,revision:c.revision});return h.command('invoice.issue',{id:c.id})
  }
  const c=await credit('100')
  let refund=await h.command('customer-refund.prepare',{sourceKind:'credit',sourceId:c.id,paymentId:payment.id,bankAccountId:bank.id,method:'stripe',amount:'100',date:'2026-10-26',reason:'Return the customer credit balance'})
  await h.command('customer-refund.approve',{id:refund.id,revision:refund.revision})
  provider.pending()
  refund=await h.command('customer-refund.post',{id:refund.id})
  assert.equal(refund.status,'pending');assert.equal(refund.journal_id,null)
  assert.equal((await h.view('sales')).invoices.find(i=>i.id===c.id).open_cents,0,'pending refund reserves the credit')
  await h.command('customer-refund.prepare',{sourceKind:'credit',sourceId:c.id,bankAccountId:bank.id,method:'recorded',amount:'0.01',date:'2026-10-26',reason:'Cannot spend reserved credit'},h.owner,409)
  provider.succeed()
  refund=await h.command('customer-refund.post',{id:refund.id})
  assert.equal(refund.status,'succeeded');assert.ok(refund.journal_id)
  assert.equal((await h.view('reports/receivables?to=2026-10-26')).agrees,true)
  const discount=await h.command('account.save',{code:'4960',name:'Customer discounts',type:'expense'})
  const settings=(await h.view('invoicing')).discounts.settings
  await h.command('discount-settings.save',{discountAccountId:discount.id,earlyAccountId:discount.id,revision:settings?.revision})
  let early=await h.command('invoice.save-draft',{customerId:customer.id,issueDate:'2026-10-26',earlyPayment:{percent:'2',days:'10'},lines:[{description:'Discounted project',quantity:'1',rate:'1000',accountId:acct['4000'],taxCode:'exempt'}]})
  await h.command('invoice.approve',{id:early.id,revision:early.revision});early=await h.command('invoice.issue',{id:early.id})
  const p=await h.command('payment.record',{direction:'received',contactId:customer.id,date:'2026-10-26',amount:'1000',bankAccountId:bank.id,allocations:[{targetId:early.id,amount:'1000'}]})
  assert.equal((await h.view('sales')).payments.find(x=>x.id===p.id).unallocated_cents,2000)
  const body={sourceKind:'payment',sourceId:p.id,bankAccountId:bank.id,method:'recorded',amount:'20',date:'2026-10-26',reason:'Return excess after the earned early discount'}
  await h.command('customer-refund.prepare',{...body,amount:'20.01'},h.owner,409)
  const book=await h.member('refund-preparer@example.test','bookkeeper',{canPost:true})
  let r=await h.command('customer-refund.prepare',body,book)
  await h.command('customer-refund.approve',{id:r.id,revision:r.revision},book,403)
  await h.command('issuing-limit.save',{id:'person:refund-preparer@example.test',credit:'20',issuing:'1000'})
  const limit=(await h.view('state',book)).settings.issuingLimits.effective
  r=await h.command('customer-refund.approve',{id:r.id,revision:r.revision,limitRevision:limit.revision},book)
  assert.match(r.self_approval,/self-approved within limit/)
  await h.command('customer-refund.post',{id:r.id},book)
  assert.equal((await h.view('sales')).invoices.find(i=>i.id===early.id).open_cents,0,'overpayment refund leaves the earned discount and paid invoice intact')
  const ar=await h.view('reports/receivables?to=2026-10-26');assert.equal(ar.agrees,true)
}
