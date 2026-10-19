ALTER TABLE pt_bills ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_bills ADD COLUMN approved_by TEXT;
ALTER TABLE pt_bills ADD COLUMN approved_revision TEXT;
ALTER TABLE pt_bills ADD COLUMN updated_at TEXT;
UPDATE pt_bills SET updated_at = created_at;
CREATE TABLE pt_bill_approval_reminders (
 bill_id TEXT NOT NULL REFERENCES pt_bills(id),
 revision TEXT NOT NULL,
 reminded_at TEXT NOT NULL,
 recipient TEXT NOT NULL,
 email_status TEXT NOT NULL,
 email_detail TEXT NOT NULL,
 PRIMARY KEY (bill_id, revision)
);
