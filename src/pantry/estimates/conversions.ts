// A conversion reserves part of the accepted revision in the same batch as its
// native draft. Integer cumulative shares make the final invoice the exact
// remainder of each accepted component, including tax and discounts.
import { authority, must, who } from '../access'
import { bankAuthority } from '../access-policy/banks'
import { addDays, cents, date, now, optionalText, requireThat, scale, sha256, text, uid, type Data } from '../core'
import { assertOpen, audit, changed, guard, one, periodOpen, q, run } from '../db'
import type { Context } from '../context'
import { invoice, lineStatements, nextNumber, discountColumns } from '../invoices'
import { computeOffer, parseTerms } from '../early-payment'
import { discountSettings, milliPercent } from '../discounts'
import { customerDeposit } from '../customer-deposits/store'
import { estimate, estimateRaw } from './store'
import { documentSelectionStatements } from '../invoice-documents'

function slicePricing(p:Data,before:number,after:number):Data{
  const share=(v:number)=>scale(v,after,p.total)-scale(v,before,p.total)
  const full=before===0&&after===p.total
  const lines=p.lines.map((l:Data)=>({...l,qty:full?l.qty:1000,unit:full?l.unit:share(l.amount),amount:share(l.amount),discount:share(l.discount),tax:share(l.tax)}))
  const subtotal=lines.reduce((s:number,l:Data)=>s+l.amount,0),discount=lines.reduce((s:number,l:Data)=>s+l.discount,0),tax=lines.reduce((s:number,l:Data)=>s+l.tax,0)
  const afterTax=share(p.afterTax),target=after-before,diff=target-(subtotal-discount+tax-afterTax)
  // Rounding belongs to an actual sale line, never an invented balancing entry.
  const last=[...lines].reverse().find((l:Data)=>l.amount>0)
  requireThat(last,'The progress amount is too small for these estimate lines',409)
  last.amount+=diff;if(!full)last.unit=last.amount
  requireThat(lines.every((l:Data)=>l.amount>=l.discount&&l.amount>=0),'Choose a larger progress amount',409)
  const discounts=p.discounts.map((d:Data)=>({...d,amount:share(d.amount)})).filter((d:Data)=>d.amount>0)
  return {...p,lines:lines.filter((l:Data)=>l.amount>0||l.tax>0),subtotal:subtotal+diff,discount,tax,afterTax,discounts,total:target,offer:null,deposit:null}
}
export async function convertEstimate(c:Context,b:Data){
  requireThat(c.actor.kind==='person','A person converts the accepted estimate',403)
  const id=text(b.id,'Estimate'),requestId=text(b.requestId,'Conversion request',200)
  const input={...b};delete input.limitRevision
  const requestHash=await sha256(JSON.stringify(Object.entries(input).sort(([a],[z])=>a.localeCompare(z))))
  const replay=await one(c.db,'SELECT * FROM pt_estimate_conversions WHERE estimate_id=? AND request_id=?',id,requestId)
  if(replay){requireThat(replay.request_hash===requestHash,'That conversion request was already used with different details',409);await run(c.db,[authority(c.actor,'record')]);return {estimate:await estimate(c.db,id),invoice:await invoice(c.db,replay.invoice_id)}}
  const {row,p}=await estimateRaw(c.db,id),current=await estimate(c.db,id)
  requireThat(row.status==='accepted'&&row.accepted_revision===b.revision&&row.revision===b.revision,'Accept the current estimate revision before converting',409)
  const day=date(b.issueDate,'Invoice date'),due=b.dueDate?date(b.dueDate,'Due date'):addDays(day,Math.round((Date.parse(row.due_date)-Date.parse(row.issue_date))/86400000))
  requireThat(due>=day,'Due date is on or after issue date')
  await assertOpen(c.db,day)
  const mode=text(b.mode,'Conversion mode'),remaining=current.remaining_cents,before=current.billed_cents
  requireThat(['full','percent','milestone','balance'].includes(mode),'Choose full, percent, milestone or balance')
  requireThat(mode!=='full'||before===0,'Part of this estimate is already reserved for invoicing',409)
  let amount=mode==='full'||mode==='balance'?remaining:mode==='percent'?scale(row.total_cents,milliPercent(b.percent,'Progress percentage'),100000):cents(b.amount,'Milestone amount')
  requireThat(amount>0&&amount<=remaining,'This conversion exceeds the estimate amount remaining',409)
  const milestone=mode==='milestone'?text(b.milestone,'Milestone',200):optionalText(b.milestone,'Milestone',200)
  const part=slicePricing(p,before,before+amount),invoiceId=uid(),revision=uid(),number=await nextNumber(c.db,'invoice')
  part.issueDate=day;part.dueDate=due;part.memo=[p.memo,`Estimate ${row.number}: ${mode==='milestone'?milestone:mode==='percent'?`${b.percent}% progress`:mode}. Previously billed ${(before/100).toFixed(2)}; remaining ${((remaining-amount)/100).toFixed(2)}.`].filter(Boolean).join('\n')
  // A received-at-issue deposit is carried once, on the first conversion only.
  if(!before&&p.deposit){requireThat(p.deposit.amount<=amount,'The received-at-issue deposit exceeds this progress invoice; choose a larger first invoice',409);part.deposit={...p.deposit,date:day}}
  part.terms=p.terms?parseTerms({percent:String(p.terms.percentMilli/1000),days:p.terms.days},day,due,'invoice'):null
  const settings=await discountSettings(c.db)
  part.offer=part.terms?await computeOffer(c.db,part.terms,day,part.lines,amount,part.deposit?.amount??0,settings?.early_account_id??settings?.discount_account_id??null):null
  requireThat(!part.offer||part.offer.payBy>0,'The deposit covers the early-payment amount; choose a larger invoice',409)
  let plan:Data|null=null
  if(b.depositId){
    must(c.actor,'post');requireThat(!['sales','payables-clerk','time-only'].includes(c.actor.role),'Customer deposits require a financial role',403)
    requireThat(!part.deposit,'Choose either the carried received-at-issue deposit or an advance deposit, not both',409)
    plan=await customerDeposit(c.db,text(b.depositId,'Customer deposit'))
    const applied=cents(b.depositAmount,'Deposit applied')
    requireThat(plan.customer_id===row.customer_id&&plan.available_cents>=applied&&applied<=amount,'Choose an available deposit for this customer within the invoice total',409)
    requireThat(plan.date<=day,'The invoice cannot apply a deposit before it was received')
    plan={...plan,applied}
    if(part.offer)part.offer=await computeOffer(c.db,part.terms,day,part.lines,amount,Math.min(applied,part.offer.settle),settings?.early_account_id??settings?.discount_account_id??null)
  }
  try { await run(c.db,[authority(c.actor,'record'),periodOpen(day),...(part.deposit?bankAuthority(c.actor,[part.deposit.bankAccountId]):[]),...(plan?bankAuthority(c.actor,[plan.bank_account_id],'post'):[]),
    guard("EXISTS(SELECT 1 FROM pt_estimates WHERE id=? AND revision=? AND status='accepted' AND accepted_revision=? AND erased_at IS NULL)",id,b.revision,b.revision),
    guard('(SELECT COALESCE(SUM(amount_cents),0) FROM pt_estimate_conversions WHERE estimate_id=?)=?',id,before),
    q("INSERT INTO pt_invoices(id,kind,number,customer_id,destination_state,exemption_evidence,issue_date,due_date,status,memo,subtotal_cents,tax_cents,total_cents,discounts,discount_cents,after_tax_discount_cents,discount_account_id,deposit,early_terms,early_offer,opening,prepared_by,revision,created_at,estimate_id,estimate_revision,estimate_billed_before_cents,estimate_remaining_cents)VALUES(?,'invoice',?,?,?,?,?,?,'draft',?,?,?,?,?,?,?,?,?,?,?,0,?,?,?,?,?,?,?)",invoiceId,number,row.customer_id,p.destination,p.exemption?JSON.stringify(p.exemption):null,day,due,part.memo,part.subtotal,part.tax,amount,...discountColumns(part as any),c.actor.email,revision,now(),id,row.revision,before,remaining-amount),
    q('UPDATE pt_invoices SET document_template_id=?,document_template_revision=?,document_template=?,document_values=? WHERE id=?',p.documentTemplate.id,p.documentTemplate.revision,JSON.stringify(p.documentTemplate),JSON.stringify(p.documentValues),invoiceId),...lineStatements(invoiceId,part.lines),
    q('INSERT INTO pt_estimate_conversions(id,estimate_id,estimate_revision,request_id,request_hash,invoice_id,mode,amount_cents,milestone,created_at)VALUES(?,?,?,?,?,?,?,?,?,?)',uid(),id,row.revision,requestId,requestHash,invoiceId,mode,amount,milestone,now()),
    ...(plan?[q('INSERT INTO pt_invoice_deposit_plans(invoice_id,deposit_id,amount_cents,created_at)VALUES(?,?,?,?)',invoiceId,plan.id,plan.applied,now()),guard(`(SELECT amount_cents FROM pt_customer_deposits WHERE id=?) >= (SELECT COALESCE(SUM(a.amount_cents),0) FROM pt_customer_deposit_applications a JOIN pt_payments p ON p.id=a.payment_id WHERE a.deposit_id=? AND p.reversal_id IS NULL)+(SELECT COALESCE(SUM(x.amount_cents),0) FROM pt_invoice_deposit_plans x JOIN pt_invoices i ON i.id=x.invoice_id WHERE x.deposit_id=? AND i.status<>'issued')`,plan.id,plan.id,plan.id)]:[]),
    audit(who(c.actor),'estimate.convert','estimate',id,{revision:row.revision,invoiceId,mode,amount,milestone}),audit(who(c.actor),'invoice.draft','invoice',invoiceId,{estimateId:id,estimateRevision:row.revision,total:amount})]) }catch(error){
    const completed=await one(c.db,'SELECT invoice_id,request_hash FROM pt_estimate_conversions WHERE estimate_id=? AND request_id=?',id,requestId)
    if(!completed||completed.request_hash!==requestHash)throw error
    await run(c.db,[authority(c.actor,'record')]);return {estimate:await estimate(c.db,id),invoice:await invoice(c.db,completed.invoice_id)}
  }
  return {estimate:await estimate(c.db,id),invoice:await invoice(c.db,invoiceId)}
}
