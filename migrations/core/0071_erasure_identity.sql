-- ERASURE-001 identity copies. A scope is meaningful only with its matching
-- journal; the application creates both and removes scopes in one D1 batch.
-- Delete fences and all other financial/approval/period triggers stay intact.
DROP TRIGGER pt_entries_posted_update;
CREATE TRIGGER pt_entries_posted_update BEFORE UPDATE ON pt_journal_entries
WHEN
 (EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
   WHERE s.table_name='pt_journal_entries' AND s.row_id=OLD.id AND s.operation='redact')
  AND (NEW.id IS NOT OLD.id OR NEW.number IS NOT OLD.number OR NEW.entry_date IS NOT OLD.entry_date
   OR NEW.memo IS NOT OLD.memo OR NEW.source_kind IS NOT OLD.source_kind OR NEW.source_id IS NOT OLD.source_id
   OR NEW.status IS NOT OLD.status OR NEW.prepared_kind IS NOT OLD.prepared_kind OR NEW.proposal_id IS NOT OLD.proposal_id
   OR NEW.document_id IS NOT OLD.document_id OR NEW.posted_at IS NOT OLD.posted_at OR NEW.reverses_id IS NOT OLD.reverses_id
   OR NEW.reversed_by_id IS NOT OLD.reversed_by_id OR NEW.revision IS NOT OLD.revision
   OR NEW.created_at IS NOT OLD.created_at OR NEW.adjusting IS NOT OLD.adjusting))
 OR (OLD.status='posted'
  AND NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
   WHERE s.table_name='pt_journal_entries' AND s.row_id=OLD.id AND s.operation='redact')
  AND NOT (
   OLD.reversed_by_id IS NULL AND NEW.reversed_by_id IS NOT NULL
   AND NEW.id=OLD.id AND NEW.number IS OLD.number AND NEW.entry_date=OLD.entry_date AND NEW.memo=OLD.memo
   AND NEW.status=OLD.status AND NEW.source_kind=OLD.source_kind AND NEW.source_id IS OLD.source_id
   AND NEW.posted_by IS OLD.posted_by AND NEW.posted_at IS OLD.posted_at AND NEW.reverses_id IS OLD.reverses_id))
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;

DROP TRIGGER pt_reconciliation_undos_immutable_update;
CREATE TRIGGER pt_reconciliation_undos_immutable_update BEFORE UPDATE ON pt_reconciliation_undos
WHEN NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_reconciliation_undos' AND s.row_id=OLD.id AND s.operation='redact')
 OR NEW.id IS NOT OLD.id OR NEW.bank_account_id IS NOT OLD.bank_account_id
 OR NEW.target_statement_id IS NOT OLD.target_statement_id OR NEW.undone_at IS NOT OLD.undone_at
BEGIN SELECT RAISE(ABORT, 'Reconciliation undos are immutable'); END;

DROP TRIGGER pt_voided_reconciliations_immutable_update;
CREATE TRIGGER pt_voided_reconciliations_immutable_update BEFORE UPDATE ON pt_voided_reconciliations
WHEN NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_voided_reconciliations' AND s.row_id=OLD.id AND s.operation='redact')
 OR NEW.id IS NOT OLD.id OR NEW.undo_id IS NOT OLD.undo_id OR NEW.sequence IS NOT OLD.sequence
 OR NEW.bank_account_id IS NOT OLD.bank_account_id OR NEW.statement_id IS NOT OLD.statement_id
 OR NEW.end_date IS NOT OLD.end_date
BEGIN SELECT RAISE(ABORT, 'Voided proofs are immutable'); END;

DROP TRIGGER pt_line_suggestion_no_update;
CREATE TRIGGER pt_line_suggestion_no_update BEFORE UPDATE ON pt_line_suggestion_decisions
WHEN NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
  WHERE s.table_name='pt_line_suggestion_decisions' AND s.row_id=OLD.bank_line_id AND s.operation='redact')
 OR NEW.bank_line_id IS NOT OLD.bank_line_id OR NEW.source IS NOT OLD.source OR NEW.source_id IS NOT OLD.source_id
 OR NEW.suggested_account_id IS NOT OLD.suggested_account_id OR NEW.selected_account_ids IS NOT OLD.selected_account_ids
 OR NEW.outcome IS NOT OLD.outcome OR NEW.decided_at IS NOT OLD.decided_at OR NEW.audit_id IS NOT OLD.audit_id
BEGIN SELECT RAISE(ABORT, 'Suggestion decisions are immutable'); END;

DROP TRIGGER pt_rule_filing_evidence_immutable;
CREATE TRIGGER pt_rule_filing_evidence_immutable BEFORE UPDATE ON pt_matches
WHEN
 (EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
   WHERE s.table_name='pt_matches' AND s.row_id=OLD.id AND s.operation='redact')
  AND (NEW.id IS NOT OLD.id OR NEW.bank_account_id IS NOT OLD.bank_account_id OR NEW.status IS NOT OLD.status
   OR NEW.proposal_id IS NOT OLD.proposal_id OR NEW.note IS NOT OLD.note OR NEW.approved_by IS NOT OLD.approved_by
   OR NEW.approved_at IS NOT OLD.approved_at OR NEW.reconciliation_id IS NOT OLD.reconciliation_id
   OR NEW.revision IS NOT OLD.revision OR NEW.rule_id IS NOT OLD.rule_id OR NEW.automatic IS NOT OLD.automatic
   OR NEW.payment_id IS NOT OLD.payment_id OR NEW.rule_revision IS NOT OLD.rule_revision))
 OR (OLD.rule_snapshot IS NOT NULL
  AND (NEW.rule_id IS NOT OLD.rule_id OR NEW.rule_revision IS NOT OLD.rule_revision OR NEW.rule_snapshot IS NOT OLD.rule_snapshot)
  AND NOT EXISTS (SELECT 1 FROM pt_erasure_scope s JOIN pt_erasure_journal j ON j.id=s.erasure_id
   WHERE s.table_name='pt_matches' AND s.row_id=OLD.id AND s.operation='redact'))
BEGIN SELECT RAISE(ABORT, 'Rule filing evidence is immutable'); END;
