-- Bank rules and live bank and card feeds.
-- Statement lines now also arrive from a feed, so a line no longer needs a
-- statement; a feed line carries the provider's transaction id, and a file line
-- the feed recognised carries it too, so neither source duplicates the other.
PRAGMA defer_foreign_keys = on;

-- Matched lines are set aside while pt_bank_lines is rebuilt and put back after:
-- D1 always enforces foreign keys, and dropping the old table with matches still
-- pointing at it fails the commit even though the same ids return under the new one.
CREATE TABLE pt_match_bank_lines_keep AS SELECT match_id, bank_line_id, active FROM pt_match_bank_lines;
DELETE FROM pt_match_bank_lines;

CREATE TABLE pt_bank_lines_next (
 id TEXT PRIMARY KEY,
 statement_id TEXT REFERENCES pt_statements(id),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 posted_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
 description TEXT NOT NULL,
 reference TEXT NOT NULL DEFAULT '',
 fingerprint TEXT NOT NULL,
 source TEXT NOT NULL DEFAULT 'file' CHECK (source IN ('file', 'feed')),
 payee TEXT NOT NULL DEFAULT '',
 feed_txn_id TEXT,
 removed_at TEXT,
 rules_off INTEGER NOT NULL DEFAULT 0 CHECK (rules_off IN (0, 1)),
 arrived_at TEXT,
 CHECK (statement_id IS NOT NULL OR source = 'feed'),
 UNIQUE (bank_account_id, fingerprint)
);
INSERT INTO pt_bank_lines_next (id, statement_id, bank_account_id, posted_date, amount_cents, description, reference, fingerprint)
 SELECT id, statement_id, bank_account_id, posted_date, amount_cents, description, reference, fingerprint FROM pt_bank_lines;
DROP TABLE pt_bank_lines;
ALTER TABLE pt_bank_lines_next RENAME TO pt_bank_lines;
CREATE INDEX pt_bank_lines_date ON pt_bank_lines(bank_account_id, posted_date);
CREATE UNIQUE INDEX pt_bank_lines_feed_once ON pt_bank_lines(feed_txn_id) WHERE feed_txn_id IS NOT NULL;
INSERT INTO pt_match_bank_lines (match_id, bank_line_id, active) SELECT match_id, bank_line_id, active FROM pt_match_bank_lines_keep;
DROP TABLE pt_match_bank_lines_keep;

-- A rule files matching lines: conditions on payee, description and amount;
-- splits across categories (basis points summing to 10000), an optional
-- contact, tax code and memo.
CREATE TABLE pt_bank_rules (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 position INTEGER NOT NULL,
 bank_account_id TEXT REFERENCES pt_bank_accounts(id),
 direction TEXT NOT NULL CHECK (direction IN ('out', 'in', 'any')),
 payee TEXT NOT NULL DEFAULT '',
 description_contains TEXT NOT NULL DEFAULT '',
 amount_min_cents INTEGER CHECK (amount_min_cents IS NULL OR amount_min_cents > 0),
 amount_max_cents INTEGER CHECK (amount_max_cents IS NULL OR amount_max_cents > 0),
 splits TEXT NOT NULL CHECK (json_valid(splits)),
 contact_id TEXT REFERENCES pt_contacts(id),
 tax_code_id TEXT REFERENCES pt_tax_codes(id),
 memo TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revision TEXT NOT NULL
);

-- A match a rule made names it; undoing it reverses its entry and keeps the line out of rules.
ALTER TABLE pt_matches ADD COLUMN rule_id TEXT REFERENCES pt_bank_rules(id);

-- One login at one institution through a feed provider (a Plaid Item).
CREATE TABLE pt_feed_items (
 id TEXT PRIMARY KEY,
 provider TEXT NOT NULL CHECK (provider IN ('plaid')),
 item_id TEXT NOT NULL UNIQUE,
 institution_id TEXT NOT NULL DEFAULT '',
 institution_name TEXT NOT NULL,
 access_token TEXT NOT NULL,
 cursor TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK (status IN ('active', 'relink', 'disconnected')),
 error_code TEXT NOT NULL DEFAULT '',
 error_message TEXT NOT NULL DEFAULT '',
 sync_due_at TEXT NOT NULL,
 claim_id TEXT,
 claim_until TEXT,
 last_sync_at TEXT,
 last_sync_error TEXT NOT NULL DEFAULT '',
 connected_by TEXT NOT NULL,
 connected_at TEXT NOT NULL,
 revision TEXT NOT NULL
);

-- The provider's accounts under an item, each brought into one Pantry bank account or left out.
CREATE TABLE pt_feed_accounts (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES pt_feed_items(id),
 provider_account_id TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 mask TEXT NOT NULL DEFAULT '',
 kind TEXT NOT NULL DEFAULT '',
 bank_account_id TEXT REFERENCES pt_bank_accounts(id),
 balance_cents INTEGER,
 last_synced_at TEXT,
 revision TEXT NOT NULL
);
CREATE UNIQUE INDEX pt_feed_accounts_bank_once ON pt_feed_accounts(bank_account_id) WHERE bank_account_id IS NOT NULL;

-- Pending card and bank transactions: shown, never filed, replaced when the bank posts them.
CREATE TABLE pt_feed_pending (
 feed_txn_id TEXT PRIMARY KEY,
 feed_account_id TEXT NOT NULL REFERENCES pt_feed_accounts(id),
 txn_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 description TEXT NOT NULL,
 payee TEXT NOT NULL DEFAULT '',
 seen_at TEXT NOT NULL
);

CREATE TABLE pt_feed_syncs (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES pt_feed_items(id),
 trigger TEXT NOT NULL CHECK (trigger IN ('connect', 'webhook', 'schedule', 'person')),
 started_at TEXT NOT NULL,
 finished_at TEXT,
 added INTEGER NOT NULL DEFAULT 0,
 updated INTEGER NOT NULL DEFAULT 0,
 removed INTEGER NOT NULL DEFAULT 0,
 pending INTEGER NOT NULL DEFAULT 0,
 filed INTEGER NOT NULL DEFAULT 0,
 error_code TEXT NOT NULL DEFAULT ''
);
CREATE INDEX pt_feed_syncs_item ON pt_feed_syncs(item_id, started_at);
