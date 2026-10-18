-- Cash-flow reporting classifications are separate from the immutable account type.
CREATE TABLE pt_cash_flow_classes (
  account_id TEXT PRIMARY KEY REFERENCES pt_accounts(id),
  class TEXT NOT NULL CHECK (class IN ('cash', 'operating', 'investing', 'financing'))
);
