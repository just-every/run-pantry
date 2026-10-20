// Only Stripe's paid network edge is faked; callers use the real auth, API and D1.
export function clearingProvider({ missingRefund = true } = {}) {
  const epoch = day => Date.parse(`${day}T12:00:00Z`)/1000
  const payout={id:'po_clearing',object:'payout',amount:86500,currency:'usd',automatic:true,status:'paid',created:epoch('2026-09-09'),arrival_date:epoch('2026-09-11'),balance_transaction:'txn_payout'}
  const transaction=(id,type,amount,fee,day,source)=>({id,object:'balance_transaction',type,reporting_category:type,currency:'usd',amount,fee,net:amount-fee,created:epoch(day),available_on:epoch(day),source})
  const items=[transaction('txn_charge','charge',100000,3000,'2026-09-05',{id:'ch_clearing',object:'charge',payment_intent:'pi_external'}),
    transaction('txn_refund','refund',-10000,0,'2026-09-06',{id:'re_missing',object:'refund',charge:'ch_clearing'}),
    transaction('txn_dispute_fee','stripe_fee',-500,0,'2026-09-07','fee_dispute'),
    transaction('txn_payout','payout',-86500,0,'2026-09-09',payout)]
  const list=data=>Response.json({object:'list',has_more:false,data})
  const outbound=async request=>{
    const url=new URL(request.url)
    if(url.hostname==='api.resend.com')return Response.json({id:'mail-edge'})
    if(url.hostname!=='api.stripe.com')throw new Error(`Unexpected provider ${url.hostname}`)
    if(url.pathname==='/v1/account')return Response.json({id:'acct_clearing',country:'US',default_currency:'usd',settings:{dashboard:{display_name:'Juniper Lane Design'}}})
    if(url.pathname==='/v1/balance')return Response.json({object:'balance',available:[{currency:'usd',amount:0,source_types:{card:0}}],pending:[{currency:'usd',amount:0,source_types:{card:0}}]})
    if(url.pathname==='/v1/payouts')return list([payout])
    if(url.pathname==='/v1/balance_transactions')return list(url.searchParams.has('payout') ? items : items.filter(i=>!missingRefund||i.id!=='txn_refund'))
    throw new Error(`Unexpected Stripe ${request.method} ${url.pathname}`)
  }
  return {outbound,payout,items,repair(){missingRefund=false},drop(){missingRefund=true}}
}
