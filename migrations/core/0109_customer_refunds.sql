-- Refunds consume existing customer money, never create a negative sale.
CREATE TABLE pt_customer_refunds (
 id TEXT PRIMARY KEY,
 source_kind TEXT NOT NULL CHECK(source_kind IN ('payment','credit')),
 source_id TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 invoice_id TEXT REFERENCES pt_invoices(id),
 payment_id TEXT REFERENCES pt_payments(id),
 amount_cents INTEGER NOT NULL CHECK(amount_cents>0),
 refund_date TEXT NOT NULL,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 method TEXT NOT NULL CHECK(method IN ('recorded','stripe')),
 reason TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','approved','pending','succeeded','failed','canceled')),
 revision TEXT NOT NULL,
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 self_approval TEXT,
 provider_account TEXT,
 payment_intent TEXT,
 provider_id TEXT UNIQUE,
 provider_status TEXT,
 provider_created INTEGER,
 journal_id TEXT REFERENCES pt_journal_entries(id),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
CREATE INDEX pt_customer_refunds_source ON pt_customer_refunds(source_kind,source_id,status);
CREATE TRIGGER pt_refund_available BEFORE UPDATE OF status ON pt_customer_refunds
WHEN NEW.status IN ('approved','pending','succeeded')
BEGIN
 SELECT CASE WHEN NEW.amount_cents + COALESCE((SELECT SUM(amount_cents) FROM pt_customer_refunds WHERE id<>NEW.id AND source_kind=NEW.source_kind AND source_id=NEW.source_id AND status IN ('approved','pending','succeeded')),0)
 + COALESCE((SELECT SUM(amount_cents) FROM pt_allocations WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id AND voided_by IS NULL),0)
 > CASE WHEN NEW.source_kind='payment' THEN (SELECT amount_cents FROM pt_payments WHERE id=NEW.source_id AND direction='received' AND reversal_id IS NULL) ELSE (SELECT total_cents FROM pt_invoices WHERE id=NEW.source_id AND kind='credit' AND status='issued' AND early_reversal_id IS NULL) END
 THEN RAISE(ABORT,'PANTRY_REFUND_AVAILABLE') END;
END;
CREATE TRIGGER pt_refund_allocation_available AFTER INSERT ON pt_allocations
WHEN NEW.target_kind='invoice'
BEGIN
 SELECT CASE WHEN COALESCE((SELECT SUM(amount_cents) FROM pt_customer_refunds WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id AND status IN ('approved','pending','succeeded')),0)
 + (SELECT COALESCE(SUM(amount_cents),0) FROM pt_allocations WHERE source_kind=NEW.source_kind AND source_id=NEW.source_id AND voided_by IS NULL)
 > CASE WHEN NEW.source_kind='payment' THEN (SELECT amount_cents FROM pt_payments WHERE id=NEW.source_id) ELSE (SELECT total_cents FROM pt_invoices WHERE id=NEW.source_id) END
 THEN RAISE(ABORT,'PANTRY_REFUND_AVAILABLE') END;
END;
CREATE TRIGGER pt_refunded_payment_retained BEFORE UPDATE OF reversal_id ON pt_payments
WHEN NEW.reversal_id IS NOT NULL AND EXISTS(SELECT 1 FROM pt_customer_refunds WHERE payment_id=NEW.id AND status IN ('approved','pending','succeeded'))
BEGIN SELECT RAISE(ABORT,'PANTRY_REFUND_RETAINED'); END;

CREATE TRIGGER pt_refund_credit_cash_cap BEFORE UPDATE OF status ON pt_customer_refunds
WHEN NEW.source_kind='credit' AND NEW.status IN ('approved','pending','succeeded')
BEGIN
 SELECT CASE WHEN NEW.amount_cents + COALESCE((SELECT SUM(r.amount_cents) FROM pt_customer_refunds r JOIN pt_invoices c ON c.id=r.source_id AND r.source_kind='credit' WHERE r.id<>NEW.id AND c.credit_for=(SELECT credit_for FROM pt_invoices WHERE id=NEW.source_id) AND r.status IN ('approved','pending','succeeded')),0)
 > (SELECT COALESCE(SUM(a.amount_cents),0) FROM pt_allocations a JOIN pt_payments p ON p.id=a.source_id WHERE a.source_kind='payment' AND a.target_kind='invoice' AND a.target_id=(SELECT credit_for FROM pt_invoices WHERE id=NEW.source_id) AND a.voided_by IS NULL AND p.reversal_id IS NULL)
 THEN RAISE(ABORT,'PANTRY_REFUND_AVAILABLE') END;
END;
CREATE TRIGGER pt_refund_source_current BEFORE UPDATE OF status ON pt_customer_refunds
WHEN NEW.status IN ('approved','pending','succeeded')
BEGIN
 SELECT CASE WHEN (NEW.source_kind='payment' AND NOT EXISTS(SELECT 1 FROM pt_payments WHERE id=NEW.source_id AND direction='received' AND reversal_id IS NULL)) OR (NEW.source_kind='credit' AND NOT EXISTS(SELECT 1 FROM pt_invoices WHERE id=NEW.source_id AND kind='credit' AND status='issued' AND early_reversal_id IS NULL)) THEN RAISE(ABORT,'PANTRY_REFUND_AVAILABLE') END;
END;
CREATE TRIGGER pt_refunded_credit_retained BEFORE UPDATE OF early_reversal_id ON pt_invoices
WHEN NEW.early_reversal_id IS NOT NULL AND EXISTS(SELECT 1 FROM pt_customer_refunds WHERE source_kind='credit' AND source_id=NEW.id AND status IN ('approved','pending','succeeded'))
BEGIN SELECT RAISE(ABORT,'PANTRY_REFUND_RETAINED'); END;
