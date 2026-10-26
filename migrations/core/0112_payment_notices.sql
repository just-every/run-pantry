ALTER TABLE pt_sending ADD COLUMN payment_receipts_on INTEGER NOT NULL DEFAULT 1 CHECK(payment_receipts_on IN (0,1));
ALTER TABLE pt_contacts ADD COLUMN payment_receipts_on INTEGER NOT NULL DEFAULT 1 CHECK(payment_receipts_on IN (0,1));
ALTER TABLE pt_stripe_payments ADD COLUMN method_brand TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe_payments ADD COLUMN method_bank TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe_payments ADD COLUMN method_last4 TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe_payments ADD COLUMN payer_email TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe_payments ADD COLUMN return_code TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe_payments ADD COLUMN return_reason TEXT NOT NULL DEFAULT '';

-- A claim survives every delivery outcome, including an unknown transport result.
-- Provider replay must never resend a payment communication.
CREATE TABLE pt_payment_notices (
 id TEXT PRIMARY KEY,
 source_id TEXT NOT NULL,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 payment_id TEXT REFERENCES pt_payments(id),
 kind TEXT NOT NULL CHECK(kind IN ('processing','receipt','returned')),
 recipient TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('sending','accepted','rejected','rate_limited','uncertain','suppressed','failed','cancelled')),
 provider TEXT NOT NULL DEFAULT '',
 provider_message_id TEXT,
 detail TEXT NOT NULL DEFAULT '',
 sent_by TEXT NOT NULL,
 at TEXT NOT NULL,
 finished_at TEXT,
 UNIQUE(source_id,kind,recipient)
);
CREATE INDEX pt_payment_notices_invoice ON pt_payment_notices(invoice_id,at);
