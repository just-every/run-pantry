ALTER TABLE pt_contacts ADD COLUMN vendor_tax_box TEXT NOT NULL DEFAULT 'NEC-1';
ALTER TABLE pt_contacts ADD COLUMN provider_payment_method TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN payment_provider TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contractor_tax ADD COLUMN backup_withholding INTEGER NOT NULL DEFAULT 0 CHECK (backup_withholding IN (0,1));
