import { authority, must, who } from '../access'
import { assertDoor } from '../access-policy/doors'
import type { Command, Context } from '../context'
import { date, daysBetween, now, requireThat, scale, text, uid, usd, type Data } from '../core'
import { assertOpen, audit, guard, one, periodOpen, q, run } from '../db'
import { exemptionDay, exemptionFence } from '../exemptions'
import { documentSelectionStatements } from '../invoice-documents'
import { invoice, lineStatements, nextNumber, openBalance, parseInvoice } from '../invoices'
import { lateFeePolicy } from './policy'

export const preparationView = (row: Data) => ({ ...row, policy: JSON.parse(row.policy_snapshot), source: JSON.parse(row.source_snapshot) })

async function existing(c: Context, sourceId: string, day: string, key: string) {
  const keyed = await one(c.db, 'SELECT * FROM pt_late_fee_preparations WHERE idempotency_key=?', key)
  requireThat(!keyed || (keyed.source_invoice_id === sourceId && keyed.fee_date === day), 'This request key was used for another late fee; use a new key', 409)
  return keyed ?? await one(c.db, 'SELECT * FROM pt_late_fee_preparations WHERE source_invoice_id=?', sourceId)
}

async function response(c: Context, row: Data, alreadyPrepared: boolean) {
  return { invoiceId: row.invoice_id, draft: await invoice(c.db, row.invoice_id), preparation: preparationView(row), alreadyPrepared }
}

// Match the native receivable calculation, then fence both its dated basis and
// its current balance so a payment landing during preparation stops the batch.
function balanceFence(id: string, total: number, balance: number, asOf: string) {
  return guard(`? - (SELECT COALESCE(SUM(a.amount_cents),0) FROM pt_allocations a
    LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id
    WHERE a.target_kind='invoice' AND a.target_id=? AND a.allocation_date<=?
      AND (a.source_kind='credit' OR p.reversal_id IS NULL)
      AND (a.voided_on IS NULL OR a.voided_on>?)) = ?`, total, id, asOf, asOf, balance)
}

export const prepareFee: Command = { need: 'record', async run(c, b) {
  must(c.actor, 'record')
  await assertDoor(c, '/api/pantry/command/invoice.save-draft', b)
  const sourceId = text(b.invoiceId, 'Original invoice'), day = date(b.date, 'Late fee date')
  const key = text(b.idempotencyKey, 'Request key', 200)
  const prior = await existing(c, sourceId, day, key)
  if (prior) return response(c, prior, true)
  const policy = await lateFeePolicy(c.db)
  requireThat(policy.enabled, 'Late fees are off; the owner must enable a policy first', 409)
  const source = await invoice(c.db, sourceId)
  requireThat(source.kind === 'invoice' && source.status === 'issued' && source.open_cents > 0, 'Choose an issued invoice with an open balance', 409)
  requireThat(!await one(c.db, 'SELECT id FROM pt_late_fee_preparations WHERE invoice_id=?', sourceId), 'A late fee cannot be charged on another late fee', 409)
  const overdueDays = daysBetween(source.due_date, day)
  requireThat(overdueDays >= Math.max(1, policy.graceDays), 'The invoice has not passed the policy grace period', 409)
  const basis = await openBalance(c.db, 'invoice', sourceId, source.total_cents, day)
  requireThat(basis > 0, 'The original invoice has no open balance on the late fee date', 409)
  const fee = policy.method === 'percentage' ? scale(basis, policy.percentageMilli!, 100000) : policy.flatCents!
  requireThat(fee > 0, 'The late fee rounds to zero; no charge was prepared')
  await assertOpen(c.db, day)
  const memo = `Late fee on invoice ${source.number}, due ${source.due_date}. Open balance on ${day}: ${usd(basis)}. Policy revision ${policy.revision}.`
  const p = await parseInvoice(c.db, { customerId: source.customer_id, issueDate: day,
    destinationState: source.destination_state, memo,
    lines: [{ description: `Late fee on invoice ${source.number}`, quantity: '1', rate: (fee / 100).toFixed(2),
      accountId: policy.incomeAccountId, taxCode: policy.taxCode,
      className: b.className, locationName: b.locationName, projectName: b.projectName }] })
  const certificates = exemptionFence(p.exemption, p.customer.id, p.destination, day, await exemptionDay(c.db))
  const id = uid(), preparationId = uid(), number = await nextNumber(c.db, 'invoice'), at = now()
  const sourceSnapshot = { id: sourceId, number: source.number, revision: source.revision, customerId: source.customer_id,
    issueDate: source.issue_date, dueDate: source.due_date, totalCents: source.total_cents,
    currentOpenCents: source.open_cents, basisCents: basis, basisDate: day, overdueDays }
  try {
    await run(c.db, [authority(c.actor, 'record'), periodOpen(day), ...certificates,
      guard('EXISTS(SELECT 1 FROM pt_late_fee_policy WHERE id=1 AND enabled=1 AND revision=?)', policy.revision),
      guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND kind='invoice' AND status='issued' AND revision=?)", sourceId, source.revision),
      guard("EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND type='income')", policy.incomeAccountId),
      ...(policy.taxCode && policy.taxCode !== 'exempt' ? [guard('EXISTS(SELECT 1 FROM pt_tax_codes WHERE id=? AND active=1)', policy.taxCode)] : []),
      balanceFence(sourceId, source.total_cents, basis, day), balanceFence(sourceId, source.total_cents, source.open_cents, '9999-12-31'),
      q("INSERT INTO pt_invoices(id,kind,number,customer_id,destination_state,exemption_evidence,issue_date,due_date,status,memo,subtotal_cents,tax_cents,total_cents,opening,prepared_by,revision,created_at) VALUES (?,'invoice',?,?,?,?,?,?,'draft',?,?,?,?,0,?,?,?)",
        id, number, p.customer.id, p.destination, p.exemption ? JSON.stringify(p.exemption) : null, p.issueDate, p.dueDate, p.memo, p.subtotal, p.tax, p.total, c.actor.email, uid(), at),
      ...documentSelectionStatements(id, p), ...lineStatements(id, p.lines),
      q('INSERT INTO pt_late_fee_preparations(id,source_invoice_id,invoice_id,fee_date,idempotency_key,policy_revision,policy_snapshot,source_snapshot,basis_cents,fee_cents,prepared_by,prepared_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
        preparationId, sourceId, id, day, key, policy.revision, JSON.stringify(policy), JSON.stringify(sourceSnapshot), basis, fee, c.actor.email, at),
      audit(who(c.actor), 'invoice.draft', 'invoice', id, { number, total: p.total, lateFee: { preparationId, source: sourceSnapshot, policy, feeCents: fee } }),
      audit(who(c.actor), 'late-fee.prepare', 'invoice', id, { preparationId, sourceInvoiceId: sourceId, policyRevision: policy.revision, basisCents: basis, feeCents: fee })])
  } catch (error) {
    if (/(?:UNIQUE constraint failed: |That record already exists: )(pt_late_fee_preparations\.|pt_invoices.number)/.test(String((error as Error)?.message ?? error))) {
      const winner = await existing(c, sourceId, day, key)
      if (winner) return response(c, winner, true)
    }
    throw error
  }
  const saved = await one(c.db, 'SELECT * FROM pt_late_fee_preparations WHERE id=?', preparationId)
  requireThat(saved, 'Late fee preparation was not saved', 409)
  return response(c, saved, false)
} }
