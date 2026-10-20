ALTER TABLE pt_feed_accounts ADD COLUMN balance_as_of TEXT;
ALTER TABLE pt_feed_accounts ADD COLUMN balance_observed_at TEXT;
ALTER TABLE pt_statements ADD COLUMN source_kind TEXT NOT NULL DEFAULT 'file';
ALTER TABLE pt_statements ADD COLUMN provider_statement_id TEXT;
