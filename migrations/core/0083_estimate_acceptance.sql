-- Accepted copies supplement rather than replace the exact sent bytes.
ALTER TABLE pt_estimate_documents ADD COLUMN accepted_document TEXT;
ALTER TABLE pt_estimate_documents ADD COLUMN accepted_pdf_base64 TEXT;
ALTER TABLE pt_estimate_documents ADD COLUMN accepted_sha256 TEXT;
ALTER TABLE pt_estimate_documents ADD COLUMN accepted_at TEXT;
ALTER TABLE pt_estimate_deliveries ADD COLUMN kind TEXT NOT NULL DEFAULT 'estimate';
CREATE UNIQUE INDEX pt_estimate_confirmation_once ON pt_estimate_deliveries(estimate_id,revision,recipient) WHERE kind='acceptance';
DROP TRIGGER pt_estimate_document_immutable;
CREATE TRIGGER pt_estimate_document_immutable BEFORE UPDATE ON pt_estimate_documents
WHEN NOT (
 NEW.estimate_id=OLD.estimate_id AND NEW.revision=OLD.revision AND NEW.sha256=OLD.sha256 AND NEW.retained_at=OLD.retained_at
 AND OLD.erased_at IS NULL AND (
  (NEW.erased_at IS NULL AND NEW.document=OLD.document AND NEW.pdf_base64=OLD.pdf_base64
   AND OLD.accepted_sha256 IS NULL AND NEW.accepted_sha256 IS NOT NULL
   AND NEW.accepted_document IS NOT NULL AND NEW.accepted_pdf_base64 IS NOT NULL
   AND EXISTS(SELECT 1 FROM pt_estimates e WHERE e.id=OLD.estimate_id AND e.revision=OLD.revision
    AND e.status='accepted' AND e.accepted_revision=OLD.revision AND e.accepted_at=NEW.accepted_at))
  OR (NEW.erased_at IS NOT NULL AND NEW.pdf_base64='' AND NEW.document='{}'
   AND NEW.accepted_pdf_base64 IS '' AND NEW.accepted_document IS '{}'
   AND NEW.accepted_sha256 IS OLD.accepted_sha256 AND NEW.accepted_at IS OLD.accepted_at
   AND EXISTS(SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
    WHERE s.table_name='pt_estimate_documents' AND s.row_id=OLD.estimate_id||':'||OLD.revision AND s.operation='expire'))
 ))
BEGIN SELECT RAISE(ABORT,'PANTRY_ISSUED_DOCUMENT_IMMUTABLE'); END;
