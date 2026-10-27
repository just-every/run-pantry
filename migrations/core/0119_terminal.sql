CREATE TABLE pt_terminal_settings (
  id INTEGER PRIMARY KEY CHECK(id = 1),
  tip_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
  revision TEXT NOT NULL
);
CREATE TABLE pt_terminal_payments (
  id TEXT PRIMARY KEY,
  provider_account TEXT NOT NULL,
  reader_id TEXT NOT NULL,
  invoice_id TEXT REFERENCES pt_invoices(id),
  customer_id TEXT REFERENCES pt_contacts(id),
  sale_date TEXT NOT NULL,
  description TEXT NOT NULL,
  amount_cents INTEGER NOT NULL CHECK(amount_cents > 0),
  tip_cents INTEGER NOT NULL CHECK(tip_cents >= 0),
  income_account_id TEXT REFERENCES pt_accounts(id),
  tip_account_id TEXT REFERENCES pt_accounts(id),
  tax_reason TEXT NOT NULL,
  early_window_end TEXT,
  payment_intent TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','processing','succeeded')),
  brand TEXT NOT NULL DEFAULT '',
  last4 TEXT NOT NULL DEFAULT '',
  journal_id TEXT REFERENCES pt_journal_entries(id),
  fee_entry_id TEXT REFERENCES pt_journal_entries(id),
  fee_cents INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);
