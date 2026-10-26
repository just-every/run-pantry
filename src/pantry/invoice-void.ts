// Voiding ends an untouched receivable. Settlement corrections are separate
// actions: a void never reverses customer money or manufactures a credit.
import { authority, must, who } from './access'
import type { Command } from './context'
import { date, now, requireThat, text, uid } from './core'
import { all, audit, changed, guard, one, periodOpen, q, run, type Sql } from './db'
import { invoice } from './invoices'
import { entry, reversalStatements } from './journal'
import { stripeSettings } from './stripe'
import { stripeCall, unseal } from './stripe-api'

const unsettled = `NOT EXISTS(SELECT 1 FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id
 WHERE a.target_kind='invoice' AND a.target_id=? AND a.voided_on IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL))`

export const voidInvoice: Command = { need: 'owner', async run(c, b) {
  must(c.actor, 'owner')
  const inv=await invoice(c.db,text(b.id,'Invoice')), day=date(b.date,'Void date'), reason=text(b.reason,'Void reason',500)
  requireThat(inv.kind==='invoice' && inv.status==='issued' && !inv.void_date && !inv.opening,'Only an issued non-opening invoice can be voided',409)
  requireThat(inv.revision===b.revision,'Invoice changed; reload before voiding',409)
  requireThat(await one(c.db,`SELECT 1 WHERE ${unsettled}`,inv.id),'Undo payments and credit applications before voiding this invoice',409)
  const latest=await one(c.db,`SELECT MAX(COALESCE(a.voided_on,r.entry_date)) AS day FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id LEFT JOIN pt_journal_entries r ON r.id=p.reversal_id WHERE a.target_kind='invoice' AND a.target_id=?`,inv.id)
  requireThat(!latest?.day || day>=latest.day,'Void on or after the settlement corrections',409)
  requireThat(!await one(c.db,`SELECT 1 FROM pt_reclassifications r JOIN pt_journal_lines l ON l.id=r.document_line_id WHERE l.entry_id=?`,inv.journal_id),'Undo document dimension corrections before voiding this invoice',409)
  requireThat(!await one(c.db,"SELECT 1 FROM pt_stripe_payments WHERE invoice_id=? AND status='processing'",inv.id),'A payment is processing; resolve it before voiding',409)
  const original=await entry(c.db,inv.journal_id), reversal=await reversalStatements(c.db,c.actor,original,day,`Void invoice ${inv.number}: ${reason}`)
  // Expiring a hosted checkout is the only provider side effect authorized by
  // this command. A completed or uncertain checkout leaves the invoice intact.
  const sessions=await all(c.db,"SELECT id FROM pt_stripe_payments WHERE invoice_id=? AND status='open'",inv.id), expired:Sql[]=[]
  if(sessions.length){
    const settings=await stripeSettings(c.db)
    requireThat(settings,'Reconnect Stripe before closing this invoice payment session',409)
    const key=await unseal(c.env,settings.key_sealed)
    for(const row of sessions){
      const path=`/checkout/sessions/${encodeURIComponent(row.id)}`
      let session=await stripeCall(key,'GET',path)
      requireThat(session.status==='open'||session.status==='expired','A checkout completed; resolve its payment before voiding',409)
      if(session.status==='open')session=await stripeCall(key,'POST',path+'/expire')
      requireThat(session.status==='expired','Stripe has not confirmed this checkout expired',409)
      expired.push(q("UPDATE pt_stripe_payments SET status='expired',updated_at=? WHERE id=? AND status='open'",now(),row.id),changed())
    }
  }
  await run(c.db,[authority(c.actor,'owner'),periodOpen(day),
    guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND revision=? AND status='issued' AND void_date IS NULL AND opening=0)",inv.id,b.revision),
    guard(unsettled,inv.id),
    guard(`NOT EXISTS(SELECT 1 FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id LEFT JOIN pt_journal_entries r ON r.id=p.reversal_id WHERE a.target_kind='invoice' AND a.target_id=? AND COALESCE(a.voided_on,r.entry_date)>?)`,inv.id,day),
    guard("NOT EXISTS(SELECT 1 FROM pt_match_postings m JOIN pt_journal_lines l ON l.id=m.journal_line_id WHERE l.entry_id=? AND m.active=1)",original.id),
    guard("NOT EXISTS(SELECT 1 FROM pt_reclassifications r JOIN pt_journal_lines l ON l.id=r.document_line_id WHERE l.entry_id=?)",original.id),
    ...expired,
    guard("NOT EXISTS(SELECT 1 FROM pt_stripe_payments WHERE invoice_id=? AND status IN ('open','processing'))",inv.id),
    ...reversal.statements,
    q('UPDATE pt_invoices SET void_date=?,void_reason=?,void_reversal_id=?,voided_by=?,link_token=NULL,reminders_paused=1,revision=? WHERE id=? AND revision=? AND void_date IS NULL',day,reason,reversal.id,c.actor.email,uid(),inv.id,b.revision),changed(),
    q("UPDATE pt_collection_cases SET status='stopped',approved_by=NULL,approved_revision=NULL,revision=?,updated_at=? WHERE invoice_id=?",uid(),now(),inv.id),
    audit(who(c.actor),'invoice.void','invoice',inv.id,{number:inv.number,date:day,reason,reversalId:reversal.id,expiredCheckouts:sessions.map(s=>s.id)})])
  return invoice(c.db,inv.id)
} }

export const invoiceVoidCommands: Record<string, Command> = { 'invoice.void': voidInvoice }
