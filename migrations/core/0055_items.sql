-- ITEM-001: the services and non-inventory products a business sells. An
-- invoice line keeps the item it was sold as, so an item made inactive stays on
-- the invoices that already carry it.
CREATE TABLE pt_items (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 kind TEXT NOT NULL CHECK (kind IN ('service', 'non-inventory')),
 description TEXT NOT NULL DEFAULT '',
 sku TEXT,
 rate_cents INTEGER NOT NULL CHECK (rate_cents >= 0),
 income_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 tax_category TEXT NOT NULL CHECK (tax_category IN ('taxable', 'non-taxable')),
 tax_code TEXT REFERENCES pt_tax_codes(id),
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL,
 CHECK (tax_category = 'taxable' OR tax_code IS NULL)
);
CREATE UNIQUE INDEX pt_items_name ON pt_items (lower(name));
CREATE UNIQUE INDEX pt_items_sku ON pt_items (lower(sku)) WHERE sku IS NOT NULL;
ALTER TABLE pt_invoice_lines ADD COLUMN item_id TEXT REFERENCES pt_items(id);
