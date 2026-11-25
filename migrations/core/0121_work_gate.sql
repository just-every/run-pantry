-- Due work that reads the whole books (the daily checks, transfer pairing, the economic-nexus watch, the
-- books agent) remembers the day, the books' position and the time it last ran, so an unchanged ledger
-- costs a few rows instead of a scan of its history. The position is the last rowid of the audit log
-- (append-only) and of the bank lines (feed lines arrive without an audit entry).
CREATE TABLE pt_work_gate (
  job TEXT PRIMARY KEY,
  day TEXT NOT NULL,
  epoch TEXT NOT NULL,
  ran_at TEXT NOT NULL
);

-- A bank line asks which posted entries could be it: same ledger account, same net amount, nearby date.
-- Indexed on the net amount, that costs the matches, not every line the account ever had.
CREATE INDEX pt_journal_lines_account_net ON pt_journal_lines(account_id, (debit_cents - credit_cents));
