import { jsonFields, resource } from './model'

export const catalogResources = [
  resource('business', 'business:read', 'pt_entity', 'CAST(id AS TEXT) AS id,legal_name,entity_type,state,currency,fiscal_year_start,book_basis,tax_method,books_start,revision', {}, 'Business accounting identity and reporting calendar; owner security/policy settings excluded.'),
  resource('accounts', 'accounts:read', 'pt_accounts', 'id,code,name,type,subtype,description,active,suspense,revision', { code: 'code', name: 'name', type: 'type', active: 'active' }, 'Chart of accounts, including inactive and suspense accounts.'),
  resource('tax-codes', 'tax-codes:read', 'pt_tax_codes', 'id,name,state,rate_milli_percent,account_id,active,revision,early_treatment,early_treatment_revision,early_treatment_reason', { name: 'name', state: 'state', active: 'active' }, 'Tax rates and recorded early-discount treatment; no policy mutation.'),
  resource('items', 'items:read', 'pt_items', 'id,name,kind,description,sku,rate_cents,income_account_id,tax_category,tax_code,active,revision,created_at', { name: 'name', sku: 'sku', kind: 'kind', active: 'active' }, 'Sellable item catalog and accounting defaults.'),
  resource('contact-deliveries', 'contacts:read', 'pt_deliveries d JOIN pt_invoices i ON i.id=d.invoice_id', 'd.id,i.customer_id,d.invoice_id,d.kind,d.recipient,d.subject,d.provider,d.status,d.attachment_sha256,d.at,d.finished_at', { customerId: 'customer_id', invoiceId: 'invoice_id', status: 'status' }, 'Every customer invoice email and delivery outcome; no mail-provider detail, hosted link or message identifier.'),
  resource('contact-aliases', 'contacts:read', 'pt_vendor_aliases', "vendor_id || ':' || alias_key AS id,vendor_id,alias,confirmed_at", { vendorId: 'vendor_id', alias: 'alias' }, 'Confirmed vendor aliases used in the books.'),
  resource('exemptions', 'exemptions:read', 'pt_exemption_certificates', 'id,customer_id,document_id,certificate_number,states,valid_from,expires_on,active,replaces_id,created_at', { customerId: 'customer_id', active: 'active' }, 'Certificate metadata and document reference; original bytes require documents scope.', { project: jsonFields({ states: null }) }),
  resource('contractors', 'contractors:read', 'pt_contractor_tax', "contact_id AS id,contact_id,legal_name,tin_kind,CASE WHEN tin_last4 IS NULL THEN NULL ELSE '***-**-' || tin_last4 END AS tin_masked,address,city,state,zip,revision,updated_at,erased_at", { contactId: 'contact_id', state: 'state' }, 'Contractor filing details with masked TIN only; no full-TIN or filing-export door.'),
  resource('nexus-alerts', 'nexus-alerts:read', 'pt_nexus_alerts', 'id,state,level,period,sales_cents,transactions,threshold_version,raised_at,resolved_at', { state: 'state', period: 'period', level: 'level' }, 'Recorded sales-tax nexus observations; excludes recipient and mail-provider payloads.'),
  resource('nexus-decisions', 'nexus-decisions:read', 'pt_nexus_decisions', 'id,state,decision,note,period,sales_cents,transactions,reached_bp,threshold_version,decided_at', { state: 'state', period: 'period' }, 'Recorded nexus registration decisions.'),
  resource('receipts', 'receipts:read', 'pt_receipts', 'id,document_id,file_document_id,source,read_status,vendor,receipt_date,total_cents,tax_cents,currency,account_id,status,target_kind,target_id,linked_kind,linked_id,rule_id,decided_at,received_at,revision,duplicate_of,duplicate_basis,duplicate_reason,invoice_number,vendor_id,class_name,location_name,project_name', { vendorId: 'vendor_id', documentId: 'document_id', status: 'status', linkedId: 'linked_id' }, 'Receipt accounting and duplicate decisions; no raw model, inbound mail or extracted snapshots.'),
  resource('capture-sources', 'receipts:read', 'pt_capture_sources', 'id,document_id,revision,regions,source,created_at', { documentId: 'document_id' }, 'Exact source-photo reference and selected receipt regions; original bytes require documents scope.', { project: jsonFields({ regions: null }) }),
  resource('capture-parts', 'receipts:read', 'pt_capture_parts', 'receipt_id AS id,source_id,part_index,document_id', { sourceId: 'source_id', documentId: 'document_id' }, 'Receipt crop provenance; the source photograph remains a separate exact original.'),
  resource('capture-drafts', 'receipts:read', 'pt_capture_drafts', 'id,receipt_id,kind,bill_id,bank_line_id,status,revision,approved_revision,created_at,updated_at,submitted_revision', { receiptId: 'receipt_id', status: 'status', billId: 'bill_id' }, 'Receipt capture draft lifecycle metadata; proposed payload and approval policies stay native.'),
  resource('receipt-rules', 'receipt-rules:read', 'pt_receipt_rules', 'id,vendor,account_id,max_cents,active,created_at', { vendor: 'vendor', active: 'active' }, 'Receipt categorization rules; owner approval/security policies remain native.'),
  resource('cutovers', 'cutovers:read', 'pt_cutovers', 'id,source,cutover_date,opening_entry_id,status,accepted_at,revision', { source: 'source', status: 'status' }, 'Accepted or staged migration business records; no raw import snapshots.'),
  resource('historical-lines', 'cutovers:read', 'pt_history_lines', 'id,cutover_id,account,txn_date,txn_type,num,name,memo,split,amount_cents,source_row,revision', { cutoverId: 'cutover_id', account: 'account', date: 'txn_date' }, 'Native historical ledger archive; not a calculated financial report.'),
]

// History consent covers contact activity metadata, not full sibling records or hosted links.
const financialHistory = `(
 SELECT 'invoice:' || id AS id,customer_id AS contact_id,'invoice' AS kind,id AS record_id,issue_date AS date,number AS reference,status,total_cents AS amount_cents,credit_for AS related_id FROM pt_invoices
 UNION ALL SELECT 'bill:' || id,vendor_id,'bill',id,bill_date,reference,status,total_cents,NULL FROM pt_bills
 UNION ALL SELECT 'payment:' || id,contact_id,'payment',id,payment_date,reference,CASE WHEN reversal_id IS NULL THEN 'recorded' ELSE 'reversed' END,amount_cents,reversal_id FROM pt_payments
 UNION ALL SELECT 'credit:' || id,vendor_id,'vendor-credit',id,credit_date,reference,'posted',amount_cents,NULL FROM pt_vendor_credits
 )`
const correspondenceHistory = `(
 SELECT 'delivery:' || d.id AS id,i.customer_id AS contact_id,'delivery' AS kind,d.id AS record_id,d.at AS date,d.subject AS reference,d.status,NULL AS amount_cents,i.id AS related_id FROM pt_deliveries d JOIN pt_invoices i ON i.id=d.invoice_id
 UNION ALL SELECT 'exemption:' || id,customer_id,'exemption',id,valid_from,certificate_number,CASE WHEN active=1 THEN 'active' ELSE 'retired' END,NULL,document_id FROM pt_exemption_certificates
)`
// D1 bounds each compound SELECT; keep the financial and correspondence sets bounded.
const estimateHistory = `(
 SELECT 'estimate:' || id AS id,customer_id AS contact_id,'estimate' AS kind,id AS record_id,issue_date AS date,number AS reference,status,total_cents AS amount_cents,NULL AS related_id FROM pt_estimates
 UNION ALL SELECT 'deposit:' || id,customer_id,'customer-deposit',id,date,reference,'recorded',amount_cents,journal_id FROM pt_customer_deposits
)`
const history = `(SELECT * FROM ${financialHistory} UNION ALL SELECT * FROM ${correspondenceHistory} UNION ALL SELECT * FROM ${estimateHistory})`
export const contactHistoryResource = resource('contact-history', 'contacts:read', history, 'id,contact_id,kind,record_id,date,reference,status,amount_cents,related_id', { contactId: 'contact_id', kind: 'kind', date: 'date', recordId: 'record_id' }, 'Complete paginated contact activity: invoices, credits, bills, payments, estimates, advance deposits, email outcomes and certificates. Full records require their own scope; no delivery detail, tokens or provider headers.')
