-- INVOICE-010: discounts, delivery charges and deposits on the invoice.
-- A line is an ordinary item line or a delivery charge with its own tax code;
-- `discount_cents` is its share of the before-tax discounts, so its tax is on
-- the amount less that share. The invoice keeps the discounts as entered, the
-- after-tax part, the discounts account in force when the draft was saved and
-- the deposit received at issue (with the payment it became).
ALTER TABLE pt_invoice_lines ADD COLUMN line_kind TEXT NOT NULL DEFAULT 'item' CHECK (line_kind IN ('item', 'delivery'));
ALTER TABLE pt_invoice_lines ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE pt_invoices ADD COLUMN discounts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discounts));
ALTER TABLE pt_invoices ADD COLUMN discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (discount_cents >= 0);
ALTER TABLE pt_invoices ADD COLUMN after_tax_discount_cents INTEGER NOT NULL DEFAULT 0 CHECK (after_tax_discount_cents >= 0);
ALTER TABLE pt_invoices ADD COLUMN discount_account_id TEXT REFERENCES pt_accounts(id);
ALTER TABLE pt_invoices ADD COLUMN deposit TEXT CHECK (deposit IS NULL OR json_valid(deposit));
ALTER TABLE pt_invoices ADD COLUMN deposit_payment_id TEXT REFERENCES pt_payments(id);
ALTER TABLE pt_recurring ADD COLUMN discounts TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(discounts));
-- A template's deposit is received at the issue of each invoice it creates (dated that day).
ALTER TABLE pt_recurring ADD COLUMN deposit TEXT CHECK (deposit IS NULL OR json_valid(deposit));

-- The accounts the accountant chose: invoice discounts, and early-payment
-- discounts (which fall back to the invoice discounts account).
CREATE TABLE pt_discount_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 discount_account_id TEXT REFERENCES pt_accounts(id),
 early_account_id TEXT REFERENCES pt_accounts(id),
 revision TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
