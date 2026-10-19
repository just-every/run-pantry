-- One person's first decision about a learned suggestion per bank line.
-- Undoing/re-filing cannot inflate rates or replace the original evidence.
CREATE TABLE pt_line_suggestion_decisions (
 bank_line_id TEXT PRIMARY KEY REFERENCES pt_bank_lines(id),
 source TEXT NOT NULL CHECK (source IN ('history', 'vendor', 'document')),
 source_id TEXT NOT NULL,
 suggested_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 selected_account_ids TEXT NOT NULL CHECK (json_valid(selected_account_ids) AND json_type(selected_account_ids) = 'array'),
 outcome TEXT NOT NULL CHECK (outcome IN ('accepted', 'changed')),
 suggestion TEXT NOT NULL CHECK (json_valid(suggestion)),
 actor_email TEXT NOT NULL,
 decided_at TEXT NOT NULL,
 audit_id TEXT NOT NULL UNIQUE REFERENCES pt_audit(id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX pt_line_suggestion_source ON pt_line_suggestion_decisions(source, outcome);
CREATE TRIGGER pt_line_suggestion_no_update BEFORE UPDATE ON pt_line_suggestion_decisions
BEGIN SELECT RAISE(ABORT, 'Suggestion decisions are immutable'); END;
CREATE TRIGGER pt_line_suggestion_no_delete BEFORE DELETE ON pt_line_suggestion_decisions
BEGIN SELECT RAISE(ABORT, 'Suggestion decisions are immutable'); END;
