-- Read-only client status grants are separate from native sign-in authority.
CREATE TABLE pt_accountant_status_grants (
 email TEXT PRIMARY KEY REFERENCES pt_members(email),
 token_hash TEXT NOT NULL UNIQUE,
 member_revision TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE TABLE pt_accountant_clients (
 person_id TEXT NOT NULL,
 origin TEXT NOT NULL,
 token_sealed TEXT NOT NULL,
 PRIMARY KEY (person_id, origin)
);
