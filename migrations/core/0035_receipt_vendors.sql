-- Receipt identity proposals never merge contacts or alter payment instructions.
ALTER TABLE pt_contacts ADD COLUMN address TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN phone TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN default_account_id TEXT REFERENCES pt_accounts(id);
ALTER TABLE pt_contacts ADD COLUMN default_class TEXT NOT NULL DEFAULT '';
-- Identity only; the filing TIN remains in pt_contractor_tax.
ALTER TABLE pt_contacts ADD COLUMN vendor_ein_hash TEXT NOT NULL DEFAULT '';

CREATE TABLE pt_vendor_aliases (
 vendor_id TEXT NOT NULL REFERENCES pt_contacts(id),
 alias_key TEXT NOT NULL,
 alias TEXT NOT NULL,
 confirmed_by TEXT NOT NULL,
 confirmed_at TEXT NOT NULL,
 PRIMARY KEY (vendor_id, alias_key)
);
CREATE INDEX pt_vendor_alias_lookup ON pt_vendor_aliases(alias_key);

ALTER TABLE pt_receipts ADD COLUMN read_vendor_details TEXT;
ALTER TABLE pt_receipts ADD COLUMN vendor_id TEXT REFERENCES pt_contacts(id);
ALTER TABLE pt_receipts ADD COLUMN vendor_terms_days INTEGER CHECK (vendor_terms_days BETWEEN 0 AND 365);
ALTER TABLE pt_receipts ADD COLUMN vendor_is_1099 INTEGER CHECK (vendor_is_1099 IN (0, 1));
ALTER TABLE pt_receipts ADD COLUMN vendor_class TEXT;
ALTER TABLE pt_receipts ADD COLUMN vendor_confirmed_by TEXT;
ALTER TABLE pt_receipts ADD COLUMN vendor_confirmed_at TEXT;
