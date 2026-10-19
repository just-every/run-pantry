-- A transfer has one balanced entry and one match on each account. Pending
-- halves reserve their lines from automatic expense/income rules.
CREATE TABLE pt_transfer_pairs (
 id TEXT PRIMARY KEY,
 outgoing_line_id TEXT NOT NULL REFERENCES pt_bank_lines(id),
 incoming_line_id TEXT NOT NULL REFERENCES pt_bank_lines(id),
 journal_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 outgoing_match_id TEXT NOT NULL REFERENCES pt_matches(id),
 incoming_match_id TEXT NOT NULL REFERENCES pt_matches(id),
 created_entry INTEGER NOT NULL CHECK(created_entry IN (0, 1)),
 status TEXT NOT NULL CHECK(status IN ('paired', 'undone')),
 created_at TEXT NOT NULL,
 undone_by TEXT,
 undone_at TEXT,
 reason TEXT,
 CHECK(outgoing_line_id <> incoming_line_id)
);
CREATE UNIQUE INDEX pt_transfer_out_once ON pt_transfer_pairs(outgoing_line_id) WHERE status = 'paired';
CREATE UNIQUE INDEX pt_transfer_in_once ON pt_transfer_pairs(incoming_line_id) WHERE status = 'paired';
CREATE TABLE pt_transfer_halves (
 bank_line_id TEXT PRIMARY KEY REFERENCES pt_bank_lines(id),
 expected_bank_account_id TEXT REFERENCES pt_bank_accounts(id),
 basis TEXT NOT NULL,
 due_date TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('pending', 'exception', 'paired', 'dismissed')),
 pair_id TEXT REFERENCES pt_transfer_pairs(id),
 detected_at TEXT NOT NULL,
 reason TEXT,
 revision TEXT NOT NULL
);
CREATE INDEX pt_transfer_waiting ON pt_transfer_halves(status, due_date);
-- Direct match.undo cannot leave one side of an automatic pair active. The
-- transfer command first marks the pair undone, then releases both matches.
CREATE TRIGGER pt_transfer_match_undo BEFORE UPDATE OF status ON pt_matches
WHEN NEW.status = 'undone' AND EXISTS (SELECT 1 FROM pt_transfer_pairs p WHERE p.status = 'paired' AND OLD.id IN (p.outgoing_match_id, p.incoming_match_id))
BEGIN SELECT RAISE(ABORT, 'CHECK constraint failed: ok = 1'); END;
