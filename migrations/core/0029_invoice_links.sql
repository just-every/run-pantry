-- Customer links expire this many days after the final settlement was recorded.
ALTER TABLE pt_invoices ADD COLUMN link_days_after_payment INTEGER NOT NULL DEFAULT 30 CHECK (link_days_after_payment BETWEEN 0 AND 3650);
