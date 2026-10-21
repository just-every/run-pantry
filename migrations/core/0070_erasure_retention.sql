-- Retention enrollment carries opaque record references, never retained values.
CREATE TABLE pt_retention_settings (
 id INTEGER PRIMARY KEY CHECK(id=1), years INTEGER NOT NULL CHECK(years>=1 AND typeof(years)='integer'), revision TEXT NOT NULL
);
INSERT INTO pt_retention_settings VALUES(1,7,'initial');
CREATE TABLE pt_retained_items (
 table_name TEXT NOT NULL CHECK(table_name IN ('pt_documents','pt_invoice_documents','pt_contractor_tax')),
 row_id TEXT NOT NULL, subject_id TEXT NOT NULL,
 erasure_id TEXT NOT NULL REFERENCES pt_erasure_journal(id),
 clock TEXT NOT NULL, expires TEXT NOT NULL, revision TEXT NOT NULL, erased_at TEXT,
 PRIMARY KEY(table_name,row_id)
);
CREATE INDEX pt_retained_ready ON pt_retained_items(erased_at,expires);
ALTER TABLE pt_documents ADD COLUMN erased_at TEXT;
ALTER TABLE pt_invoice_documents ADD COLUMN erased_at TEXT;

-- Empty bytes remain a non-null blob/string, retaining existing byte/hash pairing.
-- The tombstone forbids readers from materializing them again.
DROP TRIGGER pt_invoice_document_immutable;
CREATE TRIGGER pt_invoice_document_immutable BEFORE UPDATE ON pt_invoice_documents
WHEN NOT (
 OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.pdf_base64='' AND NEW.document='{}'
 AND (NEW.sha256 IS OLD.sha256 OR (OLD.sha256 IS NULL AND length(NEW.sha256)=64))
 AND NEW.issued_revision=OLD.issued_revision AND NEW.invoice_id=OLD.invoice_id
 AND NEW.basis=OLD.basis AND NEW.retained_at=OLD.retained_at
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_invoice_documents' AND s.row_id=OLD.invoice_id AND s.operation='expire')
)
AND (OLD.pdf_base64 IS NOT NULL OR NEW.document<>OLD.document OR NEW.issued_revision<>OLD.issued_revision
 OR NEW.invoice_id<>OLD.invoice_id OR NEW.basis<>OLD.basis OR NEW.retained_at<>OLD.retained_at
 OR NEW.erased_at IS NOT OLD.erased_at)
BEGIN SELECT RAISE(ABORT,'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
CREATE TRIGGER pt_document_erasure_scope BEFORE UPDATE OF erased_at ON pt_documents
WHEN NEW.erased_at IS NOT OLD.erased_at AND NOT (
 OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_documents' AND s.row_id=OLD.id AND s.operation='expire')
)
BEGIN SELECT RAISE(ABORT,'PANTRY_DOCUMENT_ERASURE_SCOPE'); END;
CREATE TRIGGER pt_document_erased_immutable BEFORE UPDATE ON pt_documents
WHEN OLD.erased_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'PANTRY_DOCUMENT_ERASED'); END;

-- No table references contractor tax rows. Preserve the contact FK while making
-- actual removal representable: NULL is allowed only after confirmed erasure.
CREATE TABLE pt_contractor_tax_next (
 contact_id TEXT PRIMARY KEY REFERENCES pt_contacts(id), legal_name TEXT NOT NULL,
 tin_kind TEXT NOT NULL CHECK(tin_kind IN ('ssn','ein')),
 tin TEXT CHECK(tin IS NULL OR (length(tin)=9 AND tin NOT GLOB '*[^0-9]*')),
 address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL,
 revision TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, erased_at TEXT,
 CHECK((erased_at IS NULL AND tin IS NOT NULL) OR (erased_at IS NOT NULL AND tin IS NULL))
);
INSERT INTO pt_contractor_tax_next(contact_id,legal_name,tin_kind,tin,address,city,state,zip,revision,updated_by,updated_at)
 SELECT contact_id,legal_name,tin_kind,tin,address,city,state,zip,revision,updated_by,updated_at FROM pt_contractor_tax;
DROP TABLE pt_contractor_tax;
ALTER TABLE pt_contractor_tax_next RENAME TO pt_contractor_tax;
CREATE TRIGGER pt_contractor_tax_erasure_scope BEFORE UPDATE OF erased_at ON pt_contractor_tax
WHEN NEW.erased_at IS NOT OLD.erased_at AND NOT (
 OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_contractor_tax' AND s.row_id=OLD.contact_id AND s.operation='expire')
)
BEGIN SELECT RAISE(ABORT,'PANTRY_TIN_ERASURE_SCOPE'); END;
CREATE TRIGGER pt_contractor_tax_erased_immutable BEFORE UPDATE ON pt_contractor_tax
WHEN OLD.erased_at IS NOT NULL
BEGIN SELECT RAISE(ABORT,'PANTRY_TIN_ERASED'); END;
