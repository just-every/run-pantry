// Refresh mutable tax-treatment evidence without changing accepted economics.
import { authority, who } from '../access'
import { bankAuthority } from '../access-policy/banks'
import type { Context } from '../context'
import { requireThat, text, uid, type Data } from '../core'
import { audit, changed, one, periodOpen, q, run } from '../db'
import { invoice } from '../invoices'
import { computeOffer } from '../early-payment'
import { discountSettings } from '../discounts'
import { estimate } from './store'
export async function refreshInvoice(c:Context,b:Data){
 const inv=await invoice(c.db,text(b.invoiceId,'Invoice')),id=text(b.id,'Estimate')
 requireThat(inv.estimate_id===id&&inv.status!=='issued'&&inv.revision===b.revision,'Choose the current unissued invoice of this estimate',409)
 requireThat(inv.early_terms,'This invoice has no early-payment term to refresh',409)
 const settings=await discountSettings(c.db)
 const lines=inv.lines.map((l:Data)=>({amount:l.amount_cents,discount:l.discount_cents,tax:l.tax_cents,taxCode:l.tax_code}))
 let offer=await computeOffer(c.db,inv.early_terms,inv.issue_date,lines,inv.total_cents,inv.deposit?.amount??0,settings?.early_account_id??settings?.discount_account_id??null)
 const advance=await one(c.db,'SELECT amount_cents FROM pt_invoice_deposit_plans WHERE invoice_id=?',inv.id)
 if(advance)offer=await computeOffer(c.db,inv.early_terms,inv.issue_date,lines,inv.total_cents,Math.min(advance.amount_cents,offer.settle),settings?.early_account_id??settings?.discount_account_id??null)
 requireThat(advance||offer.payBy>0,'The received-at-issue deposit covers the early-payment amount',409)
 await run(c.db,[authority(c.actor,'record'),...(inv.deposit?bankAuthority(c.actor,[inv.deposit.bankAccountId]):[]),periodOpen(inv.issue_date),
  q("UPDATE pt_invoices SET early_offer=?,status='draft',approved_by=NULL,approved_revision=NULL,revision=?,prepared_by=? WHERE id=? AND revision=? AND status<>'issued'",JSON.stringify(offer),uid(),c.actor.email,inv.id,b.revision),changed(),
  audit(who(c.actor),'invoice.refresh-offer','invoice',inv.id,{estimateId:id,before:inv.early_offer,after:offer})])
 return {estimate:await estimate(c.db,id),invoice:await invoice(c.db,inv.id)}
}
