-- Recommendations retain their evidence and back-test; approval only permits
-- preparing CLOSE-002 plans. It never grants permission to post those plans.
CREATE TABLE pt_learned_recognition(
 id TEXT PRIMARY KEY,vendor_id TEXT NOT NULL REFERENCES pt_contacts(id),balance_account_id TEXT NOT NULL REFERENCES pt_accounts(id),months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 12),
 evidence TEXT NOT NULL CHECK(json_valid(evidence)),backtest TEXT NOT NULL DEFAULT '{}' CHECK(json_valid(backtest)),
 status TEXT NOT NULL CHECK(status IN('proposed','approved','revoked')),max_cents INTEGER,recognition_account_id TEXT REFERENCES pt_accounts(id),
 approved_by TEXT,approved_revision TEXT,created_at TEXT NOT NULL,revision TEXT NOT NULL,UNIQUE(vendor_id,balance_account_id,months)
);
CREATE TABLE pt_learned_applications(proposal_id TEXT NOT NULL REFERENCES pt_learned_recognition(id),schedule_id TEXT NOT NULL UNIQUE REFERENCES pt_recognition_schedules(id),source_journal_id TEXT NOT NULL REFERENCES pt_journal_entries(id),applied_by TEXT NOT NULL,applied_at TEXT NOT NULL,PRIMARY KEY(proposal_id,source_journal_id));
