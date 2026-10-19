-- Customer preferences are private contact data; documents only select fields
-- intended for the recipient. NULL payment methods means every offered method.
ALTER TABLE pt_contacts ADD COLUMN contacts_json TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(contacts_json) AND json_type(contacts_json) = 'array');
ALTER TABLE pt_contacts ADD COLUMN billing_address TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN service_address TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN internal_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN pay_methods TEXT CHECK (pay_methods IS NULL OR (json_valid(pay_methods) AND json_type(pay_methods) = 'array'));
