import { pantry } from '../access'
import { controlAccount } from '../accounts'
import { now, requireThat, uid, type Data } from '../core'
import { audit, changed, one, periodOpen, q, run, type Sql } from '../db'
import { entryStatements } from '../journal'
import { processorDimensions } from '../dimensions/processor'
import { refund } from './store'

/** Provider confirmation and the receivables movement commit together. */
export async function refundOutcome(db: D1Database, id: string, outcome: Data, extra: Sql[] = []) {
  const current = await refund(db, id)
  if (current.status === 'succeeded' || current.status === 'failed' || current.status === 'canceled') return current
  const status = outcome.status === 'succeeded' ? 'succeeded' : ['failed','canceled'].includes(outcome.status) ? outcome.status : 'pending'
  requireThat(['approved','pending'].includes(current.status), 'Approve this exact refund first', 409)
  requireThat(outcome.amount === current.amount_cents && outcome.currency === 'usd', 'Stripe refund differs from the approved amount or currency', 409)
  const by = pantry('stripe'), journalId = status === 'succeeded' ? uid() : null
  const statements: Sql[] = []
  if (journalId) {
    const bank = (await one(db, 'SELECT account_id FROM pt_bank_accounts WHERE id=?', current.bank_account_id))!, control = await controlAccount(db, 'receivable')
    const dimensions = await processorDimensions(db)
    statements.push(...dimensions.guards, periodOpen(current.refund_date), ...entryStatements({ id: journalId, date: current.refund_date, memo: `Customer refund — ${current.reason}`, sourceKind: 'bank', sourceId: current.id, preparedBy: current.approved_by, preparedKind: 'person', lines: [
      { ...dimensions.coding('receivable'), accountId: control.id, debit: current.amount_cents, credit: 0, contactId: current.customer_id, memo: current.reason },
      { ...dimensions.coding('clearing'), accountId: bank.account_id, debit: 0, credit: current.amount_cents, memo: current.reason },
    ] }, current.approved_by))
  }
  statements.push(...extra, q("UPDATE pt_customer_refunds SET status=?,provider_id=?,provider_status=?,provider_created=?,journal_id=?,updated_at=?,revision=? WHERE id=? AND status IN ('approved','pending')", status, outcome.id ?? null, outcome.status, outcome.created ?? null, journalId, now(), uid(), id), changed(),
    audit(by, 'customer-refund.outcome', 'customer-refund', id, { status, provider: outcome.id ?? null, journalId }))
  await run(db, statements)
  return refund(db, id)
}
