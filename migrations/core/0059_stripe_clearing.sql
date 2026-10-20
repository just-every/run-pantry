-- Keep prior payout recognition immutable. Only new rows use clearing transfers.
ALTER TABLE pt_stripe_payouts ADD COLUMN clearing_mode TEXT NOT NULL DEFAULT 'legacy' CHECK (clearing_mode IN ('legacy', 'clearing'));
CREATE TABLE pt_stripe_clearing_snapshot (
 account_id TEXT PRIMARY KEY,
 observed_at TEXT NOT NULL,
 provider_cents INTEGER,
 complete INTEGER NOT NULL CHECK (complete IN (0, 1)),
 reason TEXT NOT NULL DEFAULT '',
 scan_id TEXT NOT NULL,
 ledger_account_id TEXT REFERENCES pt_accounts(id),
 account_name TEXT NOT NULL
);
-- A minimal provider inventory, including items whose ledger posting is held.
-- No provider payload, customer metadata or payment credentials are retained.
CREATE TABLE pt_stripe_clearing_items (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 type TEXT NOT NULL,
 event_date TEXT,
 currency TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 net_cents INTEGER NOT NULL,
 fee_cents INTEGER NOT NULL,
 payment_intent TEXT,
 source_id TEXT,
 payout_id TEXT,
 status TEXT NOT NULL CHECK (status IN ('observed', 'posted', 'adopted', 'legacy-covered', 'held')),
 reason TEXT NOT NULL DEFAULT '',
 entry_id TEXT REFERENCES pt_journal_entries(id),
 fee_entry_id TEXT REFERENCES pt_journal_entries(id),
 seen_scan TEXT NOT NULL
);
CREATE INDEX pt_stripe_clearing_account ON pt_stripe_clearing_items(account_id, event_date);
