-- INVOICE-010 early-payment terms, built to ct's ruling of 20 October 2026.
-- Each tax code carries an explicit treatment (undecided until someone with the
-- post grant records retain or reduce, with its source and revision). An
-- invoice keeps its term as entered and the offer computed when the draft was
-- saved. A taken discount is a system-marked credit linked to the invoice, at
-- most one standing per invoice; its lines name the original line and the
-- treatment applied. Payment allocations record whether they count toward the
-- offer; an allocation voided by a linked reversal keeps its history.
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment TEXT NOT NULL DEFAULT 'undecided' CHECK (early_treatment IN ('undecided', 'retain', 'reduce'));
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment_revision TEXT;
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment_source TEXT CHECK (early_treatment_source IS NULL OR json_valid(early_treatment_source));
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment_reason TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment_by TEXT;
ALTER TABLE pt_tax_codes ADD COLUMN early_treatment_at TEXT;
ALTER TABLE pt_invoices ADD COLUMN early_terms TEXT CHECK (early_terms IS NULL OR json_valid(early_terms));
ALTER TABLE pt_invoices ADD COLUMN early_offer TEXT CHECK (early_offer IS NULL OR json_valid(early_offer));
ALTER TABLE pt_invoices ADD COLUMN early_withdrawn_by TEXT REFERENCES pt_invoices(id);
ALTER TABLE pt_invoices ADD COLUMN early_discount INTEGER NOT NULL DEFAULT 0 CHECK (early_discount IN (0, 1));
ALTER TABLE pt_invoices ADD COLUMN early_detail TEXT CHECK (early_detail IS NULL OR json_valid(early_detail));
ALTER TABLE pt_invoices ADD COLUMN early_reversal_id TEXT REFERENCES pt_journal_entries(id);
ALTER TABLE pt_invoice_lines ADD COLUMN early_treatment TEXT CHECK (early_treatment IS NULL OR early_treatment IN ('retain', 'reduce', 'exempt'));
ALTER TABLE pt_invoice_lines ADD COLUMN early_line_ref TEXT REFERENCES pt_invoice_lines(id);
ALTER TABLE pt_allocations ADD COLUMN early_counted INTEGER NOT NULL DEFAULT 0 CHECK (early_counted IN (0, 1));
ALTER TABLE pt_allocations ADD COLUMN voided_on TEXT;
ALTER TABLE pt_allocations ADD COLUMN voided_by TEXT REFERENCES pt_journal_entries(id);
ALTER TABLE pt_stripe_payments ADD COLUMN early_window_end TEXT;
ALTER TABLE pt_recurring ADD COLUMN early_terms TEXT CHECK (early_terms IS NULL OR json_valid(early_terms));
ALTER TABLE pt_recurring ADD COLUMN early_treatments TEXT CHECK (early_treatments IS NULL OR json_valid(early_treatments));
CREATE UNIQUE INDEX pt_early_discount_once ON pt_invoices(credit_for) WHERE early_discount = 1 AND early_reversal_id IS NULL;
