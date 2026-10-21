CREATE TABLE pt_issuing_limits (
  id TEXT PRIMARY KEY,
  issuing_cents INTEGER NOT NULL CHECK (issuing_cents >= 0),
  credit_cents INTEGER NOT NULL CHECK (credit_cents >= 0),
  revision TEXT NOT NULL
);
ALTER TABLE pt_invoices ADD COLUMN self_approval TEXT;
