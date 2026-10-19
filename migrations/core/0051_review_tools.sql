-- Accountant review tools (ACCT-003). A reclassified line is moved once by a
-- linked correcting entry; the original stays as posted. Notes and review
-- marks are append-only history.
CREATE TABLE pt_reclassifications (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL,
 original_entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 original_line_id TEXT NOT NULL UNIQUE REFERENCES pt_journal_lines(id),
 correcting_entry_id TEXT NOT NULL UNIQUE REFERENCES pt_journal_entries(id),
 from_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 to_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX pt_reclassifications_batch ON pt_reclassifications(batch_id);

CREATE TABLE pt_review_notes (
 id TEXT PRIMARY KEY,
 entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 note TEXT NOT NULL,
 author TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX pt_review_notes_entry ON pt_review_notes(entry_id, created_at);

CREATE TABLE pt_review_marks (
 id TEXT PRIMARY KEY,
 reviewer TEXT NOT NULL,
 reviewed_at TEXT NOT NULL
);
CREATE INDEX pt_review_marks_reviewer ON pt_review_marks(reviewer, reviewed_at);

-- Write-off credits are marked: they settle a bad debt and are not sales
-- returns, so sales-tax and nexus figures leave them out.
ALTER TABLE pt_invoices ADD COLUMN write_off INTEGER NOT NULL DEFAULT 0 CHECK (write_off IN (0, 1));
ALTER TABLE pt_vendor_credits ADD COLUMN write_off INTEGER NOT NULL DEFAULT 0 CHECK (write_off IN (0, 1));

-- The owner's per-item write-off limit; Pantry uses $100 until the owner sets one.
CREATE TABLE pt_write_off_policy (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 limit_cents INTEGER NOT NULL CHECK (limit_cents > 0),
 set_by TEXT NOT NULL,
 set_at TEXT NOT NULL
);
