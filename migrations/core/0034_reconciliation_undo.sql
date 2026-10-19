-- Completed proofs remain immutable history when a reconciliation is undone.
CREATE TABLE pt_reconciliation_undos (
 id TEXT PRIMARY KEY,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 target_statement_id TEXT NOT NULL REFERENCES pt_statements(id),
 reason TEXT NOT NULL,
 undone_by TEXT NOT NULL,
 undone_at TEXT NOT NULL
);
CREATE TABLE pt_voided_reconciliations (
 id TEXT PRIMARY KEY,
 undo_id TEXT NOT NULL REFERENCES pt_reconciliation_undos(id),
 sequence INTEGER NOT NULL,
 bank_account_id TEXT NOT NULL REFERENCES pt_bank_accounts(id),
 statement_id TEXT NOT NULL REFERENCES pt_statements(id),
 end_date TEXT NOT NULL,
 snapshot TEXT NOT NULL,
 UNIQUE (undo_id, sequence)
);
CREATE TRIGGER pt_voided_reconciliations_immutable_update BEFORE UPDATE ON pt_voided_reconciliations BEGIN SELECT RAISE(ABORT, 'Voided proofs are immutable'); END;
CREATE TRIGGER pt_voided_reconciliations_immutable_delete BEFORE DELETE ON pt_voided_reconciliations BEGIN SELECT RAISE(ABORT, 'Voided proofs are immutable'); END;
CREATE TRIGGER pt_reconciliation_undos_immutable_update BEFORE UPDATE ON pt_reconciliation_undos BEGIN SELECT RAISE(ABORT, 'Reconciliation undos are immutable'); END;
CREATE TRIGGER pt_reconciliation_undos_immutable_delete BEFORE DELETE ON pt_reconciliation_undos BEGIN SELECT RAISE(ABORT, 'Reconciliation undos are immutable'); END;
