-- Explicit owner review is required for every outbound batch.
CREATE TABLE pt_tax_reminder_preferences (id INTEGER PRIMARY KEY CHECK(id=1), enabled INTEGER NOT NULL DEFAULT 0);
INSERT INTO pt_tax_reminder_preferences(id) VALUES(1);
CREATE TABLE pt_tax_vendor_stops (contact_id TEXT PRIMARY KEY REFERENCES pt_contacts(id) ON DELETE CASCADE, at TEXT NOT NULL);
CREATE TABLE pt_tax_reminder_batches (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL, items TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft',
 created_at TEXT NOT NULL, approved_by TEXT, approved_at TEXT, claimed_day TEXT, outcomes TEXT NOT NULL DEFAULT '[]'
);
CREATE TRIGGER pt_tax_batch_immutable BEFORE UPDATE OF kind,items ON pt_tax_reminder_batches
WHEN NOT (NEW.kind=OLD.kind AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id WHERE s.table_name='pt_tax_reminder_batches' AND s.row_id=OLD.id AND s.operation='redact')) BEGIN
 SELECT RAISE(ABORT,'Reviewed tax batch is immutable');
END;
