-- Consent travels disabled. Secrets and delivery state never travel.
CREATE TABLE pt_webhook_subscriptions (
 id TEXT PRIMARY KEY, destination TEXT, host TEXT NOT NULL, events TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK(enabled IN (0,1)), revision TEXT NOT NULL,
 created_at TEXT NOT NULL, owner_id TEXT NOT NULL, deleted_at TEXT
);
CREATE TABLE pt_webhook_secrets (
 id TEXT PRIMARY KEY, subscription_id TEXT NOT NULL REFERENCES pt_webhook_subscriptions(id),
 sealed TEXT NOT NULL, expires_at TEXT
);
CREATE TABLE pt_webhook_events (
 id TEXT PRIMARY KEY, type TEXT NOT NULL, at TEXT NOT NULL, kind TEXT NOT NULL,
 record_id TEXT NOT NULL, revision TEXT NOT NULL, status TEXT NOT NULL
);
CREATE TABLE pt_webhook_deliveries (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES pt_webhook_events(id),
 subscription_id TEXT NOT NULL REFERENCES pt_webhook_subscriptions(id), host TEXT NOT NULL,
 state TEXT NOT NULL CHECK(state IN ('pending','sending','succeeded','failed','cancelled')),
 attempt INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, lease_until TEXT
);
CREATE INDEX pt_webhooks_due ON pt_webhook_deliveries(state,next_at);
CREATE TABLE pt_webhook_attempts (
 id TEXT PRIMARY KEY, delivery_id TEXT NOT NULL REFERENCES pt_webhook_deliveries(id),
 event_id TEXT NOT NULL, type TEXT NOT NULL, kind TEXT NOT NULL, record_id TEXT NOT NULL,
 revision TEXT NOT NULL, status TEXT NOT NULL, host TEXT NOT NULL, attempt INTEGER NOT NULL,
 at TEXT NOT NULL, outcome TEXT NOT NULL, status_code INTEGER, error_class TEXT, duration_ms INTEGER
);
CREATE INDEX pt_webhooks_history ON pt_webhook_attempts(at,id);
