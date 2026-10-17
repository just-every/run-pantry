-- Connected: Stripe payouts split into sales, fees and refunds, and Gusto
-- payrolls posted as one balanced entry, each matched to its bank movement.

-- Where Stripe payouts are booked: the bank account they land in, the income
-- account for sales Pantry did not invoice, and the account refunds and
-- disputes reduce. Payouts arriving on or after `payouts_from` are booked.
ALTER TABLE pt_stripe ADD COLUMN payout_bank_account_id TEXT REFERENCES pt_bank_accounts(id);
ALTER TABLE pt_stripe ADD COLUMN sales_account_id TEXT REFERENCES pt_accounts(id);
ALTER TABLE pt_stripe ADD COLUMN refunds_account_id TEXT REFERENCES pt_accounts(id);
ALTER TABLE pt_stripe ADD COLUMN payouts_from TEXT;
ALTER TABLE pt_stripe ADD COLUMN payouts_synced_at TEXT;
ALTER TABLE pt_stripe ADD COLUMN payouts_error TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_stripe ADD COLUMN payouts_claim_until TEXT;

-- One row per Stripe payout Pantry has read. A payout is booked once: the row
-- moves to 'booked' in the same batch that posts its entry.
CREATE TABLE pt_stripe_payouts (
 id TEXT PRIMARY KEY,
 arrival_date TEXT NOT NULL,
 currency TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 gross_cents INTEGER NOT NULL DEFAULT 0,
 invoiced_cents INTEGER NOT NULL DEFAULT 0,
 fee_cents INTEGER NOT NULL DEFAULT 0,
 refund_cents INTEGER NOT NULL DEFAULT 0,
 charges INTEGER NOT NULL DEFAULT 0,
 refunds INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK (status IN ('booked', 'held', 'other-currency')),
 reason TEXT NOT NULL DEFAULT '',
 entry_id TEXT REFERENCES pt_journal_entries(id),
 read_at TEXT NOT NULL
);
CREATE INDEX pt_stripe_payouts_arrival ON pt_stripe_payouts(arrival_date);

-- Gusto: the company this install reads payrolls from, its OAuth tokens
-- (sealed with the installation's session secret; the refresh token rotates on
-- every use), the bank account Gusto debits and the accounts payroll posts to.
CREATE TABLE pt_gusto (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 company_uuid TEXT NOT NULL,
 company_name TEXT NOT NULL DEFAULT '',
 access_sealed TEXT NOT NULL,
 refresh_sealed TEXT NOT NULL,
 access_expires_at TEXT NOT NULL,
 bank_account_id TEXT REFERENCES pt_bank_accounts(id),
 wages_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 taxes_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 benefits_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 reimbursements_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 liabilities_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 payrolls_from TEXT NOT NULL,
 synced_at TEXT,
 sync_error TEXT NOT NULL DEFAULT '',
 claim_until TEXT,
 connected_by TEXT NOT NULL,
 connected_at TEXT NOT NULL,
 revision TEXT NOT NULL
);
-- An authorization in flight: the state Gusto must hand back, for ten minutes.
CREATE TABLE pt_gusto_states (
 state TEXT PRIMARY KEY,
 started_by TEXT NOT NULL,
 started_at TEXT NOT NULL
);
-- One row per processed Gusto payroll Pantry has read, booked once.
CREATE TABLE pt_gusto_payrolls (
 uuid TEXT PRIMARY KEY,
 check_date TEXT NOT NULL,
 period_start TEXT,
 period_end TEXT,
 off_cycle INTEGER NOT NULL DEFAULT 0 CHECK (off_cycle IN (0, 1)),
 gross_cents INTEGER NOT NULL,
 employer_tax_cents INTEGER NOT NULL,
 withheld_cents INTEGER NOT NULL,
 net_cents INTEGER NOT NULL,
 debit_cents INTEGER NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('booked', 'held')),
 reason TEXT NOT NULL DEFAULT '',
 entry_id TEXT REFERENCES pt_journal_entries(id),
 read_at TEXT NOT NULL
);
CREATE INDEX pt_gusto_payrolls_check ON pt_gusto_payrolls(check_date);
