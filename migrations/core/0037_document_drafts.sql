ALTER TABLE pt_receipts ADD COLUMN read_draft_fields TEXT;
CREATE TABLE pt_capture_drafts (
 id TEXT PRIMARY KEY,
 receipt_id TEXT NOT NULL UNIQUE REFERENCES pt_receipts(id),
 kind TEXT NOT NULL CHECK (kind IN ('bill', 'expense')),
 bill_id TEXT REFERENCES pt_bills(id),
 bank_line_id TEXT REFERENCES pt_bank_lines(id),
 payload TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'posted')),
 revision TEXT NOT NULL,
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 created_at TEXT NOT NULL
);
CREATE TABLE pt_capture_approval_rules (
 id TEXT PRIMARY KEY,
 minimum_cents INTEGER NOT NULL DEFAULT 0,
 vendor_id TEXT REFERENCES pt_contacts(id),
 account_id TEXT REFERENCES pt_accounts(id),
 class_name TEXT NOT NULL DEFAULT '',
 revision TEXT NOT NULL
);
