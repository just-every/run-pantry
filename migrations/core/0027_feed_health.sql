-- Feed incidents retain the owner's notification outcome after recovery.
ALTER TABLE pt_feed_items ADD COLUMN consent_expires_at TEXT;
CREATE TABLE pt_feed_alerts (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES pt_feed_items(id),
 health_key TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('broken', 'stale', 'expiring')),
 message TEXT NOT NULL,
 detected_at TEXT NOT NULL,
 resolved_at TEXT,
 email_status TEXT NOT NULL DEFAULT 'pending' CHECK (email_status IN ('pending', 'sending', 'sent', 'local', 'no-mail', 'failed', 'uncertain')),
 emailed_at TEXT,
 email_detail TEXT NOT NULL DEFAULT '',
 next_attempt_at TEXT NOT NULL,
 claim_id TEXT,
 claim_until TEXT
);
CREATE UNIQUE INDEX pt_feed_alerts_open ON pt_feed_alerts(item_id) WHERE resolved_at IS NULL;
