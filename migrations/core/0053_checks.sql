-- A number belongs to its bank permanently, including after a void.
CREATE TABLE pt_check_profiles (
 bank_account_id TEXT PRIMARY KEY REFERENCES pt_bank_accounts(id),
 next_number INTEGER NOT NULL CHECK (next_number BETWEEN 1 AND 999999999),
 stock TEXT NOT NULL CHECK (stock IN ('voucher', 'three-per-page')),
 offset_x_mm REAL NOT NULL DEFAULT 0 CHECK (offset_x_mm BETWEEN -20 AND 20),
 offset_y_mm REAL NOT NULL DEFAULT 0 CHECK (offset_y_mm BETWEEN -20 AND 20),
 positive_pay TEXT NOT NULL CHECK (json_valid(positive_pay)),
 revision TEXT NOT NULL
);
CREATE TABLE pt_check_batches (
 id TEXT PRIMARY KEY,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 check_date TEXT NOT NULL,
 stock TEXT NOT NULL CHECK (stock IN ('voucher', 'three-per-page')),
 offset_x_mm REAL NOT NULL,
 offset_y_mm REAL NOT NULL,
 business_name TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE pt_checks (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES pt_check_batches(id),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 number INTEGER NOT NULL CHECK (number BETWEEN 1 AND 999999998),
 payment_id TEXT NOT NULL UNIQUE REFERENCES pt_payments(id),
 expense_bill_id TEXT REFERENCES pt_bills(id),
 payee TEXT NOT NULL,
 memo TEXT NOT NULL DEFAULT '',
 status TEXT NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'void')),
 void_reason TEXT,
 void_date TEXT,
 reversal_id TEXT REFERENCES pt_journal_entries(id),
 UNIQUE (bank_account_id, number),
 CHECK ((status = 'issued' AND void_reason IS NULL AND reversal_id IS NULL) OR
        (status = 'void' AND length(trim(void_reason)) > 0 AND void_date IS NOT NULL AND reversal_id IS NOT NULL))
);
CREATE TABLE pt_check_exports (
 id TEXT PRIMARY KEY,
 batch_id TEXT NOT NULL REFERENCES pt_check_batches(id),
 format TEXT NOT NULL CHECK (json_valid(format)),
 content TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
-- A generic payment-method edit cannot change a numbered check into card/ACH.
CREATE TRIGGER pt_check_method BEFORE UPDATE OF method, reference, bank_account_id, amount_cents ON pt_payments
WHEN EXISTS (SELECT 1 FROM pt_checks WHERE payment_id = OLD.id)
 AND (NEW.method <> 'check' OR NEW.reference <> OLD.reference OR NEW.bank_account_id <> OLD.bank_account_id OR NEW.amount_cents <> OLD.amount_cents)
BEGIN SELECT RAISE(ABORT, 'Numbered checks retain their method, number, bank and amount'); END;
