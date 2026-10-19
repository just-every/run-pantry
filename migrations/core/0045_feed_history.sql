-- Historical provider observations are evidence until they can safely become
-- bank lines. Reference and doubtful rows never enter matching or posting.
ALTER TABLE pt_feed_accounts ADD COLUMN history_mode TEXT NOT NULL DEFAULT 'booksStart' CHECK (history_mode IN ('booksStart', 'lastReconciled', 'explicit'));
ALTER TABLE pt_feed_accounts ADD COLUMN history_start TEXT;
ALTER TABLE pt_feed_accounts ADD COLUMN available_from TEXT;

CREATE TABLE pt_feed_history (
 id TEXT PRIMARY KEY,
 feed_account_id TEXT NOT NULL REFERENCES pt_feed_accounts(id),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 feed_txn_id TEXT NOT NULL UNIQUE,
 posted_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
 description TEXT NOT NULL,
 details TEXT NOT NULL CHECK (json_valid(details)),
 state TEXT NOT NULL CHECK (state IN ('reference', 'doubtful', 'duplicate', 'distinct')),
 reason TEXT NOT NULL,
 candidates TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(candidates)),
 bank_line_id TEXT REFERENCES pt_bank_lines(id),
 removed_at TEXT,
 observed_at TEXT NOT NULL,
 decided_by TEXT,
 decided_at TEXT,
 revision TEXT NOT NULL
);
CREATE INDEX pt_feed_history_account ON pt_feed_history(feed_account_id, state, posted_date);
