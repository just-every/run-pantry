-- Recurring journals retain their approved version and one durable occurrence
-- key. The journal, run claim and schedule advance commit in the same batch.
CREATE TABLE pt_recurring_journals (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 memo TEXT NOT NULL,
 lines TEXT NOT NULL CHECK (json_valid(lines)),
 every INTEGER NOT NULL CHECK (every BETWEEN 1 AND 12),
 start_date TEXT NOT NULL,
 end_date TEXT,
 runs INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
 next_date TEXT,
 mode TEXT NOT NULL CHECK (mode IN ('draft', 'post')),
 status TEXT NOT NULL CHECK (status IN ('active', 'awaiting-approval', 'paused', 'ended')),
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 approved_snapshot TEXT CHECK (approved_snapshot IS NULL OR json_valid(approved_snapshot)),
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE TABLE pt_recurring_journal_runs (
 recurring_id TEXT NOT NULL REFERENCES pt_recurring_journals(id),
 occurrence TEXT NOT NULL,
 template_revision TEXT NOT NULL,
 template_snapshot TEXT NOT NULL CHECK (json_valid(template_snapshot)),
 journal_id TEXT UNIQUE REFERENCES pt_journal_entries(id) ON DELETE SET NULL,
 status TEXT NOT NULL CHECK (status IN ('drafted', 'posted', 'blocked', 'failed')),
 detail TEXT NOT NULL,
 late INTEGER NOT NULL CHECK (late IN (0, 1)),
 at TEXT NOT NULL,
 PRIMARY KEY (recurring_id, occurrence)
);
CREATE INDEX pt_recurring_journals_due ON pt_recurring_journals(status, next_date);
