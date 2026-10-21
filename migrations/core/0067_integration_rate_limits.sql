-- One bounded, durable budget per integration credential, shared by Worker instances.
CREATE TABLE pt_integration_rate_limits (
 credential_id TEXT PRIMARY KEY REFERENCES pt_integrations(id),
 window_start INTEGER NOT NULL,
 requests INTEGER NOT NULL CHECK (requests BETWEEN 1 AND 120)
);
