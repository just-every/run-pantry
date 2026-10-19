-- Keep each original, including duplicate intake and the person's decision.
ALTER TABLE pt_receipts ADD COLUMN read_invoice_number TEXT;
ALTER TABLE pt_receipts ADD COLUMN invoice_number TEXT;
ALTER TABLE pt_receipts ADD COLUMN duplicate_document_id TEXT REFERENCES pt_documents(id);
ALTER TABLE pt_documents ADD COLUMN capture_vendor TEXT;
ALTER TABLE pt_documents ADD COLUMN capture_invoice_number TEXT;
ALTER TABLE pt_documents ADD COLUMN capture_date TEXT;
ALTER TABLE pt_documents ADD COLUMN capture_total_cents INTEGER;
ALTER TABLE pt_documents ADD COLUMN duplicate_of TEXT REFERENCES pt_documents(id);
ALTER TABLE pt_documents ADD COLUMN duplicate_basis TEXT;
ALTER TABLE pt_documents ADD COLUMN duplicate_reason TEXT;
ALTER TABLE pt_documents ADD COLUMN duplicate_decision TEXT CHECK (duplicate_decision IN ('keep', 'skip'));
ALTER TABLE pt_documents ADD COLUMN requested_linked_kind TEXT;
ALTER TABLE pt_documents ADD COLUMN requested_linked_id TEXT;
CREATE INDEX pt_documents_sha256 ON pt_documents(sha256);

-- One comparison surface for phone/email receipts, ordinary uploads and
-- existing bill attachments. Derive legacy bill facts without rewriting bytes.
CREATE VIEW pt_capture_facts AS
WITH RECURSIVE raw AS (
  SELECT d.id AS document_id, d.rowid AS document_order, d.sha256, r.id AS receipt_id,
    COALESCE(r.vendor, r.read_vendor, d.capture_vendor, c.name, '') AS vendor,
    COALESCE(r.invoice_number, r.read_invoice_number, d.capture_invoice_number, b.reference, '') AS invoice_number,
    COALESCE(r.receipt_date, r.read_date, d.capture_date, b.bill_date) AS receipt_date,
    COALESCE(r.total_cents, r.read_total_cents, d.capture_total_cents, b.total_cents) AS total_cents,
    COALESCE(r.status, CASE WHEN d.linked_kind IS NOT NULL THEN 'attached' ELSE 'review' END) AS status
  FROM pt_documents d
  LEFT JOIN pt_receipts r ON d.id = r.document_id OR d.id = r.file_document_id
  LEFT JOIN pt_bills b ON d.linked_kind = 'bill' AND d.linked_id = b.id AND b.status <> 'void'
  LEFT JOIN pt_contacts c ON c.id = b.vendor_id
  WHERE COALESCE(r.status, '') <> 'dismissed' AND COALESCE(d.duplicate_decision, '') <> 'skip'
), normalized(document_id, remaining_vendor, vendor_key, remaining_invoice, invoice_key) AS (
  SELECT document_id, lower(vendor), '', lower(invoice_number), '' FROM raw
  UNION ALL
  SELECT document_id, substr(remaining_vendor, 2), vendor_key || CASE WHEN substr(remaining_vendor, 1, 1) GLOB '[a-z0-9]' THEN substr(remaining_vendor, 1, 1) ELSE '' END,
    substr(remaining_invoice, 2), invoice_key || CASE WHEN substr(remaining_invoice, 1, 1) GLOB '[a-z0-9]' THEN substr(remaining_invoice, 1, 1) ELSE '' END
  FROM normalized WHERE remaining_vendor <> '' OR remaining_invoice <> ''
)
SELECT raw.*, normalized.vendor_key, normalized.invoice_key FROM raw JOIN normalized USING (document_id)
WHERE remaining_vendor = '' AND remaining_invoice = '';
