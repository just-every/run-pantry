-- Existing digits are sealed by the bounded Worker upgrade before serving data.
-- New writes accept envelopes only; erased identity and its metadata remain absent.
CREATE TABLE pt_contractor_tax_next (
 contact_id TEXT PRIMARY KEY REFERENCES pt_contacts(id), legal_name TEXT NOT NULL,
 tin_kind TEXT NOT NULL CHECK(tin_kind IN ('ssn','ein')),
 tin TEXT CHECK(tin IS NULL OR tin LIKE 'v1.%' OR (length(tin)=9 AND tin NOT GLOB '*[^0-9]*')),
 tin_last4 TEXT CHECK(tin_last4 IS NULL OR (length(tin_last4)=4 AND tin_last4 NOT GLOB '*[^0-9]*')),
 tin_hash TEXT,
 address TEXT NOT NULL, city TEXT NOT NULL, state TEXT NOT NULL, zip TEXT NOT NULL,
 revision TEXT NOT NULL, updated_by TEXT NOT NULL, updated_at TEXT NOT NULL, erased_at TEXT,
 backup_withholding INTEGER NOT NULL DEFAULT 0 CHECK(backup_withholding IN (0,1)),
 CHECK((erased_at IS NULL AND tin IS NOT NULL) OR (erased_at IS NOT NULL AND tin IS NULL AND tin_last4 IS NULL AND tin_hash IS NULL))
);
INSERT INTO pt_contractor_tax_next(contact_id,legal_name,tin_kind,tin,tin_last4,address,city,state,zip,revision,updated_by,updated_at,erased_at,backup_withholding)
 SELECT contact_id,legal_name,tin_kind,tin,CASE WHEN tin IS NULL THEN NULL ELSE substr(tin,-4) END,address,city,state,zip,revision,updated_by,updated_at,erased_at,backup_withholding FROM pt_contractor_tax;
DROP TABLE pt_contractor_tax;
ALTER TABLE pt_contractor_tax_next RENAME TO pt_contractor_tax;
CREATE TRIGGER pt_contractor_tax_sealed_insert BEFORE INSERT ON pt_contractor_tax
WHEN NEW.tin IS NOT NULL AND (NEW.tin NOT LIKE 'v1.%' OR NEW.tin_last4 IS NULL OR NEW.tin_hash IS NULL)
BEGIN SELECT RAISE(ABORT,'PANTRY_TIN_ENCRYPTION_REQUIRED'); END;
CREATE TRIGGER pt_contractor_tax_sealed_update BEFORE UPDATE OF tin ON pt_contractor_tax
WHEN NEW.tin IS NOT NULL AND (NEW.tin NOT LIKE 'v1.%' OR NEW.tin_last4 IS NULL OR NEW.tin_hash IS NULL)
BEGIN SELECT RAISE(ABORT,'PANTRY_TIN_ENCRYPTION_REQUIRED'); END;
CREATE TRIGGER pt_contractor_tax_erasure_scope BEFORE UPDATE OF erased_at ON pt_contractor_tax
WHEN NEW.erased_at IS NOT OLD.erased_at AND NOT (
 OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_contractor_tax' AND s.row_id=OLD.contact_id AND s.operation='expire')
)
BEGIN SELECT RAISE(ABORT,'PANTRY_TIN_ERASURE_SCOPE'); END;
CREATE TRIGGER pt_contractor_tax_erased_immutable BEFORE UPDATE ON pt_contractor_tax
WHEN OLD.erased_at IS NOT NULL AND (NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id WHERE s.table_name='pt_contractor_tax' AND s.row_id=OLD.contact_id AND s.operation='redact') OR NEW."contact_id" IS NOT OLD."contact_id" OR NEW."legal_name" IS NOT OLD."legal_name" OR NEW."tin_kind" IS NOT OLD."tin_kind" OR NEW."tin" IS NOT OLD."tin" OR NEW."tin_last4" IS NOT OLD."tin_last4" OR NEW."tin_hash" IS NOT OLD."tin_hash" OR NEW."address" IS NOT OLD."address" OR NEW."city" IS NOT OLD."city" OR NEW."state" IS NOT OLD."state" OR NEW."zip" IS NOT OLD."zip" OR NEW."revision" IS NOT OLD."revision" OR NEW."updated_at" IS NOT OLD."updated_at" OR NEW."erased_at" IS NOT OLD."erased_at")
BEGIN SELECT RAISE(ABORT,'PANTRY_ERASED_IMMUTABLE'); END;
