import { resource } from './model'

// Owner-selected read scopes expose business records, never acceptance links,
// IP addresses, retained document bytes or editable pricing/input snapshots.
export const estimateResources = [
  resource('estimate-sibling-links', 'estimate-sibling-links:read', 'pt_estimate_sibling_links', 'id,estimate_id,estimate_revision,provider,remote_revision,proof_sha256,pdf_sha256,attached_at,erased_at',
    { estimateId: 'estimate_id', provider: 'provider' }, 'Owner-selected signature/proposal association and retained proof hashes only; excludes source origin, remote ID, personal summary, signed bytes and source credentials.'),
  resource('estimates', 'estimates:read', 'pt_estimates', 'id,number,customer_id,issue_date,due_date,status,total_cents,prepared_by,revision,created_at,sent_at,accepted_name,accepted_at,accepted_revision,erased_at',
    { customerId: 'customer_id', number: 'number', status: 'status', date: 'issue_date' }, 'Estimate identity, amount and typed-name acceptance metadata; no acceptance IP, customer bearer link or saved input.'),
  resource('estimate-conversions', 'estimates:read', 'pt_estimate_conversions', 'id,estimate_id,estimate_revision,invoice_id,mode,amount_cents,milestone,created_at',
    { estimateId: 'estimate_id', invoiceId: 'invoice_id', mode: 'mode' }, 'Progress or milestone conversions and their native invoice references; invoice details require invoices scope.'),
  resource('estimate-documents', 'estimates:read', 'pt_estimate_documents', "estimate_id || ':' || revision AS id,estimate_id,revision,sha256,retained_at,erased_at",
    { estimateId: 'estimate_id', revision: 'revision' }, 'Retained sent estimate revision and PDF hash metadata; no document content or bytes.'),
  resource('estimate-deliveries', 'estimates:read', 'pt_estimate_deliveries', 'id,estimate_id,revision,recipient,status,at,attachment_sha256',
    { estimateId: 'estimate_id', status: 'status' }, 'Estimate email recipient, outcome and attached revision hash; no provider diagnostic or acceptance link.'),
  resource('customer-deposits', 'customer-deposits:read', 'pt_customer_deposits', 'id,customer_id,date,amount_cents,bank_account_id,liability_account_id,method,reference,memo,journal_id,revision,recorded_by,created_at',
    { customerId: 'customer_id', date: 'date', reference: 'reference', bankAccountId: 'bank_account_id' }, 'Advance customer deposit receipt and liability accounting references; no payment authority.'),
  resource('customer-deposit-applications', 'customer-deposits:read', 'pt_customer_deposit_applications', 'id,deposit_id,invoice_id,payment_id,amount_cents,date,created_at',
    { depositId: 'deposit_id', invoiceId: 'invoice_id', date: 'date' }, 'Applications of held customer money to issued invoices; no second bank receipt or write authority.'),
  resource('invoice-deposit-plans', 'customer-deposits:read', 'pt_invoice_deposit_plans', 'invoice_id AS id,invoice_id,deposit_id,amount_cents,created_at',
    { invoiceId: 'invoice_id', depositId: 'deposit_id' }, 'Advance deposits reserved by invoice drafts for application at issue; read-only metadata.'),
]
