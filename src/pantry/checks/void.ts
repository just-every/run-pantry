import { authority, who } from '../access'
import type { Command } from '../context'
import { date, requireThat, text, uid } from '../core'
import { audit, changed, guard, one, periodOpen, q, run } from '../db'
import { entry, reversalStatements } from '../journal'
import { batchView } from './views'

export const voidCheck: Command = { need: 'post', async run(c, b) {
  const check = await one(c.db, 'SELECT c.*, p.journal_id FROM pt_checks c JOIN pt_payments p ON p.id = c.payment_id WHERE c.id = ?', text(b.id, 'Check'))
  requireThat(check, 'Check not found', 404)
  requireThat(check.status === 'issued', 'This check is already void', 409)
  const day = date(b.date, 'Void date'), reason = text(b.reason, 'Void reason', 500), original = await entry(c.db, check.journal_id)
  const reversal = await reversalStatements(c.db, c.actor, original, day, `Void check ${check.number}: ${reason}`)
  const expense = check.expense_bill_id ? await one(c.db, 'SELECT * FROM pt_bills WHERE id = ?', check.expense_bill_id) : null
  const expenseReversal = expense ? await reversalStatements(c.db, c.actor, await entry(c.db, expense.journal_id), day, `Void expense check ${check.number}: ${reason}`) : null
  await run(c.db, [authority(c.actor, 'post'), periodOpen(day),
    guard('NOT EXISTS (SELECT 1 FROM pt_match_postings mp JOIN pt_journal_lines l ON l.id = mp.journal_line_id WHERE l.entry_id = ? AND mp.active = 1)', original.id),
    ...reversal.statements,
    q("UPDATE pt_checks SET status = 'void', void_reason = ?, void_date = ?, reversal_id = ? WHERE id = ? AND status = 'issued'", reason, day, reversal.id, check.id), changed(),
    q('UPDATE pt_payments SET reversal_id = ? WHERE id = ? AND reversal_id IS NULL', reversal.id, check.payment_id), changed(),
    ...(expenseReversal ? [...expenseReversal.statements, q("UPDATE pt_bills SET status = 'void', revision = ? WHERE id = ? AND status = 'posted'", uid(), expense!.id), changed()] : []),
    audit(who(c.actor), 'check.void', 'check', check.id, { number: check.number, paymentId: check.payment_id, reversalId: reversal.id, expenseReversalId: expenseReversal?.id ?? null, date: day, reason })])
  return batchView(c.db, check.batch_id)
} }
