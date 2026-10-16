-- Reports a business files from: sales tax by state, 1099 contractors and the
-- way each payment was made (card and payment-network payments are reported by
-- the processor on 1099-K, so they stay out of 1099-NEC totals).

-- Each sales tax code belongs to a state. Codes made before this change were
-- the business's own home-state rates; they start in the business's state and
-- can be moved to another state on the tax code screen.
ALTER TABLE pt_tax_codes ADD COLUMN state TEXT NOT NULL DEFAULT '';
UPDATE pt_tax_codes SET state = COALESCE((SELECT state FROM pt_entity WHERE id = 1), '');

-- How a recorded payment left or reached the bank. Older payments say "unrecorded"
-- until a person sets it.
ALTER TABLE pt_payments ADD COLUMN method TEXT NOT NULL DEFAULT 'unrecorded'
 CHECK (method IN ('unrecorded', 'check', 'ach', 'wire', 'cash', 'card', 'payment-network'));

-- Vendors paid for services who get a 1099-NEC.
ALTER TABLE pt_contacts ADD COLUMN is_1099 INTEGER NOT NULL DEFAULT 0 CHECK (is_1099 IN (0, 1));

-- The contractor's filing details. The TIN is a protected field: screens and
-- views only ever see its last four digits; the full number leaves only in the
-- filing CSV, for the owner or a person with the posting grant, and every such
-- download is in the audit trail.
CREATE TABLE pt_contractor_tax (
 contact_id TEXT PRIMARY KEY REFERENCES pt_contacts(id),
 legal_name TEXT NOT NULL,
 tin_kind TEXT NOT NULL CHECK (tin_kind IN ('ssn', 'ein')),
 tin TEXT NOT NULL CHECK (length(tin) = 9 AND tin NOT GLOB '*[^0-9]*'),
 address TEXT NOT NULL,
 city TEXT NOT NULL,
 state TEXT NOT NULL,
 zip TEXT NOT NULL,
 revision TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
