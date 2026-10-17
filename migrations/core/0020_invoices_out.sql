-- Invoices out: sending with a customer link and PDF, deliveries, reminders,
-- recurring invoices, deposits that match their invoice by themselves, and
-- card or ACH collection from the link through the business's own Stripe.

-- Pantry itself now acts in due work (reminders, recurring runs, automatic
-- matches, Stripe confirmations); the audit trail names it as 'system'.
CREATE TABLE pt_audit_next (
 id TEXT PRIMARY KEY,
 at TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent', 'system')),
 action TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{}'
);
INSERT INTO pt_audit_next (id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail)
 SELECT id, at, actor_email, actor_kind, action, subject_kind, subject_id, detail FROM pt_audit;
DROP TABLE pt_audit;
ALTER TABLE pt_audit_next RENAME TO pt_audit;
CREATE INDEX pt_audit_at ON pt_audit(at);

-- How the business sends: reminder days relative to the due date (negative is
-- before), the calendar its days follow, and where customer replies go.
CREATE TABLE pt_sending (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 reminders_on INTEGER NOT NULL DEFAULT 1 CHECK (reminders_on IN (0, 1)),
 reminder_days TEXT NOT NULL DEFAULT '[-3,0,7]' CHECK (json_valid(reminder_days)),
 time_zone TEXT NOT NULL DEFAULT 'America/New_York',
 reply_to TEXT NOT NULL DEFAULT '',
 revision TEXT NOT NULL,
 updated_by TEXT,
 updated_at TEXT
);
INSERT INTO pt_sending (id, revision) VALUES (1, 'initial');

-- Recurring invoice templates. A template that sends on its own needs a second
-- person's approval of its exact revision; each run is claimed once.
CREATE TABLE pt_recurring (
 id TEXT PRIMARY KEY,
 number TEXT NOT NULL UNIQUE,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 lines TEXT NOT NULL CHECK (json_valid(lines)),
 memo TEXT NOT NULL DEFAULT '',
 every INTEGER NOT NULL CHECK (every BETWEEN 1 AND 12),
 unit TEXT NOT NULL CHECK (unit IN ('week', 'month', 'year')),
 start_date TEXT NOT NULL,
 end_date TEXT,
 runs INTEGER NOT NULL DEFAULT 0 CHECK (runs >= 0),
 next_date TEXT,
 terms_days INTEGER NOT NULL CHECK (terms_days BETWEEN 0 AND 365),
 mode TEXT NOT NULL CHECK (mode IN ('draft', 'send')),
 status TEXT NOT NULL CHECK (status IN ('awaiting-approval', 'active', 'paused', 'ended')),
 subtotal_cents INTEGER NOT NULL,
 tax_cents INTEGER NOT NULL,
 total_cents INTEGER NOT NULL CHECK (total_cents > 0),
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE pt_recurring_runs (
 recurring_id TEXT NOT NULL REFERENCES pt_recurring(id),
 occurrence TEXT NOT NULL,
 invoice_id TEXT REFERENCES pt_invoices(id),
 status TEXT NOT NULL CHECK (status IN ('drafted', 'issued', 'sent', 'failed')),
 detail TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL,
 PRIMARY KEY (recurring_id, occurrence)
);

-- The customer link (an unguessable token), when the invoice was first sent and
-- first opened by the customer, and whether its reminders are paused.
ALTER TABLE pt_invoices ADD COLUMN link_token TEXT;
ALTER TABLE pt_invoices ADD COLUMN sent_at TEXT;
ALTER TABLE pt_invoices ADD COLUMN viewed_at TEXT;
ALTER TABLE pt_invoices ADD COLUMN reminders_paused INTEGER NOT NULL DEFAULT 0 CHECK (reminders_paused IN (0, 1));
ALTER TABLE pt_invoices ADD COLUMN recurring_id TEXT REFERENCES pt_recurring(id);
CREATE UNIQUE INDEX pt_invoices_link ON pt_invoices(link_token) WHERE link_token IS NOT NULL;

-- Every message Pantry sends about an invoice, with the provider's answer. A
-- row is written before the send, so a reminder step is claimed once.
CREATE TABLE pt_deliveries (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 kind TEXT NOT NULL CHECK (kind IN ('invoice', 'reminder')),
 step INTEGER,
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 provider TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL CHECK (status IN ('sending', 'accepted', 'rejected', 'rate_limited', 'uncertain', 'suppressed', 'failed')),
 provider_message_id TEXT,
 detail TEXT NOT NULL DEFAULT '',
 attachment_sha256 TEXT,
 sent_by TEXT NOT NULL,
 at TEXT NOT NULL,
 finished_at TEXT
);
CREATE INDEX pt_deliveries_invoice ON pt_deliveries(invoice_id, at);
CREATE UNIQUE INDEX pt_deliveries_reminder_step ON pt_deliveries(invoice_id, step) WHERE kind = 'reminder';
CREATE UNIQUE INDEX pt_deliveries_reminder_day ON pt_deliveries(invoice_id, substr(at, 1, 10)) WHERE kind = 'reminder';

-- How a customer's deposits read on the bank statement, for automatic matching.
ALTER TABLE pt_contacts ADD COLUMN bank_reference TEXT NOT NULL DEFAULT '';
-- A match Pantry made by itself, and the receipt it recorded for it.
ALTER TABLE pt_matches ADD COLUMN automatic INTEGER NOT NULL DEFAULT 0 CHECK (automatic IN (0, 1));
ALTER TABLE pt_matches ADD COLUMN payment_id TEXT REFERENCES pt_payments(id);

-- Stripe: the business's own key (encrypted with the installation's session
-- secret), its webhook, and the ledger accounts its money passes through.
CREATE TABLE pt_stripe (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 key_sealed TEXT NOT NULL,
 key_hint TEXT NOT NULL,
 livemode INTEGER NOT NULL CHECK (livemode IN (0, 1)),
 account_id TEXT NOT NULL,
 account_name TEXT NOT NULL DEFAULT '',
 settlement_currency TEXT NOT NULL DEFAULT 'usd',
 country TEXT NOT NULL DEFAULT 'US',
 webhook_id TEXT,
 webhook_secret_sealed TEXT,
 card INTEGER NOT NULL DEFAULT 1 CHECK (card IN (0, 1)),
 ach INTEGER NOT NULL DEFAULT 1 CHECK (ach IN (0, 1)),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 fee_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 connected_by TEXT NOT NULL,
 connected_at TEXT NOT NULL,
 revision TEXT NOT NULL
);
-- One row per Stripe Checkout Session started from a customer link.
CREATE TABLE pt_stripe_payments (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 method TEXT NOT NULL CHECK (method IN ('card', 'us_bank_account')),
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 status TEXT NOT NULL CHECK (status IN ('open', 'processing', 'succeeded', 'failed', 'expired')),
 payment_intent TEXT,
 payment_id TEXT REFERENCES pt_payments(id),
 fee_cents INTEGER,
 fee_entry_id TEXT REFERENCES pt_journal_entries(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX pt_stripe_payments_invoice ON pt_stripe_payments(invoice_id);

-- Due work runs from Cron and from ordinary requests; this row spaces the runs.
CREATE TABLE pt_due_work (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 started_at TEXT NOT NULL
);
INSERT INTO pt_due_work (id, started_at) VALUES (1, '1970-01-01T00:00:00.000Z');
