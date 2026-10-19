-- Certificates are evidence revisions: renewal adds a new document and retires
-- the previous certificate. Issued invoices keep their original citation.
CREATE TABLE pt_exemption_certificates (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 document_id TEXT NOT NULL REFERENCES pt_documents(id),
 certificate_number TEXT NOT NULL,
 states TEXT NOT NULL CHECK (json_valid(states)),
 valid_from TEXT NOT NULL,
 expires_on TEXT NOT NULL CHECK (expires_on >= valid_from),
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 replaces_id TEXT REFERENCES pt_exemption_certificates(id),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX pt_exemption_customer ON pt_exemption_certificates(customer_id, active, expires_on);
CREATE TABLE pt_exemption_reminders (
 certificate_id TEXT PRIMARY KEY REFERENCES pt_exemption_certificates(id),
 reminded_at TEXT NOT NULL,
 email_status TEXT NOT NULL DEFAULT 'pending',
 email_detail TEXT NOT NULL DEFAULT ''
);
ALTER TABLE pt_invoices ADD COLUMN destination_state TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_invoices ADD COLUMN exemption_evidence TEXT;
ALTER TABLE pt_invoice_lines ADD COLUMN chosen_tax_code TEXT;
UPDATE pt_invoice_lines SET chosen_tax_code = tax_code;
