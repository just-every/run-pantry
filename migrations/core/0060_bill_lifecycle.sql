ALTER TABLE pt_bills ADD COLUMN submitted_revision TEXT;
ALTER TABLE pt_bills ADD COLUMN scheduled_date TEXT;
ALTER TABLE pt_bills ADD COLUMN scheduled_note TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_capture_drafts ADD COLUMN submitted_revision TEXT;

CREATE TABLE pt_recurring_bills (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, vendor_id TEXT NOT NULL REFERENCES pt_contacts(id),
 lines TEXT NOT NULL, memo TEXT NOT NULL, terms_days INTEGER NOT NULL,
 start_date TEXT NOT NULL, end_date TEXT, every INTEGER NOT NULL, unit TEXT NOT NULL,
 next_date TEXT, runs INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL,
 prepared_by TEXT NOT NULL, revision TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE pt_recurring_bill_runs (
 recurring_id TEXT NOT NULL REFERENCES pt_recurring_bills(id), occurrence TEXT NOT NULL,
 template_revision TEXT NOT NULL, bill_id TEXT REFERENCES pt_bills(id),
 status TEXT NOT NULL, detail TEXT NOT NULL, at TEXT NOT NULL,
 PRIMARY KEY (recurring_id, occurrence)
);
