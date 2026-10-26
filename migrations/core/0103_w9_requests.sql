-- Request tokens never travel with restored books. Evidence inherits tax retention.
ALTER TABLE pt_contractor_tax ADD COLUMN w9_evidence_sealed TEXT;
ALTER TABLE pt_contractor_tax ADD COLUMN w9_evidence_history TEXT NOT NULL DEFAULT '[]';
ALTER TABLE pt_contractor_tax ADD COLUMN w9_completed_at TEXT;
CREATE TABLE pt_w9_requests (
 id TEXT PRIMARY KEY, contact_id TEXT NOT NULL REFERENCES pt_contacts(id) ON DELETE CASCADE,
 token_hash TEXT UNIQUE, tax_revision TEXT, contact_revision TEXT NOT NULL,
 expires_at TEXT NOT NULL, created_at TEXT NOT NULL, completed_at TEXT, revoked_at TEXT
);
CREATE INDEX pt_w9_vendor ON pt_w9_requests(contact_id);
CREATE TRIGGER pt_w9_erased AFTER UPDATE OF erased_at ON pt_contacts WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE pt_w9_requests SET token_hash=NULL,revoked_at=NEW.erased_at WHERE contact_id=NEW.id;
END;
CREATE TRIGGER pt_w9_tax_erased AFTER UPDATE OF erased_at ON pt_contractor_tax WHEN NEW.erased_at IS NOT NULL BEGIN
 UPDATE pt_contractor_tax SET w9_evidence_sealed=NULL,w9_evidence_history='[]',w9_completed_at=NULL WHERE contact_id=NEW.contact_id;
END;
CREATE TABLE pt_tax_deadlines (
 id TEXT PRIMARY KEY, label TEXT NOT NULL, due_date TEXT NOT NULL, amount_cents INTEGER,
 completed_at TEXT, revision TEXT NOT NULL, set_by TEXT NOT NULL
);
