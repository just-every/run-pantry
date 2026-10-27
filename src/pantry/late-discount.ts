// Optional late honors reuse only the invoice's approved INVOICE-010 offer.
import { authority, who } from './access'
import { date, now, requireThat, text, uid, type Data } from './core'
import { assertOpen, audit, guard, one, periodOpen, q, run, type Sql } from './db'
import { dimensionTags, dimensionValues } from './dimensions'
import { invoice } from './invoices'
import { standingDiscount, type Offer } from './early-payment'
import { documentSelectionStatements } from './invoice-documents'
import { selectedTemplate, customValues } from './invoice-templates'
import { contact } from './contacts'
import type { Command } from './context'

export async function lateDiscountChecks(db: D1Database, credit: Data): Promise<Sql[]> {
  if (!credit.early_detail?.honoredAfterWindow) return []
  const source = await invoice(db, credit.credit_for), offer = source.early_offer as Offer | null
  requireThat(source.status === 'issued' && offer && !source.early_withdrawn_by && !await standingDiscount(db, source.id), 'The original early-payment offer was withdrawn or already taken', 409)
  requireThat(credit.issue_date > offer.windowEnd && credit.total_cents === offer.discount + offer.reduction && !credit.write_off, 'Honor only the original approved discount after its window', 409)
  const account = await one(db, "SELECT id FROM pt_accounts WHERE id=? AND active=1 AND subtype='other' AND type IN ('income','expense')", offer.accountId)
  requireThat(account, 'The approved discounts account is no longer active', 409)
  return [guard("EXISTS(SELECT 1 FROM pt_invoices WHERE id=? AND status='issued' AND revision=? AND early_withdrawn_by IS NULL)", source.id, source.revision),
    guard("NOT EXISTS(SELECT 1 FROM pt_invoices WHERE credit_for=? AND early_discount=1 AND early_reversal_id IS NULL)", source.id),
    guard("EXISTS(SELECT 1 FROM pt_accounts WHERE id=? AND active=1 AND subtype='other' AND type IN ('income','expense'))", offer.accountId)]
}
const prepare: Command = { need: 'record', async run(c, b) {
  requireThat(c.actor.kind === 'person' && ['owner','accountant','bookkeeper'].includes(c.actor.role), 'A financial team member prepares a late discount honor', 403)
  const source = await invoice(c.db, text(b.invoiceId, 'Invoice')), offer = source.early_offer as Offer | null
  requireThat(source.kind === 'invoice' && source.status === 'issued' && offer, 'Choose an issued invoice with an approved early-payment term', 409)
  const day = date(b.date, 'Honor date'), reason = text(b.reason, 'Reason for honoring the discount', 500)
  await assertOpen(c.db, day)
  const detail = { honoredAfterWindow: true, invoice: source.number, takenOn: day, windowEnd: offer.windowEnd, base: offer.base, discount: offer.discount, reduction: offer.reduction, settle: offer.settle, reason,
    treatments: Object.fromEntries(offer.lines.filter(l => l.code).map(l => [l.code!.id, { treatment: l.code!.treatment, revision: l.code!.revision }])), lines: offer.lines.map(l => ({ line: l.lineNo, net: l.net, discount: l.discount, reduction: l.reduction, treatment: l.code?.treatment ?? 'exempt' })) }
  const credit = { credit_for: source.id, early_detail: detail, issue_date: day, total_cents: offer.discount + offer.reduction, write_off: 0 }
  const checks = await lateDiscountChecks(c.db, credit)
  const id = uid(), revision = uid(), customer = await contact(c.db, source.customer_id, 'customer'), template = await selectedTemplate(c.db, customer)
  const memo = `Early-payment discount on ${source.number}, honored after window: ${reason}`
  await run(c.db, [authority(c.actor, 'record'), periodOpen(day), ...checks,
    // Allocate inside the serialized write, so concurrent preparations keep
    // separate draft numbers while the existing issue guards permit one honor.
    q("INSERT INTO pt_invoices(id,kind,number,customer_id,destination_state,issue_date,due_date,status,memo,credit_for,subtotal_cents,tax_cents,total_cents,opening,prepared_by,revision,created_at,early_detail) VALUES (?,'credit',(SELECT 'CR-' || printf('%04d', COALESCE(MAX(CAST(substr(number,4) AS INTEGER)),0)+1) FROM pt_invoices WHERE number GLOB 'CR-[0-9]*' AND substr(number,4) NOT GLOB '*[^0-9]*'),?,?,?,?,'draft',?,?,?,?,?,0,?,?,?,?)", id, source.customer_id, source.destination_state, day, day, memo, source.id, offer.discount, offer.reduction, credit.total_cents, c.actor.email, revision, now(), JSON.stringify(detail)),
    ...offer.lines.filter(l => l.discount > 0).map((l, i) => {
      const original = source.lines.find((o: Data) => o.line_no === l.lineNo)!
      return q("INSERT INTO pt_invoice_lines(id,invoice_id,line_no,description,quantity_milli,unit_cents,amount_cents,account_id,tax_code,tax_cents,chosen_tax_code,early_treatment,early_line_ref,class_name,location_name,project_name) VALUES (?,?,?,?,1000,?,?,?,?,?,?,?,?,?,?,?)", uid(), id, i+1, `Discount honored after window · ${original.description}`, l.discount, l.discount, offer.accountId, original.tax_code, l.reduction, original.tax_code, l.code?.treatment ?? 'exempt', original.id, ...dimensionValues(dimensionTags(original)))
    }),
    ...documentSelectionStatements(id, { documentTemplate: template, documentValues: customValues(template, {}) }),
    audit(who(c.actor), 'early-discount.prepare-late', 'credit', id, { ...detail, sourceInvoiceId: source.id, revision })])
  return invoice(c.db, id)
} }
export const lateDiscountCommands = { 'early-discount.prepare-late': prepare }
