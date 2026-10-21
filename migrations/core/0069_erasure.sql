-- Erasure receipts contain opaque identities, counts and retained references only.
CREATE TABLE pt_erasure_journal (id TEXT PRIMARY KEY, subject_digest TEXT NOT NULL, at TEXT NOT NULL, receipt TEXT NOT NULL CHECK(json_valid(receipt)));
CREATE TABLE pt_erasure_scope (erasure_id TEXT NOT NULL REFERENCES pt_erasure_journal(id), table_name TEXT NOT NULL, row_id TEXT NOT NULL, operation TEXT NOT NULL CHECK(operation IN ('redact','expire')), PRIMARY KEY(table_name,row_id));
ALTER TABLE pt_contacts ADD COLUMN erased_at TEXT;
DROP TRIGGER pt_audit_no_update;
CREATE TRIGGER pt_audit_no_update BEFORE UPDATE ON pt_audit
 WHEN NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id WHERE s.table_name='pt_audit' AND s.row_id=OLD.id AND s.operation='redact')
 OR NEW.id<>OLD.id OR NEW.at<>OLD.at OR NEW.actor_kind<>OLD.actor_kind OR NEW.action<>OLD.action OR NEW.subject_kind<>OLD.subject_kind
 OR NEW.subject_revision IS NOT OLD.subject_revision OR NEW.approval_id IS NOT OLD.approval_id OR NEW.origin_kind IS NOT OLD.origin_kind
 OR NEW.authority_kind IS NOT OLD.authority_kind OR NEW.authority_id IS NOT OLD.authority_id OR NEW.authority_revision IS NOT OLD.authority_revision
 BEGIN SELECT RAISE(ABORT,'PANTRY_AUDIT_IMMUTABLE'); END;
DROP TRIGGER pt_approval_no_update;
CREATE TRIGGER pt_approval_no_update BEFORE UPDATE ON pt_approvals
 WHEN NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id WHERE s.table_name='pt_approvals' AND s.row_id=OLD.id AND s.operation='redact')
 OR NEW.id<>OLD.id OR NEW.at<>OLD.at OR NEW.subject_kind<>OLD.subject_kind OR NEW.subject_revision<>OLD.subject_revision
 OR NEW.action<>OLD.action OR NEW.decision<>OLD.decision
 BEGIN SELECT RAISE(ABORT,'PANTRY_AUDIT_IMMUTABLE'); END;
