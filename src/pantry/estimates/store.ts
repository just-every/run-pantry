import { requireThat, text, type Data } from '../core'
import { all, one } from '../db'
import type { Context } from '../context'
import { estimateExpired } from './validity'
import { customerDepositsView } from '../customer-deposits'

export async function estimate(db: D1Database, rawId: string): Promise<Data> {
  const id = text(rawId, 'Estimate'), row = await one(db, 'SELECT e.*,c.name AS customer_name FROM pt_estimates e JOIN pt_contacts c ON c.id=e.customer_id WHERE e.id=?', id)
  requireThat(row, 'Estimate not found', 404)
  const p = JSON.parse(row.pricing), input = JSON.parse(row.input)
  const conversions = await all(db, `SELECT x.*,i.number,i.status,i.revision AS invoice_revision,i.early_terms FROM pt_estimate_conversions x JOIN pt_invoices i ON i.id=x.invoice_id WHERE x.estimate_id=? ORDER BY x.created_at,x.id`, id)
  const billed = conversions.reduce((sum, x) => sum + x.amount_cents, 0)
  const doc = await one(db,'SELECT sha256,accepted_sha256 FROM pt_estimate_documents WHERE estimate_id=? AND revision=?',id,row.revision)
  const deliveries = await all(db,'SELECT * FROM pt_estimate_deliveries WHERE estimate_id=? ORDER BY at,id',id)
  const { link_token, accepted_name, accepted_at, accepted_ip, accepted_revision, pricing, ...safe } = row
  return { ...safe, input, validity:p.validity??null,expired:row.status!=='accepted'&&estimateExpired(p), lines: p.lines.map((l:Data,i:number)=>({...l,line_no:i+1,quantity_milli:l.qty,unit_cents:l.unit,amount_cents:l.amount,tax_code:l.taxCode,tax_cents:l.tax,discount_cents:l.discount,item_id:l.itemId,line_kind:l.kind})), subtotal_cents:p.subtotal,tax_cents:p.tax,discounts:p.discounts,deposit:p.deposit,early_terms:p.terms,
    acceptance: accepted_at ? { name:accepted_name,at:accepted_at,ip:accepted_ip,revision:accepted_revision } : null,
    conversions:conversions.map(x=>({...x,early_terms:x.early_terms?JSON.parse(x.early_terms):null})),billed_cents:billed,remaining_cents:row.total_cents-billed,deliveries,
    public_path:link_token ? `/e/${link_token}` : null,pdf_sha256:doc?.sha256 ?? null,accepted_pdf_sha256:doc?.accepted_sha256 ?? null }
}
export async function estimatesView(ctx: Context) {
  const ids = await all(ctx.db,'SELECT id FROM pt_estimates ORDER BY created_at DESC,id')
  return { estimates: await Promise.all(ids.map(r=>estimate(ctx.db,r.id))), ...(await customerDepositsView(ctx)) }
}
export async function estimateRaw(db:D1Database,id:string) {
  const row=await one(db,'SELECT * FROM pt_estimates WHERE id=?',id)
  requireThat(row,'Estimate not found',404)
  requireThat(!row.erased_at,'This customer record was erased',410)
  return {row,p:JSON.parse(row.pricing) as Data,input:JSON.parse(row.input) as Data}
}
