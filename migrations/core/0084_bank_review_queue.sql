-- Native queue decisions stay with their source line and the audit trail.
ALTER TABLE pt_bank_lines ADD COLUMN excluded_at TEXT;
ALTER TABLE pt_bank_lines ADD COLUMN excluded_reason TEXT;
ALTER TABLE pt_bank_lines ADD COLUMN excluded_kind TEXT;
ALTER TABLE pt_bank_lines ADD COLUMN excluded_by TEXT;
ALTER TABLE pt_bank_lines ADD COLUMN exclusion_revision TEXT;
ALTER TABLE pt_journal_lines ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_journal_lines ADD COLUMN location_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_journal_lines ADD COLUMN project_name TEXT NOT NULL DEFAULT '';
-- Undo reverses only the entries this match actually created, never existing postings.
CREATE TABLE pt_match_created_entries (
 match_id TEXT NOT NULL REFERENCES pt_matches(id), entry_id TEXT NOT NULL UNIQUE REFERENCES pt_journal_entries(id),
 payment_id TEXT REFERENCES pt_payments(id), PRIMARY KEY(match_id,entry_id)
);
