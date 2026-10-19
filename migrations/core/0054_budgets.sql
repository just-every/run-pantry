CREATE TABLE pt_budgets (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, start_month TEXT NOT NULL,
  basis TEXT NOT NULL CHECK(basis IN ('cash','accrual')), revision TEXT NOT NULL,
  source TEXT NOT NULL, prepared_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE pt_budget_cells (
  budget_id TEXT NOT NULL REFERENCES pt_budgets(id), account_id TEXT NOT NULL REFERENCES pt_accounts(id),
  month TEXT NOT NULL, amount_cents INTEGER NOT NULL,
  PRIMARY KEY(budget_id, account_id, month)
);
