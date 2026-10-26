-- INVOICE-008: an owner policy only prepares a separate ordinary invoice draft.
CREATE TABLE pt_late_fee_policy (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
 method TEXT NOT NULL DEFAULT 'flat' CHECK (method IN ('flat', 'percentage')),
 flat_cents INTEGER CHECK (flat_cents > 0),
 percentage_milli INTEGER CHECK (percentage_milli > 0 AND percentage_milli <= 100000),
 grace_days INTEGER NOT NULL DEFAULT 0 CHECK (grace_days BETWEEN 0 AND 3650),
 income_account_id TEXT REFERENCES pt_accounts(id),
 tax_code TEXT,
 revision TEXT NOT NULL,
 updated_by TEXT,
 updated_at TEXT,
 CHECK (enabled = 0 OR (income_account_id IS NOT NULL AND
   ((method = 'flat' AND flat_cents IS NOT NULL) OR (method = 'percentage' AND percentage_milli IS NOT NULL))))
);
INSERT INTO pt_late_fee_policy(id, revision) VALUES (1, 'initial');

-- A source invoice can produce one fee. Different simultaneous request keys
-- still select the same charge, and a fee cannot itself become a fee basis.
CREATE TABLE pt_late_fee_preparations (
 id TEXT PRIMARY KEY,
 source_invoice_id TEXT NOT NULL UNIQUE REFERENCES pt_invoices(id),
 invoice_id TEXT NOT NULL UNIQUE REFERENCES pt_invoices(id),
 fee_date TEXT NOT NULL,
 idempotency_key TEXT NOT NULL UNIQUE,
 policy_revision TEXT NOT NULL,
 policy_snapshot TEXT NOT NULL CHECK (json_valid(policy_snapshot)),
 source_snapshot TEXT NOT NULL CHECK (json_valid(source_snapshot)),
 basis_cents INTEGER NOT NULL CHECK (basis_cents > 0),
 fee_cents INTEGER NOT NULL CHECK (fee_cents > 0),
 prepared_by TEXT NOT NULL,
 prepared_at TEXT NOT NULL
);
CREATE TRIGGER pt_late_fee_preparations_immutable BEFORE UPDATE ON pt_late_fee_preparations
 BEGIN SELECT RAISE(ABORT, 'Late fee preparation evidence is retained'); END;
CREATE TRIGGER pt_late_fee_preparations_no_delete BEFORE DELETE ON pt_late_fee_preparations
 BEGIN SELECT RAISE(ABORT, 'Late fee preparation evidence is retained'); END;
