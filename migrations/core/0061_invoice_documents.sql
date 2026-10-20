-- Invoice presentation is saved with each draft, then retained with the issued
-- revision. Payment balances and customer links remain live outside the document.
CREATE TABLE pt_invoice_templates (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 settings TEXT NOT NULL CHECK (json_valid(settings)),
 revision TEXT NOT NULL,
 updated_by TEXT,
 updated_at TEXT NOT NULL
);
INSERT INTO pt_invoice_templates VALUES ('standard', 'Services', '{"layout":"classic","accentColor":"#433b65","textColor":"#202234","address":"","remitTo":"","termsDays":30,"paymentInstructions":"","footer":"","message":"","logo":null,"fields":[]}', 'initial', NULL, '2026-01-01T00:00:00.000Z');
CREATE TABLE pt_invoice_document_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 next_invoice INTEGER NOT NULL CHECK (next_invoice BETWEEN 1 AND 999999999),
 default_template_id TEXT NOT NULL REFERENCES pt_invoice_templates(id),
 revision TEXT NOT NULL
);
INSERT INTO pt_invoice_document_settings VALUES (1, 1, 'standard', 'initial');
ALTER TABLE pt_contacts ADD COLUMN invoice_template_id TEXT REFERENCES pt_invoice_templates(id);
ALTER TABLE pt_contacts ADD COLUMN invoice_terms_override INTEGER NOT NULL DEFAULT 1 CHECK (invoice_terms_override IN (0, 1));
ALTER TABLE pt_invoices ADD COLUMN document_template_id TEXT REFERENCES pt_invoice_templates(id);
ALTER TABLE pt_invoices ADD COLUMN document_template_revision TEXT;
ALTER TABLE pt_invoices ADD COLUMN document_template TEXT CHECK (document_template IS NULL OR json_valid(document_template));
ALTER TABLE pt_invoices ADD COLUMN document_values TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(document_values));
ALTER TABLE pt_invoices ADD COLUMN issued_document_revision TEXT;
ALTER TABLE pt_invoices ADD COLUMN issued_pdf_sha256 TEXT;
CREATE TABLE pt_invoice_documents (
 invoice_id TEXT PRIMARY KEY REFERENCES pt_invoices(id),
 issued_revision TEXT NOT NULL,
 document TEXT NOT NULL CHECK (json_valid(document)),
 pdf_base64 TEXT,
 sha256 TEXT,
 retained_at TEXT NOT NULL,
 basis TEXT NOT NULL CHECK (basis IN ('issued', 'upgrade', 'import')),
 CHECK ((pdf_base64 IS NULL AND sha256 IS NULL) OR (pdf_base64 IS NOT NULL AND sha256 IS NOT NULL))
);
-- Existing issued invoices get a presentation snapshot during the upgrade.
-- Its PDF is materialized once from this snapshot; it never reads later books.
INSERT INTO pt_invoice_documents (invoice_id, issued_revision, document, retained_at, basis)
 SELECT i.id, i.revision, json_object(
 'business', COALESCE((SELECT legal_name FROM pt_entity WHERE id = 1), 'Pantry'),
 'title', (CASE WHEN i.kind = 'credit' THEN 'Credit ' ELSE 'Invoice ' END) || i.number,
 'facts', json_array(json_array('Billed to', c.name), json_array('Issued', i.issue_date), json_array('Due', i.due_date)),
 'lines', json(COALESCE((SELECT json_group_array(json_object('description', l.description, 'quantity', CAST(l.quantity_milli / 1000.0 AS TEXT), 'amount', printf('$%.2f', l.amount_cents / 100.0))) FROM (SELECT * FROM pt_invoice_lines WHERE invoice_id = i.id ORDER BY line_no) l), '[]')),
 'totals', json_array(json_array('Subtotal', printf('$%.2f', i.subtotal_cents / 100.0)), json_array('Sales tax', printf('$%.2f', i.tax_cents / 100.0)), json_array('Total', printf('$%.2f', i.total_cents / 100.0)), json_array('Amount due', printf('$%.2f', i.total_cents / 100.0))),
 'notes', json_array(i.memo), 'layout', 'classic', 'accentColor', '#433b65', 'textColor', '#202234', 'logo', NULL,
 'templateId', 'standard', 'templateName', 'Services'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), 'upgrade'
 FROM pt_invoices i JOIN pt_contacts c ON c.id = i.customer_id WHERE i.status = 'issued';
UPDATE pt_invoices SET issued_document_revision = revision WHERE status = 'issued';
CREATE TRIGGER pt_invoice_document_immutable BEFORE UPDATE ON pt_invoice_documents
 WHEN OLD.pdf_base64 IS NOT NULL OR NEW.document <> OLD.document OR NEW.issued_revision <> OLD.issued_revision OR NEW.invoice_id <> OLD.invoice_id OR NEW.basis <> OLD.basis OR NEW.retained_at <> OLD.retained_at
 BEGIN SELECT RAISE(ABORT, 'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
CREATE TRIGGER pt_invoice_document_no_delete BEFORE DELETE ON pt_invoice_documents
 WHEN OLD.basis <> 'import'
 BEGIN SELECT RAISE(ABORT, 'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
