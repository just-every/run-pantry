// Typed corrective work reuses each record's native approval plan. Preparing a
// proposal never posts a duplicate entry or changes an allocation.
import { must, type Actor } from './access'
import { requireThat, text, type Data } from './core'
import { all, one } from './db'
import { journalPostingPlan } from './journal'
import { billPostingPlan, paymentAllocationPlan } from './payables'
import { invoiceApprovalPlan, invoiceIssuingPlan } from './invoices'

const actions = ['post-draft', 'post-bill', 'approve-invoice', 'issue-invoice', 'allocate-payment']
export async function mechanicalActionRefs(db: D1Database, payload: Data) {
  requireThat(actions.includes(payload.action), 'Unknown mechanical correction')
  const id = text(payload.id, 'Record')
  if (payload.action === 'allocate-payment') {
    const payment = await one(db, 'SELECT * FROM pt_payments WHERE id = ? AND reversal_id IS NULL', id)
    requireThat(payment, 'Payment not found or reversed', 409)
    requireThat(Array.isArray(payload.allocations) && payload.allocations.length === 1, 'A mechanical payment correction selects exactly one supported item')
    return [{ kind: 'payment', id }, { kind: payment.direction === 'received' ? 'invoice' : 'bill', id: text(payload.allocations[0].targetId, 'Open item') }]
  }
  const kind = payload.action === 'post-draft' ? 'journal' : payload.action === 'post-bill' ? 'bill' : 'invoice'
  const table = kind === 'journal' ? 'pt_journal_entries' : kind === 'bill' ? 'pt_bills' : 'pt_invoices'
  const row = await one(db, `SELECT * FROM ${table} WHERE id = ?`, id)
  requireThat(row && row.revision === payload.revision, 'Record changed; prepare this correction again', 409)
  requireThat(row.status === (payload.action === 'issue-invoice' ? 'approved' : 'draft'), 'Record is no longer awaiting this correction', 409)
  const refs = [{ kind, id, revision: row.revision }]
  if (kind === 'journal') {
    requireThat(row.source_kind === 'manual' && row.document_id, 'A mechanical draft posting requires a manual draft and its source document', 409)
    refs.push({ kind: 'document', id: row.document_id, revision: undefined })
  }
  if (kind === 'bill') {
    const documents = await all(db, "SELECT id FROM pt_documents WHERE linked_kind = 'bill' AND linked_id = ?", id)
    requireThat(documents.length > 0, 'A mechanical bill posting requires its source document', 409)
    refs.push(...documents.map(d => ({ kind: 'document', id: d.id, revision: undefined })))
  }
  return refs
}

export async function mechanicalActionPlan(db: D1Database, actor: Actor, payload: Data, selectedDate?: string) {
  requireThat(actor.kind === 'person', 'A person approves mechanical corrections', 403)
  must(actor, ['post-draft', 'approve-invoice'].includes(payload.action) ? 'post' : 'record')
  await mechanicalActionRefs(db, payload)
  const context = { db, actor }, body = { ...payload, ...(payload.action === 'allocate-payment' ? { paymentId: payload.id } : {}) }
  const plan = payload.action === 'post-draft' ? await journalPostingPlan(context, body)
    : payload.action === 'post-bill' ? await billPostingPlan(context, body)
    : payload.action === 'approve-invoice' ? await invoiceApprovalPlan(context, body)
    : payload.action === 'issue-invoice' ? await invoiceIssuingPlan(context, body)
    : await paymentAllocationPlan(context, body)
  requireThat(!selectedDate || selectedDate === plan.day, 'This correction retains the source date; reopen its period rather than moving the record', 409)
  return plan
}
