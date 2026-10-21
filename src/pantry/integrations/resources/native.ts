import type { Data } from '../../core'
import { requireThat } from '../../core'
import { one } from '../../db'
import { pick } from './model'

const fields: Record<string, string> = {
  contacts: 'id,kind,name,email,terms_days,external_ref,active,revision,is_1099,bank_reference,address,phone,default_account_id,default_class,contacts_json,billing_address,service_address,internal_notes,pay_methods,invoice_template_id,invoice_terms_override,erased_at',
  invoices: 'id,kind,number,customer_id,customer_name,customer_email,issue_date,due_date,status,memo,credit_for,subtotal_cents,tax_cents,total_cents,opening,journal_id,prepared_by,approved_by,approved_revision,issued_by,revision,created_at,sent_at,viewed_at,reminders_paused,recurring_id,destination_state,exemption_evidence,exemption,write_off,document_template_id,document_template_revision,issued_document_revision,issued_pdf_sha256,discounts,discount_cents,after_tax_discount_cents,discount_account_id,deposit,deposit_payment_id,early_terms,early_offer,early_withdrawn_by,early_discount,early_detail,early_reversal_id,open_cents',
  bills: 'id,vendor_id,vendor_name,reference,bill_date,due_date,status,memo,total_cents,opening,evidence_waived,journal_id,prepared_by,revision,created_at,received,ready_to_pay,class_name,approved_by,approved_revision,updated_at,submitted_revision,scheduled_date,scheduled_note,open_cents',
  journals: 'id,number,entry_date,memo,source_kind,source_id,status,prepared_by,prepared_kind,proposal_id,document_id,posted_by,posted_at,reverses_id,reversed_by_id,revision,created_at,adjusting',
  documents: 'id,name,media_type,size,sha256,linked_kind,linked_id,note,uploaded_by,uploaded_at,duplicate_of,duplicate_basis,duplicate_reason,duplicate_decision,erased_at',
  payments: 'id,direction,contact_id,payment_date,amount_cents,bank_account_id,reference,memo,journal_id,reversal_id,recorded_by,created_at,method,card_last4,unallocated_cents',
  'vendor-credits': 'id,vendor_id,vendor_name,account_name,reference,credit_date,amount_cents,account_id,journal_id,created_by,created_at,write_off,unallocated_cents',
}
const lines: Record<string, string> = {
  invoices: 'id,invoice_id,line_no,description,quantity_milli,unit_cents,amount_cents,account_id,tax_code,tax_cents,chosen_tax_code,item_id,line_kind,discount_cents,early_treatment,early_line_ref',
  bills: 'id,bill_id,line_no,description,account_id,amount_cents',
  journals: 'id,entry_id,line_no,account_id,debit_cents,credit_cents,memo,contact_id,account_code,account_name',
}
/** Native readers calculate balances and accounting terms; serialization never returns full native rows. */
export function nativeRecord(kind: string, row: Data): Data {
  const projected = pick(row, fields[kind])
  if (lines[kind] && row.lines) projected.lines = row.lines.map((line: Data) => pick(line, lines[kind]))
  if (kind === 'bills' && row.documents) projected.documents = row.documents.map((doc: Data) => pick(doc, 'id,name,sha256'))
  if (row.allocations) projected.allocations = row.allocations.map((a: Data) => pick(a, 'id,source_kind,source_id,target_kind,target_id,amount_cents,allocation_date,created_by,created_at,early_counted,voided_on,voided_by'))
  return projected
}

export async function integrationContact(db: D1Database, id: string) {
  const row = await one(db, `SELECT ${fields.contacts} FROM pt_contacts WHERE id = ?`, id)
  requireThat(row, 'Customer or vendor not found', 404)
  return row
}
