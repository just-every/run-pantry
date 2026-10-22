import { nativeApprovalAuthority } from '../access-policy/approvals'
import { bankAuthority } from '../access-policy/banks'
import { who, type Actor } from '../access'
import { controlAccount } from '../accounts'
import { cents, date, now, requireThat, sha256, text, uid, type Data } from '../core'
import { assertOpen, audit, changed, guard, one, q, type AuditActor, type Sql } from '../db'
import { entryStatements } from '../journal'
import { invoice } from '../invoices'
import { takeEarlyDiscounts } from '../early-payment'
import { customerDeposit } from './store'

/** A real native payment/allocation settles AR; its debit is the held liability, never cash again. */
export async function depositApplicationStatements(db:D1Database,actor:Actor|AuditActor,b:Data,issuing?:Data):Promise<{paymentId:string;statements:Sql[]}>{
  const id=text(b.depositId,'Customer deposit'),d=await customerDeposit(db,id)
  const inv=issuing??await invoice(db,text(b.invoiceId,'Invoice'))
  requireThat(inv.kind==='invoice'&& (issuing||inv.status==='issued'),'Apply a deposit to an issued invoice',409)
  requireThat(inv.customer_id===d.customer_id,'Apply a deposit only to its own customer',409)
  const amount=cents(b.amount,'Deposit applied'),day=date(b.date,'Application date')
  requireThat(day>=d.date&&day>=inv.issue_date,'Apply on or after the deposit and invoice dates')
  await assertOpen(db,day)
  const liability=await one(db,"SELECT id FROM pt_accounts WHERE id=? AND type='liability' AND subtype='other' AND active=1",d.liability_account_id)
  requireThat(liability,'The customer-deposit liability account is inactive',409)
  const requestId=text(b.requestId,'Application request',200),requestHash=await sha256(JSON.stringify([id,inv.id,amount,day]))
  const previous=await one(db,'SELECT * FROM pt_customer_deposit_applications WHERE request_id=?',requestId)
  if(previous){requireThat(previous.request_hash===requestHash,'That request was already used for another application',409);return {paymentId:previous.payment_id,statements:[]}}
    requireThat(amount<=(issuing?d.remaining_cents:d.available_cents),'The deposit does not have that much unreserved money left',409)
  requireThat(amount<=(issuing?inv.total_cents:inv.open_cents),'The invoice does not have that much open',409)
  const paymentId=uid(),journalId=uid(),appId=uid(),receivable=await controlAccount(db,'receivable')
  const early=await takeEarlyDiscounts(db,actor,[{targetId:inv.id,amount}],day,{payments:paymentId,qualifyingDate:d.date,...(issuing?{issuing}: {})})
  const applied=early.allocations[0].amount
  const statements:Sql[]=[guard('EXISTS(SELECT 1 FROM pt_customer_deposits d JOIN pt_journal_entries e ON e.id=d.journal_id WHERE d.id=? AND e.reversed_by_id IS NULL)',d.id),...nativeApprovalAuthority(actor,'payment',amount,'post'),...bankAuthority(actor,[d.bank_account_id],'post'),
    guard('EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND type=\'liability\' AND active=1)',liability.id),
    guard('EXISTS(SELECT 1 FROM pt_customer_deposits WHERE id=? AND revision=?)',d.id,d.revision),
    ...entryStatements({id:journalId,date:day,memo:`Customer deposit applied to ${inv.number}`,sourceKind:'payment',sourceId:paymentId,preparedBy:actor.email,preparedKind:'person',lines:[
      {accountId:liability.id,debit:applied,credit:0,contactId:d.customer_id},{accountId:receivable.id,debit:0,credit:applied,contactId:d.customer_id}]},actor.email),
    q("INSERT INTO pt_payments(id,direction,contact_id,payment_date,amount_cents,bank_account_id,reference,memo,method,journal_id,recorded_by,created_at,customer_deposit_id)VALUES(?,'received',?,?,?,?,?,?,?,?,?,?,?)",paymentId,d.customer_id,day,applied,d.bank_account_id,d.reference,`Advance deposit applied to ${inv.number}`,d.method,journalId,actor.email,now(),d.id),
    ...early.before,
    q("INSERT INTO pt_allocations(id,source_kind,source_id,target_kind,target_id,amount_cents,allocation_date,created_by,created_at,early_counted)VALUES(?,'payment',?,'invoice',?,?,?,?,?,?)",uid(),paymentId,inv.id,applied,day,actor.email,now(),early.allocations[0].counted?1:0),
    q('INSERT INTO pt_customer_deposit_applications(id,deposit_id,invoice_id,payment_id,amount_cents,date,request_id,request_hash,created_at)VALUES(?,?,?,?,?,?,?,?,?)',appId,id,inv.id,paymentId,applied,day,requestId,requestHash,now()),
    guard(`(SELECT COALESCE(SUM(a.amount_cents),0) FROM pt_customer_deposit_applications a JOIN pt_payments p ON p.id=a.payment_id WHERE a.deposit_id=? AND p.reversal_id IS NULL)+(SELECT COALESCE(SUM(x.amount_cents),0) FROM pt_invoice_deposit_plans x JOIN pt_invoices i ON i.id=x.invoice_id WHERE x.deposit_id=? AND i.status<>'issued')<=(SELECT amount_cents FROM pt_customer_deposits WHERE id=?)`,id,id,id),
    guard(`EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND status='issued' AND customer_id=?) AND (SELECT total_cents FROM pt_invoices WHERE id=?) >= (SELECT COALESCE(SUM(a.amount_cents),0) FROM pt_allocations a LEFT JOIN pt_payments p ON p.id=a.source_id AND a.source_kind='payment' WHERE a.target_kind='invoice' AND a.target_id=? AND a.voided_by IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL))`,inv.id,d.customer_id,inv.id,inv.id),
    ...early.after,audit(who(actor),'customer-deposit.apply','customer-deposit',d.id,{invoiceId:inv.id,paymentId,amount:applied,date:day})]
  return {paymentId,statements}
}
export async function depositForIssue(db:D1Database,actor:Actor|AuditActor,inv:Data):Promise<Sql[]>{
  const plan=await one(db,'SELECT * FROM pt_invoice_deposit_plans WHERE invoice_id=?',inv.id)
  if(!plan)return []
  const application=await depositApplicationStatements(db,actor,{depositId:plan.deposit_id,invoiceId:inv.id,amount:(plan.amount_cents/100).toFixed(2),date:inv.issue_date,requestId:`issue:${inv.id}`},inv)
  return application.statements
}
