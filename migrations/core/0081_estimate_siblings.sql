-- Owner-reviewed immutable source records. Credentials are transient, never rows.
CREATE TABLE pt_estimate_sibling_previews (
 id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), estimate_revision TEXT NOT NULL,
 revision TEXT NOT NULL, owner_id TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('inkwell','platter')),
 origin TEXT NOT NULL, remote_id TEXT NOT NULL, remote_revision TEXT NOT NULL,
 summary TEXT NOT NULL, proof TEXT NOT NULL, proof_sha256 TEXT NOT NULL,
 pdf_base64 TEXT, pdf_sha256 TEXT, created_at TEXT NOT NULL, expires_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','attached')), link_id TEXT, erased_at TEXT
);
CREATE TABLE pt_estimate_sibling_links (
 id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), estimate_revision TEXT NOT NULL,
 revision TEXT NOT NULL, provider TEXT NOT NULL CHECK(provider IN ('inkwell','platter')),
 origin TEXT NOT NULL, remote_id TEXT NOT NULL, remote_revision TEXT NOT NULL,
 summary TEXT NOT NULL, proof TEXT NOT NULL, proof_sha256 TEXT NOT NULL,
 pdf_base64 TEXT, pdf_sha256 TEXT, attached_at TEXT NOT NULL, attached_by TEXT NOT NULL, erased_at TEXT,
 UNIQUE(provider,origin,remote_id,remote_revision)
);
CREATE TABLE pt_estimate_sibling_attempts (
 id TEXT PRIMARY KEY, estimate_id TEXT NOT NULL REFERENCES pt_estimates(id), estimate_revision TEXT NOT NULL,
 provider TEXT NOT NULL CHECK(provider IN ('inkwell','platter')), origin TEXT NOT NULL, remote_id TEXT NOT NULL,
 error_class TEXT NOT NULL, at TEXT NOT NULL
);
CREATE INDEX pt_estimate_sibling_previews_estimate ON pt_estimate_sibling_previews(estimate_id,created_at);
CREATE INDEX pt_estimate_sibling_links_estimate ON pt_estimate_sibling_links(estimate_id,attached_at);
CREATE INDEX pt_estimate_sibling_attempts_estimate ON pt_estimate_sibling_attempts(estimate_id,at);
CREATE TRIGGER pt_estimate_sibling_proof_immutable BEFORE UPDATE ON pt_estimate_sibling_links
WHEN NOT(NEW.proof_sha256=OLD.proof_sha256 AND NEW.pdf_sha256 IS OLD.pdf_sha256
 AND NEW.id=OLD.id AND NEW.estimate_id=OLD.estimate_id AND NEW.estimate_revision=OLD.estimate_revision
 AND NEW.revision=OLD.revision AND NEW.provider=OLD.provider AND NEW.origin=OLD.origin AND NEW.remote_id=OLD.remote_id AND NEW.remote_revision=OLD.remote_revision
 AND NEW.attached_at=OLD.attached_at
 AND json_extract(NEW.summary,'$.total_cents') IS json_extract(OLD.summary,'$.total_cents')
 AND json_extract(NEW.summary,'$.deposit_cents') IS json_extract(OLD.summary,'$.deposit_cents')
 AND json_extract(NEW.summary,'$.currency') IS json_extract(OLD.summary,'$.currency')
 AND ((NEW.proof=OLD.proof AND NEW.pdf_base64 IS OLD.pdf_base64 AND NEW.erased_at IS OLD.erased_at)
 OR (OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL AND NEW.proof='{}' AND NEW.pdf_base64 IS NULL AND NEW.attached_by=OLD.attached_by
 AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
 WHERE s.table_name='pt_estimate_sibling_links' AND s.row_id=OLD.id AND s.operation='expire'))))
BEGIN SELECT RAISE(ABORT,'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
