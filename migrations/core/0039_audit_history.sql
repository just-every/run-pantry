-- Existing history remains unchanged; new events resolve the record's exact
-- revision and the approval/standing authority used by the write.
ALTER TABLE pt_audit ADD COLUMN subject_revision TEXT;
ALTER TABLE pt_audit ADD COLUMN approval_id TEXT;
ALTER TABLE pt_audit ADD COLUMN origin_kind TEXT;
ALTER TABLE pt_audit ADD COLUMN authority_kind TEXT;
ALTER TABLE pt_audit ADD COLUMN authority_id TEXT;
ALTER TABLE pt_audit ADD COLUMN authority_revision TEXT;
CREATE INDEX pt_audit_actor_record ON pt_audit(actor_email, subject_kind, subject_id, at);
CREATE TRIGGER pt_audit_no_update BEFORE UPDATE ON pt_audit BEGIN SELECT RAISE(ABORT, 'PANTRY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER pt_audit_no_delete BEFORE DELETE ON pt_audit BEGIN SELECT RAISE(ABORT, 'PANTRY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER pt_approval_no_update BEFORE UPDATE ON pt_approvals BEGIN SELECT RAISE(ABORT, 'PANTRY_AUDIT_IMMUTABLE'); END;
CREATE TRIGGER pt_approval_no_delete BEFORE DELETE ON pt_approvals BEGIN SELECT RAISE(ABORT, 'PANTRY_AUDIT_IMMUTABLE'); END;

-- Transaction-local snapshots are inserted and removed in the same D1 batch.
CREATE TABLE pt_audit_before (event_id TEXT PRIMARY KEY, state TEXT);

-- Current history revision for records without their own version column.
CREATE TABLE pt_record_revisions (subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, revision TEXT NOT NULL, PRIMARY KEY (subject_kind, subject_id));
