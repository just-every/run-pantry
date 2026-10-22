import { authority, who } from '../access'
import { bankAuthority } from '../access-policy/banks'
import { date, now, requireThat, text, uid, type Data } from '../core'
import { all, assertOpen, audit, changed, guard, periodOpen, q, run } from '../db'
import type { Command } from '../context'
import { parseInvoice } from '../invoices'
import { estimateValidity } from './validity'
import { estimate, estimateRaw } from './store'
import { sendEstimate } from './delivery'
import { refreshInvoice } from './refresh'
import { convertEstimate } from './conversions'

const save:Command={need:'record',async run(c,b){
  requireThat(c.actor.kind==='person','A person prepares an estimate',403)
  const old=b.id?await estimateRaw(c.db,text(b.id,'Estimate')):null
  requireThat(!old||old.row.status!=='accepted','An accepted estimate is retained unchanged; prepare a new estimate for changed work',409)
  requireThat(!old||old.row.revision===b.revision,'Estimate changed; reload',409)
  const input:Data=Object.fromEntries(['customerId','issueDate','dueDate','lines','discounts','deposit','earlyPayment','memo','destinationState','validUntil'].filter(k=>b[k]!==undefined).map(k=>[k,b[k]])); input.kind='invoice'; input.templateId=b.templateId??old?.p.documentTemplate.id; input.customFields=b.customFields??old?.p.documentValues
  const p=await parseInvoice(c.db,input,{estimate:true})
  const validity=await estimateValidity(c.db,input.validUntil,p.issueDate)
  requireThat(!p.lines.some(l=>!l.taxCode),'Choose a tax treatment on every estimate line',409)
  requireThat(!p.discounts.length||p.discountAccountId,'Choose a discounts account before preparing the estimate',409)
  await assertOpen(c.db,p.issueDate)
  const id=old?.row.id??uid(),revision=uid()
  let number=old?.row.number
  if(!number){
    const rows=await all(c.db,"SELECT number FROM pt_estimates WHERE number LIKE 'EST-%'")
    const n=rows.reduce((v,r)=>Math.max(v,Number(r.number.slice(4))||0),0)+1
    number=b.number?text(b.number,'Estimate number',40):`EST-${String(n).padStart(4,'0')}`
  }
  // Customer financial/private fields are never copied into estimate pricing.
  const pricing={...p,validity,customer:{id:p.customer.id,name:p.customer.name,billing_address:p.customer.billing_address}}
  await run(c.db,[authority(c.actor,'record'),periodOpen(p.issueDate),...(old?[periodOpen(old.row.issue_date)]:[]),...(p.deposit?bankAuthority(c.actor,[p.deposit.bankAccountId]):[]),
    ...(old?[q("UPDATE pt_estimates SET input=?,pricing=?,customer_id=?,issue_date=?,due_date=?,total_cents=?,status='draft',revision=?,prepared_by=?,link_token=NULL,sent_at=NULL WHERE id=? AND revision=? AND status<>'accepted'",JSON.stringify(input),JSON.stringify(pricing),p.customer.id,p.issueDate,p.dueDate,p.total,revision,c.actor.email,id,b.revision),changed()]:[
      q("INSERT INTO pt_estimates(id,number,customer_id,issue_date,due_date,status,input,pricing,total_cents,prepared_by,revision,created_at)VALUES(?,?,?,?,?,'draft',?,?,?,?,?,?)",id,number,p.customer.id,p.issueDate,p.dueDate,JSON.stringify(input),JSON.stringify(pricing),p.total,c.actor.email,revision,now())]),
    audit(who(c.actor),'estimate.save-draft','estimate',id,{number,total:p.total,revision,validity})])
  return estimate(c.db,id)
}}
const revoke:Command={need:'owner',async run(c,b){
  const {row}=await estimateRaw(c.db,text(b.id,'Estimate'))
  requireThat(row.revision===b.revision,'Estimate changed; reload',409)
  await run(c.db,[authority(c.actor,'owner'),q('UPDATE pt_estimates SET link_token=NULL WHERE id=? AND revision=?',row.id,b.revision),changed(),audit(who(c.actor),'estimate.link-revoked','estimate',row.id,{revision:row.revision})])
  return estimate(c.db,row.id)
}}
export const estimateCommands:Record<string,Command>={
 'estimate.refresh-invoice':{need:'record',run:refreshInvoice},'estimate.save-draft':save,'estimate.send':{need:'record',run:sendEstimate},'estimate.link-revoke':revoke,'estimate.convert':{need:'record',run:convertEstimate},
}
