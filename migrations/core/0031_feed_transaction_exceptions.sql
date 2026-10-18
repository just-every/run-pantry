-- Remember the provider's last observation separately from the line kept for
-- the books. Imported statement descriptions can differ from feed descriptions.
ALTER TABLE pt_bank_lines ADD COLUMN feed_snapshot TEXT CHECK (feed_snapshot IS NULL OR json_valid(feed_snapshot));
ALTER TABLE pt_bank_lines ADD COLUMN feed_account_id TEXT REFERENCES pt_feed_accounts(id);
UPDATE pt_bank_lines SET feed_account_id = (SELECT f.id FROM pt_feed_accounts f WHERE f.bank_account_id = pt_bank_lines.bank_account_id)
 WHERE feed_txn_id IS NOT NULL;

CREATE TABLE pt_feed_transaction_exceptions (
 id TEXT PRIMARY KEY,
 feed_account_id TEXT NOT NULL REFERENCES pt_feed_accounts(id),
 bank_line_id TEXT NOT NULL REFERENCES pt_bank_lines(id),
 feed_txn_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('modified', 'removed')),
 protection TEXT NOT NULL CHECK (protection IN ('categorised', 'matched', 'reconciled')),
 preserved_line TEXT NOT NULL CHECK (json_valid(preserved_line)),
 provider_change TEXT NOT NULL CHECK (json_valid(provider_change)),
 detected_at TEXT NOT NULL,
 UNIQUE (bank_line_id, kind, provider_change)
);
CREATE INDEX pt_feed_transaction_exceptions_account ON pt_feed_transaction_exceptions(feed_account_id, detected_at);
