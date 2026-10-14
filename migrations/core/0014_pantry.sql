-- Pantry: one US business's books, statements, reconciliation and close.
-- Money is integer US cents. Dates are YYYY-MM-DD. Every mutable row carries a
-- revision that changes on every write; approvals name the revision they saw.

-- A failed CHECK aborts the whole D1 batch: write batches insert one row per
-- authority or state condition and delete them at the end.
CREATE TABLE pt_guard (ok INTEGER NOT NULL CHECK (ok = 1));

CREATE TABLE pt_entity (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 legal_name TEXT NOT NULL,
 entity_type TEXT NOT NULL,
 state TEXT NOT NULL,
 currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
 fiscal_year_start INTEGER NOT NULL CHECK (fiscal_year_start BETWEEN 1 AND 12),
 book_basis TEXT NOT NULL DEFAULT 'accrual' CHECK (book_basis = 'accrual'),
 tax_method TEXT NOT NULL CHECK (tax_method IN ('cash', 'accrual', 'undeclared')),
 policies TEXT NOT NULL DEFAULT '',
 books_start TEXT NOT NULL,
 revision TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);

CREATE TABLE pt_members (
 email TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 role TEXT NOT NULL CHECK (role IN ('bookkeeper', 'accountant', 'viewer')),
 can_post INTEGER NOT NULL DEFAULT 0 CHECK (can_post IN (0, 1)),
 can_lock INTEGER NOT NULL DEFAULT 0 CHECK (can_lock IN (0, 1)),
 can_reopen INTEGER NOT NULL DEFAULT 0 CHECK (can_reopen IN (0, 1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 revision TEXT NOT NULL
);

CREATE TABLE pt_agents (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 revision TEXT NOT NULL
);

CREATE TABLE pt_accounts (
 id TEXT PRIMARY KEY,
 code TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 type TEXT NOT NULL CHECK (type IN ('asset', 'liability', 'equity', 'income', 'expense')),
 subtype TEXT NOT NULL DEFAULT 'other' CHECK (subtype IN ('bank', 'receivable', 'payable', 'tax', 'retained', 'other')),
 description TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 revision TEXT NOT NULL
);
-- One receivable and one payable control account carry the subledgers.
CREATE UNIQUE INDEX pt_accounts_one_receivable ON pt_accounts(subtype) WHERE subtype IN ('receivable', 'payable', 'retained');

CREATE TABLE pt_contacts (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('customer', 'vendor')),
 name TEXT NOT NULL,
 email TEXT NOT NULL DEFAULT '',
 terms_days INTEGER NOT NULL DEFAULT 30 CHECK (terms_days BETWEEN 0 AND 365),
 external_ref TEXT NOT NULL DEFAULT '',
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 revision TEXT NOT NULL,
 UNIQUE (kind, name)
);

CREATE TABLE pt_documents (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 media_type TEXT NOT NULL,
 size INTEGER NOT NULL,
 sha256 TEXT NOT NULL,
 content BLOB NOT NULL,
 linked_kind TEXT,
 linked_id TEXT,
 note TEXT NOT NULL DEFAULT '',
 uploaded_by TEXT NOT NULL,
 uploaded_at TEXT NOT NULL
);

CREATE TABLE pt_tax_codes (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 rate_milli_percent INTEGER NOT NULL CHECK (rate_milli_percent BETWEEN 0 AND 30000),
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 active INTEGER NOT NULL DEFAULT 1,
 revision TEXT NOT NULL
);

CREATE TABLE pt_journal_entries (
 id TEXT PRIMARY KEY,
 number INTEGER UNIQUE,
 entry_date TEXT NOT NULL,
 memo TEXT NOT NULL,
 source_kind TEXT NOT NULL CHECK (source_kind IN ('manual', 'opening', 'invoice', 'credit', 'bill', 'payment', 'bank', 'reversal')),
 source_id TEXT,
 status TEXT NOT NULL CHECK (status IN ('draft', 'posted')),
 prepared_by TEXT NOT NULL,
 prepared_kind TEXT NOT NULL CHECK (prepared_kind IN ('person', 'agent', 'import')),
 proposal_id TEXT,
 document_id TEXT REFERENCES pt_documents(id),
 posted_by TEXT,
 posted_at TEXT,
 reverses_id TEXT UNIQUE REFERENCES pt_journal_entries(id),
 reversed_by_id TEXT REFERENCES pt_journal_entries(id),
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX pt_journal_entries_date ON pt_journal_entries(status, entry_date);

CREATE TABLE pt_journal_lines (
 id TEXT PRIMARY KEY,
 entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 line_no INTEGER NOT NULL,
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 debit_cents INTEGER NOT NULL DEFAULT 0 CHECK (debit_cents >= 0),
 credit_cents INTEGER NOT NULL DEFAULT 0 CHECK (credit_cents >= 0),
 memo TEXT NOT NULL DEFAULT '',
 contact_id TEXT REFERENCES pt_contacts(id),
 CHECK ((debit_cents = 0) <> (credit_cents = 0)),
 UNIQUE (entry_id, line_no)
);
CREATE INDEX pt_journal_lines_account ON pt_journal_lines(account_id);

CREATE TABLE pt_periods (
 id TEXT PRIMARY KEY CHECK (id GLOB '[0-9][0-9][0-9][0-9]-[0-1][0-9]'),
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('open', 'locked')),
 locked_by TEXT,
 locked_at TEXT,
 revision TEXT NOT NULL
);

-- Posted history is immutable: lines of a posted entry never change, a posted
-- entry is never deleted, and its only later change links its reversal.
CREATE TRIGGER pt_lines_posted_update BEFORE UPDATE ON pt_journal_lines
WHEN (SELECT status FROM pt_journal_entries WHERE id = OLD.entry_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;
CREATE TRIGGER pt_lines_posted_delete BEFORE DELETE ON pt_journal_lines
WHEN (SELECT status FROM pt_journal_entries WHERE id = OLD.entry_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;
CREATE TRIGGER pt_lines_posted_insert BEFORE INSERT ON pt_journal_lines
WHEN (SELECT status FROM pt_journal_entries WHERE id = NEW.entry_id) = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;
CREATE TRIGGER pt_entries_posted_delete BEFORE DELETE ON pt_journal_entries
WHEN OLD.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;
CREATE TRIGGER pt_entries_posted_update BEFORE UPDATE ON pt_journal_entries
WHEN OLD.status = 'posted' AND NOT (
 OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL
 AND NEW.id = OLD.id AND NEW.number IS OLD.number AND NEW.entry_date = OLD.entry_date AND NEW.memo = OLD.memo
 AND NEW.status = OLD.status AND NEW.source_kind = OLD.source_kind AND NEW.source_id IS OLD.source_id
 AND NEW.posted_by IS OLD.posted_by AND NEW.posted_at IS OLD.posted_at AND NEW.reverses_id IS OLD.reverses_id)
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;
-- Posting checks balance and the period lock in the database itself.
CREATE TRIGGER pt_entries_post BEFORE UPDATE OF status ON pt_journal_entries
WHEN OLD.status = 'draft' AND NEW.status = 'posted'
BEGIN
 SELECT RAISE(ABORT, 'PANTRY_UNBALANCED') WHERE
  (SELECT COUNT(*) FROM pt_journal_lines WHERE entry_id = NEW.id) < 2
  OR (SELECT SUM(debit_cents) FROM pt_journal_lines WHERE entry_id = NEW.id) <> (SELECT SUM(credit_cents) FROM pt_journal_lines WHERE entry_id = NEW.id)
  OR (SELECT SUM(debit_cents) FROM pt_journal_lines WHERE entry_id = NEW.id) <= 0;
 SELECT RAISE(ABORT, 'PANTRY_PERIOD_LOCKED') WHERE EXISTS (
  SELECT 1 FROM pt_periods WHERE status = 'locked' AND NEW.entry_date BETWEEN start_date AND end_date);
END;
CREATE TRIGGER pt_entries_insert_posted BEFORE INSERT ON pt_journal_entries
WHEN NEW.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_POST_THROUGH_DRAFT'); END;
-- Drafts dated in a locked period cannot be created or changed either.
CREATE TRIGGER pt_entries_draft_locked BEFORE INSERT ON pt_journal_entries
WHEN EXISTS (SELECT 1 FROM pt_periods WHERE status = 'locked' AND NEW.entry_date BETWEEN start_date AND end_date)
BEGIN SELECT RAISE(ABORT, 'PANTRY_PERIOD_LOCKED'); END;

CREATE TABLE pt_invoices (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('invoice', 'credit')),
 number TEXT NOT NULL UNIQUE,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 issue_date TEXT NOT NULL,
 due_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('draft', 'approved', 'issued')),
 memo TEXT NOT NULL DEFAULT '',
 credit_for TEXT REFERENCES pt_invoices(id),
 subtotal_cents INTEGER NOT NULL,
 tax_cents INTEGER NOT NULL,
 total_cents INTEGER NOT NULL CHECK (total_cents > 0),
 opening INTEGER NOT NULL DEFAULT 0 CHECK (opening IN (0, 1)),
 journal_id TEXT REFERENCES pt_journal_entries(id),
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 issued_by TEXT,
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE TABLE pt_invoice_lines (
 id TEXT PRIMARY KEY,
 invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
 line_no INTEGER NOT NULL,
 description TEXT NOT NULL,
 quantity_milli INTEGER NOT NULL CHECK (quantity_milli > 0),
 unit_cents INTEGER NOT NULL CHECK (unit_cents >= 0),
 amount_cents INTEGER NOT NULL,
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 tax_code TEXT,
 tax_cents INTEGER NOT NULL DEFAULT 0,
 UNIQUE (invoice_id, line_no)
);

CREATE TABLE pt_bills (
 id TEXT PRIMARY KEY,
 vendor_id TEXT NOT NULL REFERENCES pt_contacts(id),
 reference TEXT NOT NULL,
 bill_date TEXT NOT NULL,
 due_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('draft', 'posted', 'void')),
 memo TEXT NOT NULL DEFAULT '',
 total_cents INTEGER NOT NULL CHECK (total_cents > 0),
 opening INTEGER NOT NULL DEFAULT 0 CHECK (opening IN (0, 1)),
 evidence_waived TEXT,
 journal_id TEXT REFERENCES pt_journal_entries(id),
 prepared_by TEXT NOT NULL,
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL,
 UNIQUE (vendor_id, reference)
);

CREATE TABLE pt_bill_lines (
 id TEXT PRIMARY KEY,
 bill_id TEXT NOT NULL REFERENCES pt_bills(id),
 line_no INTEGER NOT NULL,
 description TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 UNIQUE (bill_id, line_no)
);

CREATE TABLE pt_bank_accounts (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL UNIQUE,
 account_id TEXT NOT NULL UNIQUE REFERENCES pt_accounts(id),
 institution TEXT NOT NULL,
 number_last4 TEXT NOT NULL CHECK (number_last4 GLOB '[0-9][0-9][0-9][0-9]'),
 routing TEXT NOT NULL DEFAULT '',
 opening_date TEXT NOT NULL,
 opening_cents INTEGER NOT NULL,
 revision TEXT NOT NULL
);

-- Externally completed money movement. Pantry records it; it never moves funds.
CREATE TABLE pt_payments (
 id TEXT PRIMARY KEY,
 direction TEXT NOT NULL CHECK (direction IN ('received', 'paid')),
 contact_id TEXT NOT NULL REFERENCES pt_contacts(id),
 payment_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 reference TEXT NOT NULL DEFAULT '',
 memo TEXT NOT NULL DEFAULT '',
 journal_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 reversal_id TEXT REFERENCES pt_journal_entries(id),
 recorded_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);

CREATE TABLE pt_allocations (
 id TEXT PRIMARY KEY,
 source_kind TEXT NOT NULL CHECK (source_kind IN ('payment', 'credit')),
 source_id TEXT NOT NULL,
 target_kind TEXT NOT NULL CHECK (target_kind IN ('invoice', 'bill')),
 target_id TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 allocation_date TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE INDEX pt_allocations_target ON pt_allocations(target_kind, target_id);
CREATE INDEX pt_allocations_source ON pt_allocations(source_kind, source_id);

CREATE TABLE pt_statements (
 id TEXT PRIMARY KEY,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 format TEXT NOT NULL CHECK (format IN ('csv', 'ofx')),
 source_name TEXT NOT NULL,
 source_sha256 TEXT NOT NULL,
 start_date TEXT NOT NULL,
 end_date TEXT NOT NULL,
 opening_cents INTEGER NOT NULL,
 closing_cents INTEGER NOT NULL,
 line_count INTEGER NOT NULL,
 duplicate_count INTEGER NOT NULL,
 document_id TEXT NOT NULL REFERENCES pt_documents(id),
 imported_by TEXT NOT NULL,
 imported_at TEXT NOT NULL,
 UNIQUE (bank_account_id, source_sha256)
);

CREATE TABLE pt_bank_lines (
 id TEXT PRIMARY KEY,
 statement_id TEXT NOT NULL REFERENCES pt_statements(id),
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 posted_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL CHECK (amount_cents <> 0),
 description TEXT NOT NULL,
 reference TEXT NOT NULL DEFAULT '',
 fingerprint TEXT NOT NULL,
 UNIQUE (bank_account_id, fingerprint)
);
CREATE INDEX pt_bank_lines_date ON pt_bank_lines(bank_account_id, posted_date);

CREATE TABLE pt_matches (
 id TEXT PRIMARY KEY,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 status TEXT NOT NULL CHECK (status IN ('approved', 'undone')),
 proposal_id TEXT,
 note TEXT NOT NULL DEFAULT '',
 approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 reconciliation_id TEXT,
 revision TEXT NOT NULL
);
CREATE TABLE pt_match_bank_lines (
 match_id TEXT NOT NULL REFERENCES pt_matches(id),
 bank_line_id TEXT NOT NULL REFERENCES pt_bank_lines(id),
 active INTEGER NOT NULL CHECK (active IN (0, 1)),
 PRIMARY KEY (match_id, bank_line_id)
);
CREATE UNIQUE INDEX pt_match_bank_line_once ON pt_match_bank_lines(bank_line_id) WHERE active = 1;
CREATE TABLE pt_match_postings (
 match_id TEXT NOT NULL REFERENCES pt_matches(id),
 journal_line_id TEXT NOT NULL REFERENCES pt_journal_lines(id),
 active INTEGER NOT NULL CHECK (active IN (0, 1)),
 PRIMARY KEY (match_id, journal_line_id)
);
CREATE UNIQUE INDEX pt_match_posting_once ON pt_match_postings(journal_line_id) WHERE active = 1;

CREATE TABLE pt_reconciliations (
 id TEXT PRIMARY KEY,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 statement_id TEXT NOT NULL UNIQUE REFERENCES pt_statements(id),
 end_date TEXT NOT NULL,
 opening_cents INTEGER NOT NULL,
 closing_cents INTEGER NOT NULL,
 book_cents INTEGER NOT NULL,
 outstanding_cents INTEGER NOT NULL,
 proof TEXT NOT NULL,
 completed_by TEXT NOT NULL,
 completed_at TEXT NOT NULL
);

CREATE TABLE pt_close_tasks (
 id TEXT PRIMARY KEY,
 period TEXT NOT NULL,
 title TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('open', 'done')),
 note TEXT NOT NULL DEFAULT '',
 done_by TEXT,
 done_at TEXT,
 revision TEXT NOT NULL
);

CREATE TABLE pt_reopen_requests (
 id TEXT PRIMARY KEY,
 period TEXT NOT NULL REFERENCES pt_periods(id),
 reason TEXT NOT NULL,
 requested_by TEXT NOT NULL,
 requested_at TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected')),
 decided_by TEXT,
 decided_at TEXT,
 period_revision TEXT NOT NULL
);

CREATE TABLE pt_proposals (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL REFERENCES pt_agents(id),
 kind TEXT NOT NULL CHECK (kind IN ('match', 'journal', 'close-packet', 'variance-note')),
 summary TEXT NOT NULL,
 payload TEXT NOT NULL,
 refs TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('proposed', 'approved', 'rejected', 'stale')),
 decided_by TEXT,
 decided_at TEXT,
 decision_note TEXT NOT NULL DEFAULT '',
 result_kind TEXT,
 result_id TEXT,
 created_at TEXT NOT NULL,
 revision TEXT NOT NULL
);

-- Approved management narratives, kept beside (never inside) calculated reports.
CREATE TABLE pt_notes (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('variance', 'close-packet')),
 period TEXT NOT NULL,
 body TEXT NOT NULL,
 evidence TEXT NOT NULL,
 proposal_id TEXT REFERENCES pt_proposals(id),
 approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL
);

CREATE TABLE pt_approvals (
 id TEXT PRIMARY KEY,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 subject_revision TEXT NOT NULL,
 action TEXT NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
 actor_email TEXT NOT NULL,
 note TEXT NOT NULL DEFAULT '',
 at TEXT NOT NULL
);

CREATE TABLE pt_audit (
 id TEXT PRIMARY KEY,
 at TEXT NOT NULL,
 actor_email TEXT NOT NULL,
 actor_kind TEXT NOT NULL CHECK (actor_kind IN ('person', 'agent')),
 action TEXT NOT NULL,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 detail TEXT NOT NULL DEFAULT '{}'
);
CREATE INDEX pt_audit_at ON pt_audit(at);

-- QuickBooks Online cutover: the read-only historical GL archive and the
-- cutover itself. Opening balances are a draft opening entry until sign-off.
CREATE TABLE pt_cutovers (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK (source IN ('quickbooks-online')),
 cutover_date TEXT NOT NULL,
 opening_entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 summary TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('staged', 'accepted')),
 accepted_by TEXT,
 accepted_at TEXT,
 revision TEXT NOT NULL
);

CREATE TABLE pt_history_lines (
 id TEXT PRIMARY KEY,
 cutover_id TEXT NOT NULL,
 account TEXT NOT NULL,
 txn_date TEXT NOT NULL,
 txn_type TEXT NOT NULL,
 num TEXT NOT NULL,
 name TEXT NOT NULL,
 memo TEXT NOT NULL,
 split TEXT NOT NULL,
 amount_cents INTEGER NOT NULL,
 source_row INTEGER NOT NULL,
 revision TEXT NOT NULL
);
