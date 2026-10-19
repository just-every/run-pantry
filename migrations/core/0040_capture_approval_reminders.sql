ALTER TABLE pt_capture_drafts ADD COLUMN updated_at TEXT NOT NULL DEFAULT '';
UPDATE pt_capture_drafts SET updated_at = created_at WHERE updated_at = '';

CREATE INDEX pt_capture_drafts_pending_updated ON pt_capture_drafts(status, updated_at);

CREATE TABLE pt_capture_approval_reminders (
 draft_id TEXT NOT NULL REFERENCES pt_capture_drafts(id),
 revision TEXT NOT NULL,
 reminded_at TEXT NOT NULL,
 recipient TEXT NOT NULL,
 email_status TEXT NOT NULL,
 email_detail TEXT NOT NULL,
 PRIMARY KEY (draft_id, revision)
);
