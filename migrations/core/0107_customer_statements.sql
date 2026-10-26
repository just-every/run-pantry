CREATE TABLE pt_customer_statements (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 mode TEXT NOT NULL CHECK(mode IN ('open-items','balance-forward','transaction-list')),
 from_date TEXT NOT NULL,
 to_date TEXT NOT NULL,
 created_at TEXT NOT NULL,
 created_by TEXT NOT NULL,
 idempotency_key TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 subject TEXT NOT NULL,
 text_body TEXT NOT NULL,
 html_body TEXT NOT NULL,
 sha256 TEXT NOT NULL,
 UNIQUE(created_by,idempotency_key)
);
CREATE INDEX pt_customer_statements_customer ON pt_customer_statements(customer_id,created_at,id);
CREATE TRIGGER pt_customer_statements_immutable BEFORE UPDATE ON pt_customer_statements
BEGIN SELECT RAISE(ABORT,'Customer statement originals are immutable'); END;
CREATE TABLE pt_customer_statement_deliveries (
 id TEXT PRIMARY KEY,
 statement_id TEXT NOT NULL REFERENCES pt_customer_statements(id),
 recipient TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','rejected','rate_limited','uncertain','suppressed','failed')),
 provider TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT,
 detail TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL,
 finished_at TEXT,
 UNIQUE(statement_id,recipient)
);
CREATE INDEX pt_customer_statement_deliveries_statement ON pt_customer_statement_deliveries(statement_id,at,id);
