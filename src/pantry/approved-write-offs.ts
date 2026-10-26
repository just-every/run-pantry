// Single bad-debt credits use the ordinary exact-revision credit approval door.
// Bulk write-offs keep their separate per-item ceiling.
import { authority, who } from './access'
import { date, now, requireThat, text, uid, type Data } from './core'
import { assertOpen, audit, guard, periodOpen, q, run, one, type Sql } from './db'
import { dimensionTags, dimensionValues, dimensionRefusal } from './dimensions'
import { contact } from './contacts'
import { selectedTemplate, customValues } from './invoice-templates'
import { documentSelectionStatements } from './invoice-documents'
import { invoice, nextNumber } from './invoices'
import type { Command } from './context'

export async function writeOffChecks(db: D1Database, credit: Data): Promise<Sql[]> {
  if (!credit.write_off) return []
  const target = await invoice(db, credit.credit_for)
  requireThat(target.status === 'issued' && target.kind === 'invoice' && target.customer_id === credit.customer_id, 'The write-off must settle its original issued invoice', 409)
  requireThat(credit.issue_date >= target.issue_date && target.open_cents === credit.total_cents && target.open_cents > 0, 'The invoice balance changed; prepare a new write-off for its current balance', 409)
  requireThat(!credit.early_discount && credit.tax_cents === 0 && credit.lines.every((l: Data) => l.tax_code === 'exempt'), 'A write-off is a bad debt, never a discount or sales-tax return', 409)
  const statements: Sql[] = [guard(`(SELECT total_cents FROM pt_invoices WHERE id=? AND status='issued') - COALESCE((SELECT SUM(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id WHERE a.target_kind='invoice' AND a.target_id=? AND (a.source_kind='credit' OR p.reversal_id IS NULL) AND a.voided_by IS NULL),0) = ?`, target.id, target.id, credit.total_cents)]
  for (const line of credit.lines) {
    const account = await one(db, "SELECT id FROM pt_accounts WHERE id=? AND active=1 AND subtype='other' AND type IN ('income','expense')", line.account_id)
    requireThat(account, 'Choose an active ordinary income or expense account for bad debts', 409)
    const refusal = await dimensionRefusal(db, [line.account_id], dimensionTags(line))
    requireThat(!refusal, refusal ?? 'Invalid write-off dimensions', 409)
    statements.push(guard("EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND subtype='other' AND type IN ('income','expense'))", line.account_id))
  }
  return statements
}

const prepare: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person' && ['owner','accountant','bookkeeper'].includes(c.actor.role), 'A financial team member prepares a write-off', 403)
  const target = await invoice(c.db, text(b.invoiceId, 'Invoice'))
  requireThat(target.kind === 'invoice' && target.status === 'issued' && target.open_cents > 0, 'Choose an issued invoice with an open balance', 409)
  const day = date(b.date, 'Write-off date'), accountId = text(b.accountId, 'Bad-debt account'), reason = text(b.reason, 'Write-off reason', 500)
  requireThat(day >= target.issue_date, 'Date the write-off on or after its invoice', 409)
  await assertOpen(c.db, day)
  const customer = await contact(c.db, target.customer_id, 'customer')
  const template = await selectedTemplate(c.db, customer)
  const id = uid(), revision = uid(), number = await nextNumber(c.db, 'credit'), tags = dimensionTags(b)
  const memo = `Bad-debt write-off of ${target.number}: ${reason}`
  const credit = { kind: 'credit', write_off: 1, early_discount: 0, credit_for: target.id, customer_id: target.customer_id, total_cents: target.open_cents, tax_cents: 0, issue_date: day,
    lines: [{ ...tags, account_id: accountId, tax_code: 'exempt' }] }
  await run(c.db, [authority(c.actor, 'record'), periodOpen(day), ...await writeOffChecks(c.db, credit),
    q("INSERT INTO pt_invoices(id,kind,number,customer_id,destination_state,issue_date,due_date,status,memo,credit_for,subtotal_cents,tax_cents,total_cents,opening,prepared_by,revision,created_at,write_off) VALUES (?,'credit',?,?,?,?,?,'draft',?,?,?,0,?,0,?,?,?,1)", id, number, target.customer_id, target.destination_state, day, day, memo, target.id, target.open_cents, target.open_cents, c.actor.email, revision, now()),
    q("INSERT INTO pt_invoice_lines(id,invoice_id,line_no,description,quantity_milli,unit_cents,amount_cents,account_id,tax_code,tax_cents,chosen_tax_code,class_name,location_name,project_name) VALUES (?,?,1,?,1000,?,?,?,'exempt',0,'exempt',?,?,?)", uid(), id, memo, target.open_cents, target.open_cents, accountId, ...dimensionValues(tags)),
    ...documentSelectionStatements(id, { documentTemplate: template, documentValues: customValues(template, {}) }),
    audit(who(c.actor), 'write-off.prepare', 'credit', id, { invoiceId: target.id, balance: target.open_cents, accountId, reason, date: day, revision })])
  return invoice(c.db, id)
} }
export const approvedWriteOffCommands = { 'write-off.prepare': prepare }
