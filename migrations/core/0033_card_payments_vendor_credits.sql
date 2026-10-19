-- Preserve the paying card's identity on the payment itself.
ALTER TABLE pt_payments ADD COLUMN card_last4 TEXT CHECK (card_last4 IS NULL OR card_last4 GLOB '[0-9][0-9][0-9][0-9]');
UPDATE pt_payments SET method = 'card', card_last4 = (
 SELECT b.number_last4 FROM pt_bank_accounts b WHERE b.id = pt_payments.bank_account_id
) WHERE direction = 'paid' AND bank_account_id IN (
 SELECT b.id FROM pt_bank_accounts b JOIN pt_accounts a ON a.id = b.account_id WHERE a.type = 'liability'
);

CREATE TABLE pt_vendor_credits (
 id TEXT PRIMARY KEY,
 vendor_id TEXT NOT NULL REFERENCES pt_contacts(id),
 reference TEXT NOT NULL,
 credit_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 journal_id TEXT NOT NULL UNIQUE REFERENCES pt_journal_entries(id),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE (vendor_id, reference)
);
