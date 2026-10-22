import { authority, who } from '../access'
import { nativeApprovalAuthority } from '../access-policy/approvals'
import { bankAuthority } from '../access-policy/banks'
import { contact } from '../contacts'
import { cents, date, now, optionalText, requireThat, text, uid } from '../core'
import { assertOpen, audit, changed, guard, one, q, run } from '../db'
import { entryStatements } from '../journal'
import { METHODS } from '../contractors'
import type { Command } from '../context'
import { depositApplicationStatements } from './applications'
import { customerDeposit } from './store'
export { customerDepositsView } from './store'

const record:Command={need:'post',async run(c,b){
  requireThat(c.actor.kind==='person','A person records a customer deposit',403)
  const customer=await contact(c.db,text(b.customerId,'Customer'),'customer')
  requireThat(customer.active,'Customer is inactive',409)
  const day=date(b.date),amount=cents(b.amount,'Deposit amount'),reference=text(b.reference,'Deposit reference',80)
  const method=text(b.method,'Deposit method');requireThat((METHODS as readonly string[]).includes(method),'Choose a supported payment method')
  await assertOpen(c.db,day)
  const bank=await one(c.db,"SELECT b.*,a.active,a.type FROM pt_bank_accounts b JOIN pt_accounts a ON a.id=b.account_id WHERE b.id=?",text(b.bankAccountId,'Bank account'))
  requireThat(bank?.active&&bank.type==='asset','Choose an active bank asset account',409)
  const liability=await one(c.db,"SELECT * FROM pt_accounts WHERE id=? AND type='liability' AND subtype='other' AND active=1",text(b.liabilityAccountId,'Customer-deposit liability account'))
  requireThat(liability,'Choose an active other-liability account for customer deposits',409)
  const id=uid(),journalId=uid(),memo=optionalText(b.memo,'Memo',500)
  await run(c.db,[authority(c.actor,'post'),...nativeApprovalAuthority(c.actor,'payment',amount,'post'),...bankAuthority(c.actor,[bank.id],'post'),
    guard("EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND type='liability' AND subtype='other')",liability.id),
    ...entryStatements({id:journalId,date:day,memo:`Advance deposit from ${customer.name}`,sourceKind:'manual',sourceId:id,preparedBy:c.actor.email,preparedKind:'person',lines:[{accountId:bank.account_id,debit:amount,credit:0,contactId:customer.id},{accountId:liability.id,debit:0,credit:amount,contactId:customer.id}]},c.actor.email),
    q('INSERT INTO pt_customer_deposits(id,customer_id,date,amount_cents,bank_account_id,liability_account_id,method,reference,memo,journal_id,revision,recorded_by,created_at)VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)',id,customer.id,day,amount,bank.id,liability.id,method,reference,memo,journalId,uid(),c.actor.email,now()),
    audit(who(c.actor),'customer-deposit.record','customer-deposit',id,{customerId:customer.id,amount,date:day,journalId})])
  return customerDeposit(c.db,id)
}}
const apply:Command={need:'post',async run(c,b){
  requireThat(c.actor.kind==='person','A person applies a customer deposit',403)
  const prepared=await depositApplicationStatements(c.db,c.actor,b)
  await run(c.db,[authority(c.actor,'post'),...prepared.statements])
  return customerDeposit(c.db,text(b.depositId,'Customer deposit'))
}}
export const customerDepositCommands:Record<string,Command>={'customer-deposit.record':record,'customer-deposit.apply':apply}
