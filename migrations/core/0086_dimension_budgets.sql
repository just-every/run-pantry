-- Detailed budget cells supplement the retained account/month rollup.
CREATE TABLE pt_budget_dimension_cells (
 budget_id TEXT NOT NULL REFERENCES pt_budgets(id),account_id TEXT NOT NULL REFERENCES pt_accounts(id),month TEXT NOT NULL,amount_cents INTEGER NOT NULL,
 class_name TEXT NOT NULL DEFAULT '',location_name TEXT NOT NULL DEFAULT '',
 PRIMARY KEY(budget_id,account_id,month,class_name,location_name)
);

ALTER TABLE pt_receipts ADD COLUMN class_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_receipts ADD COLUMN location_name TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_receipts ADD COLUMN project_name TEXT NOT NULL DEFAULT '';
