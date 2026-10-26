CREATE TABLE pt_autopay_policies (
 customer_id TEXT PRIMARY KEY REFERENCES pt_contacts(id),
 recurring_id TEXT NOT NULL REFERENCES pt_recurring(id),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN(0,1)),
 purpose TEXT NOT NULL,
 notice_subject TEXT NOT NULL,
 notice_template TEXT NOT NULL,
 retry_days TEXT NOT NULL CHECK(json_valid(retry_days)),
 template_revision TEXT NOT NULL,
 schedule TEXT NOT NULL CHECK(json_valid(schedule)),
 customer_binding TEXT NOT NULL CHECK(json_valid(customer_binding)),
 stripe_account TEXT NOT NULL,
 approved_by TEXT NOT NULL,
 owner_id TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 revision TEXT NOT NULL
);
CREATE TABLE pt_autopay_setups (
 id TEXT PRIMARY KEY,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 policy_revision TEXT NOT NULL,
 stripe_account TEXT NOT NULL,
 stripe_customer TEXT NOT NULL,
 method TEXT NOT NULL CHECK(method IN('card','us_bank_account')),
 mandate_text TEXT NOT NULL,
 accepted_at TEXT NOT NULL,
 accepted_ip TEXT NOT NULL,
 session_id TEXT UNIQUE,
 setup_intent TEXT,
 status TEXT NOT NULL CHECK(status IN('creating','open','succeeded','revoked','uncertain'))
);
ALTER TABLE pt_contacts ADD COLUMN autopay_setup_id TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_mandate_text TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_accepted_at TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_accepted_ip TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_payment_method TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_stripe_customer TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_mandate_id TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_method TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_last4 TEXT;
ALTER TABLE pt_contacts ADD COLUMN autopay_revoked_at TEXT;
CREATE TABLE pt_autopay_attempts (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 policy_revision TEXT NOT NULL,
 setup_id TEXT NOT NULL REFERENCES pt_autopay_setups(id),
 sequence INTEGER NOT NULL CHECK(sequence BETWEEN 0 AND 12),
 scheduled_on TEXT NOT NULL,
 attempted_on TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 status TEXT NOT NULL CHECK(status IN('claiming','processing','succeeded','failed','uncertain','cancelled')),
 payment_intent TEXT UNIQUE,
 failure_code TEXT NOT NULL DEFAULT '',
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(invoice_id,sequence)
);
CREATE TABLE pt_autopay_notices (
 id TEXT PRIMARY KEY,
 attempt_id TEXT NOT NULL REFERENCES pt_autopay_attempts(id),
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT,
 detail TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL,
 finished_at TEXT,
 UNIQUE(attempt_id,recipient)
);
CREATE INDEX pt_autopay_attempts_invoice ON pt_autopay_attempts(invoice_id,sequence);
