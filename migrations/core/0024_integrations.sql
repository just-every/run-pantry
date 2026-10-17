-- Credentials belong to the installation, never to an owner's session.
CREATE TABLE pt_integrations (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 scopes TEXT NOT NULL CHECK (json_valid(scopes)),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 revoked_at TEXT
);
CREATE TABLE pt_integration_requests (
 credential_id TEXT NOT NULL REFERENCES pt_integrations(id),
 request_key TEXT NOT NULL,
 operation TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 target_kind TEXT NOT NULL,
 target_id TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY (credential_id, request_key)
);
CREATE TABLE pt_integration_contacts (
 credential_id TEXT NOT NULL REFERENCES pt_integrations(id),
 external_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('customer', 'vendor')),
 contact_id TEXT NOT NULL REFERENCES pt_contacts(id),
 PRIMARY KEY (credential_id, external_id, kind)
);
CREATE TABLE pt_integration_calls (
 id TEXT PRIMARY KEY,
 credential_id TEXT NOT NULL REFERENCES pt_integrations(id),
 at TEXT NOT NULL,
 method TEXT NOT NULL,
 path TEXT NOT NULL,
 status INTEGER NOT NULL
);
CREATE INDEX pt_integration_calls_at ON pt_integration_calls(at);
ALTER TABLE pt_bills ADD COLUMN received INTEGER NOT NULL DEFAULT 0 CHECK (received IN (0, 1));
ALTER TABLE pt_bills ADD COLUMN ready_to_pay INTEGER NOT NULL DEFAULT 0 CHECK (ready_to_pay IN (0, 1) AND (ready_to_pay = 0 OR received = 1));

CREATE TABLE pt_audit_integrations (
 id TEXT PRIMARY KEY,
 at TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent', 'system', 'integration')),
 action TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO pt_audit_integrations SELECT * FROM pt_audit;
DROP TABLE pt_audit;
ALTER TABLE pt_audit_integrations RENAME TO pt_audit;
CREATE INDEX pt_audit_at ON pt_audit(at);
