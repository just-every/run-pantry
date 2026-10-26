CREATE TABLE pt_texting (
 id INTEGER PRIMARY KEY CHECK(id=1), account_sid_sealed TEXT, auth_token_sealed TEXT,
 from_number TEXT NOT NULL DEFAULT '+15005550006', enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
 business_contact TEXT NOT NULL DEFAULT '', invoice_template TEXT NOT NULL DEFAULT '{{business}}: {{invoice}} {{link}}. Reply STOP to stop or HELP for help.',
 reminder_template TEXT NOT NULL DEFAULT '{{business}} reminder: {{invoice}}, {{balance}} due {{due_date}}. {{link}} Reply STOP to stop or HELP for help.',
 reminder_days TEXT NOT NULL DEFAULT '[]', revision TEXT NOT NULL, updated_by TEXT, updated_at TEXT
);
INSERT INTO pt_texting(id,revision) VALUES(1,'initial');
CREATE TABLE pt_text_consents (
 phone TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES pt_contacts(id), purposes TEXT NOT NULL,
 time_zone TEXT NOT NULL, source TEXT NOT NULL, wording TEXT NOT NULL, consented_at TEXT NOT NULL,
 recorded_by TEXT NOT NULL, recorded_at TEXT NOT NULL, revoked_at TEXT, revision TEXT NOT NULL
);
CREATE TABLE pt_text_blocks (phone TEXT PRIMARY KEY, at TEXT NOT NULL, keyword TEXT NOT NULL);
CREATE TABLE pt_text_messages (
 id TEXT PRIMARY KEY, request_id TEXT NOT NULL UNIQUE, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL,
 invoice_id TEXT, customer_id TEXT NOT NULL, purpose TEXT NOT NULL, phone TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('held','sending','queued','sent','delivered','failed','undeliverable','uncertain','cancelled')),
 provider_message_id TEXT, detail TEXT NOT NULL DEFAULT '', at TEXT NOT NULL, updated_at TEXT NOT NULL,
 not_before TEXT, actor_email TEXT NOT NULL, actor_kind TEXT NOT NULL, settings_revision TEXT NOT NULL,
 consent_revision TEXT NOT NULL, link_path TEXT NOT NULL, reminder_step INTEGER, reminder_day TEXT, reminder_cycle INTEGER
);
CREATE UNIQUE INDEX pt_text_reminder_daily ON pt_text_messages(invoice_id,phone,reminder_day) WHERE purpose='reminder';
CREATE INDEX pt_text_due ON pt_text_messages(status,not_before);
CREATE TABLE pt_text_events (
 id TEXT PRIMARY KEY, message_id TEXT NOT NULL REFERENCES pt_text_messages(id), status TEXT NOT NULL,
 at TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', UNIQUE(message_id,status)
);
CREATE TABLE pt_text_inbound (provider_id TEXT PRIMARY KEY, phone TEXT NOT NULL, keyword TEXT NOT NULL, at TEXT NOT NULL);
CREATE TABLE pt_text_shares (
 id TEXT PRIMARY KEY, subject_kind TEXT NOT NULL, subject_id TEXT NOT NULL, customer_id TEXT NOT NULL,
 phone TEXT NOT NULL, body TEXT NOT NULL, actor_email TEXT NOT NULL, at TEXT NOT NULL
);
