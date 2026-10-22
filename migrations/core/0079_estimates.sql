-- Estimates are non-posting commitments. Every sent revision keeps its own PDF.
CREATE TABLE pt_estimates (
 id TEXT PRIMARY KEY, number TEXT NOT NULL UNIQUE, customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 issue_date TEXT NOT NULL, due_date TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('draft','sent','accepted')),
 input TEXT NOT NULL, pricing TEXT NOT NULL, total_cents INTEGER NOT NULL CHECK(total_cents>0),
 prepared_by TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL, sent_at TEXT,
 link_token TEXT UNIQUE, accepted_name TEXT, accepted_at TEXT, accepted_ip TEXT, accepted_revision TEXT,
 erased_at TEXT
);
CREATE TABLE pt_estimate_documents (
 estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), revision TEXT NOT NULL,
 document TEXT NOT NULL, pdf_base64 TEXT NOT NULL, sha256 TEXT NOT NULL, retained_at TEXT NOT NULL, erased_at TEXT,
 PRIMARY KEY(estimate_id,revision)
);
CREATE TABLE pt_estimate_deliveries (
 id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), revision TEXT NOT NULL,
 recipient TEXT NOT NULL, status TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL,
 attachment_sha256 TEXT NOT NULL
);
CREATE TABLE pt_estimate_conversions (
 id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), estimate_revision TEXT NOT NULL,
 request_id TEXT NOT NULL, request_hash TEXT NOT NULL, invoice_id TEXT NOT NULL UNIQUE REFERENCES pt_invoices(id),
 mode TEXT NOT NULL CHECK(mode IN ('full','percent','milestone','balance')), amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 milestone TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL,
 UNIQUE(estimate_id,request_id)
);
ALTER TABLE pt_invoices ADD COLUMN estimate_id TEXT REFERENCES pt_estimates(id);
ALTER TABLE pt_invoices ADD COLUMN estimate_revision TEXT;
ALTER TABLE pt_invoices ADD COLUMN estimate_billed_before_cents INTEGER;
ALTER TABLE pt_invoices ADD COLUMN estimate_remaining_cents INTEGER;
CREATE TABLE pt_customer_deposits (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES pt_contacts(id), date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 liability_account_id TEXT NOT NULL REFERENCES pt_accounts(id), method TEXT NOT NULL, reference TEXT NOT NULL,
 memo TEXT NOT NULL DEFAULT '', journal_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 revision TEXT NOT NULL, recorded_by TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(customer_id,reference)
);
ALTER TABLE pt_payments ADD COLUMN customer_deposit_id TEXT REFERENCES pt_customer_deposits(id);
CREATE TABLE pt_customer_deposit_applications (
 id TEXT PRIMARY KEY, deposit_id TEXT NOT NULL REFERENCES pt_customer_deposits(id),
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id), payment_id TEXT NOT NULL UNIQUE REFERENCES pt_payments(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), date TEXT NOT NULL, request_id TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE pt_invoice_deposit_plans (
 invoice_id TEXT PRIMARY KEY REFERENCES pt_invoices(id), deposit_id TEXT NOT NULL REFERENCES pt_customer_deposits(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0), created_at TEXT NOT NULL
);
CREATE INDEX pt_estimate_customer ON pt_estimates(customer_id,created_at);
CREATE INDEX pt_deposit_customer ON pt_customer_deposits(customer_id,date);
-- Sent document bytes are immutable, except journaled owner-confirmed expiry.
CREATE TRIGGER pt_estimate_document_immutable BEFORE UPDATE ON pt_estimate_documents
WHEN NOT (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.pdf_base64='' AND NEW.document='{}'
 AND NEW.sha256=OLD.sha256 AND NEW.estimate_id=OLD.estimate_id AND NEW.revision=OLD.revision AND NEW.retained_at=OLD.retained_at
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
 WHERE s.table_name='pt_estimate_documents' AND s.row_id=OLD.estimate_id||':'||OLD.revision AND s.operation='expire'))
BEGIN SELECT RAISE(ABORT,'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
