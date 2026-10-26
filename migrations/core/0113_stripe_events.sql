-- Extend the original CHECK while preserving every existing Checkout record.
CREATE TABLE pt_stripe_payments_next (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 method TEXT NOT NULL CHECK(method IN ('card','us_bank_account')),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 status TEXT NOT NULL CHECK(status IN ('open','processing','succeeded','failed','expired','returned','disputed','refunded')),
 payment_intent TEXT,
 payment_id TEXT REFERENCES pt_payments(id),
 fee_cents INTEGER,
 fee_entry_id TEXT REFERENCES pt_journal_entries(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 early_window_end TEXT,
 method_brand TEXT NOT NULL DEFAULT '',
 method_bank TEXT NOT NULL DEFAULT '',
 method_last4 TEXT NOT NULL DEFAULT '',
 payer_email TEXT NOT NULL DEFAULT '',
 return_code TEXT NOT NULL DEFAULT '',
 return_reason TEXT NOT NULL DEFAULT '',
 charge_id TEXT,
 return_entry_id TEXT REFERENCES pt_journal_entries(id),
 refunded_cents INTEGER NOT NULL DEFAULT 0,
 disputed_cents INTEGER NOT NULL DEFAULT 0,
 evidence_due_by INTEGER
);
INSERT INTO pt_stripe_payments_next(id,invoice_id,method,amount_cents,status,payment_intent,payment_id,fee_cents,fee_entry_id,created_at,updated_at,early_window_end,method_brand,method_bank,method_last4,payer_email,return_code,return_reason)
 SELECT id,invoice_id,method,amount_cents,status,payment_intent,payment_id,fee_cents,fee_entry_id,created_at,updated_at,early_window_end,method_brand,method_bank,method_last4,payer_email,return_code,return_reason FROM pt_stripe_payments;
DROP TABLE pt_stripe_payments;
ALTER TABLE pt_stripe_payments_next RENAME TO pt_stripe_payments;
CREATE INDEX pt_stripe_payments_invoice ON pt_stripe_payments(invoice_id);
CREATE INDEX pt_stripe_payments_intent ON pt_stripe_payments(payment_intent);
CREATE TRIGGER pt_webhook_stripe_payments_created AFTER INSERT ON pt_stripe_payments
WHEN EXISTS(SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES(lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'processor-payment',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries(id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS(SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

-- Store identity and outcomes, never provider payloads or payment credentials.
CREATE TABLE pt_stripe_events (
 account_id TEXT NOT NULL,
 id TEXT NOT NULL,
 type TEXT NOT NULL,
 provider_created INTEGER NOT NULL,
 object_id TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending','processed','ignored','held')),
 session_id TEXT REFERENCES pt_stripe_payments(id),
 notice_kind TEXT CHECK(notice_kind IN ('processing','receipt','returned')),
 reason TEXT NOT NULL DEFAULT '',
 first_seen_at TEXT NOT NULL,
 processed_at TEXT,
 PRIMARY KEY(account_id,id)
);
CREATE TABLE pt_stripe_disputes (
 account_id TEXT NOT NULL,
 id TEXT NOT NULL,
 session_id TEXT NOT NULL REFERENCES pt_stripe_payments(id),
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 currency TEXT NOT NULL,
 status TEXT NOT NULL,
 reason TEXT NOT NULL,
 evidence_due_by INTEGER,
 ach_return INTEGER NOT NULL CHECK(ach_return IN (0,1)),
 observed_at TEXT NOT NULL,
 PRIMARY KEY(account_id,id)
);
CREATE INDEX pt_stripe_disputes_invoice ON pt_stripe_disputes(invoice_id,status);
-- Both the event writer and the clearing importer consult this ownership fence.
CREATE TABLE pt_stripe_event_movements (
 account_id TEXT NOT NULL,
 balance_transaction TEXT NOT NULL,
 source_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('return','refund')),
 amount_cents INTEGER NOT NULL,
 entry_id TEXT REFERENCES pt_journal_entries(id),
 refund_id TEXT REFERENCES pt_customer_refunds(id),
 CHECK(entry_id IS NOT NULL OR refund_id IS NOT NULL),
 PRIMARY KEY(account_id,balance_transaction)
);
CREATE TABLE pt_stripe_event_comparisons (
 id TEXT PRIMARY KEY,
 account_id TEXT NOT NULL,
 started_at TEXT NOT NULL,
 finished_at TEXT,
 lower_created INTEGER NOT NULL,
 upper_created INTEGER NOT NULL,
 cursor TEXT,
 status TEXT NOT NULL CHECK(status IN ('running','complete','held')),
 retention_gap INTEGER NOT NULL DEFAULT 0 CHECK(retention_gap IN (0,1)),
 reason TEXT NOT NULL DEFAULT ''
);
CREATE TABLE pt_stripe_event_comparison_items (
 run_id TEXT NOT NULL REFERENCES pt_stripe_event_comparisons(id),
 event_id TEXT NOT NULL,
 missing INTEGER NOT NULL CHECK(missing IN (0,1)),
 status TEXT NOT NULL,
 PRIMARY KEY(run_id,event_id)
);

ALTER TABLE pt_invoices ADD COLUMN reminder_cycle TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_deliveries ADD COLUMN reminder_cycle TEXT NOT NULL DEFAULT '';
