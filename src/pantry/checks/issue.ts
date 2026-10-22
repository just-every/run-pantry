import { authority, who } from '../access'
import { dimensionTags } from '../dimensions'
import type { Command } from '../context'
import { cents, date, list, now, optionalText, requireThat, text, uid, type Data } from '../core'
import { audit, changed, guard, one, periodOpen, q, run, type Sql } from '../db'
import { bill, billStatements, paymentStatements } from '../payables'
import { payingBank } from './settings'
import { batchView } from './views'

export const issueChecks: Command = { need: 'record', async run(c, b) {
  const bank = await payingBank(c.db, text(b.bankAccountId, 'Bank account')), day = date(b.date, 'Check date')
  const profile = await one(c.db, 'SELECT * FROM pt_check_profiles WHERE bank_account_id = ?', bank.id)
  requireThat(profile, 'Set up this bank’s starting check number and positive-pay format first', 409)
  requireThat(profile.revision === b.revision, 'Check numbers or setup changed; reload before issuing', 409)
  const items = list<Data>(b.items, 'Checks', 50), batchId = uid(), entity = await one(c.db, 'SELECT legal_name FROM pt_entity WHERE id = 1')
  requireThat(entity, 'Set up the business first')
  requireThat(profile.next_number + items.length <= 999999999, 'This bank’s check sequence is exhausted; review its check stock', 409)
  const statements: Sql[] = [authority(c.actor, 'record'), periodOpen(day),
    q('UPDATE pt_check_profiles SET next_number = next_number + ?, revision = ? WHERE bank_account_id = ? AND revision = ? AND next_number = ?', items.length, uid(), bank.id, b.revision, profile.next_number), changed(),
    guard("EXISTS (SELECT 1 FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE b.id = ? AND a.active = 1 AND a.type = 'asset')", bank.id),
    q('INSERT INTO pt_check_batches (id, bank_account_id, check_date, stock, offset_x_mm, offset_y_mm, business_name, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)', batchId, bank.id, day, profile.stock, profile.offset_x_mm, profile.offset_y_mm, entity.legal_name, c.actor.email, now())]
  for (const [index, item] of items.entries()) {
    requireThat(item && typeof item === 'object', 'Each check needs a payee and amount')
    const number = profile.next_number + index, id = uid(), amount = cents(item.amount, 'Check amount'), contactId = text(item.contactId, 'Payee')
    const memo = optionalText(item.memo, 'Memo', 500)
    requireThat(item.kind === 'expense' || item.kind === 'bill', 'Choose expense or bill payment')
    let expenseBillId: string | null = null
    if (item.kind === 'expense') {
      const expense = await billStatements(c, { vendorId: contactId, reference: `Check ${number} expense`, billDate: day, post: true,
        memo, lines: [{ ...dimensionTags(item),accountId: item.accountId, amount: item.amount, description: text(item.description ?? memo, 'Expense description', 500) }] })
      expenseBillId = expense.id
      statements.push(...expense.statements)
    } else {
      const allocations = list<Data>(item.allocations, 'Bills paid', 100)
      requireThat(allocations.every(a => a && typeof a === 'object'), 'Each bill payment needs a bill and amount')
      requireThat(allocations.reduce((n, a) => n + cents(a.amount, 'Bill payment'), 0) === amount, 'Allocate the full check amount to its bills')
      requireThat(new Set(allocations.map(a => a.targetId)).size === allocations.length, 'Choose each bill once per check')
      for (const allocation of allocations) {
        requireThat((await bill(c.db, text(allocation.targetId, 'Bill'))).bill_date <= day, 'Check date cannot precede the bill date')
        statements.push(guard("EXISTS (SELECT 1 FROM pt_bills WHERE id = ? AND vendor_id = ? AND status = 'posted')", allocation.targetId, contactId))
      }
    }
    const p = await paymentStatements(c.db, c.actor, { ...dimensionTags(item),direction: 'paid', contactId, date: day, amount: item.amount, bankAccountId: bank.id,
      reference: String(number), method: 'check', memo, allocations: expenseBillId ? [] : item.allocations })
    statements.push(...p.statements)
    if (expenseBillId) statements.push(q("INSERT INTO pt_allocations (id, source_kind, source_id, target_kind, target_id, amount_cents, allocation_date, created_by, created_at) VALUES (?, 'payment', ?, 'bill', ?, ?, ?, ?, ?)", uid(), p.id, expenseBillId, amount, day, c.actor.email, now()))
    const payee = await one(c.db, 'SELECT name FROM pt_contacts WHERE id = ? AND active = 1', contactId)
    requireThat(payee, 'Choose an active vendor')
    statements.push(guard('EXISTS (SELECT 1 FROM pt_contacts WHERE id = ? AND active = 1 AND name = ?)', contactId, payee.name),
      guard("NOT EXISTS (SELECT 1 FROM pt_payments WHERE bank_account_id = ? AND method = 'check' AND reference = ? AND id <> ?)", bank.id, String(number), p.id),
      q('INSERT INTO pt_checks (id, batch_id, bank_account_id, number, payment_id, expense_bill_id, payee, memo) VALUES (?, ?, ?, ?, ?, ?, ?, ?)', id, batchId, bank.id, number, p.id, expenseBillId, payee.name, memo),
      audit(who(c.actor), 'check.issue', 'check', id, { batchId, bankAccountId: bank.id, number, paymentId: p.id, amount, payee: payee.name, kind: item.kind }))
  }
  await run(c.db, statements)
  return batchView(c.db, batchId)
} }
