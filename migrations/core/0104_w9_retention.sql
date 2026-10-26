-- Clear tax evidence in the authorized expiry update, before identity becomes immutable.
DROP TRIGGER pt_w9_tax_erased;
CREATE TRIGGER pt_w9_expiry_evidence BEFORE UPDATE OF erased_at ON pt_contractor_tax
WHEN NEW.erased_at IS NOT NULL AND (NEW.w9_evidence_sealed IS NOT NULL OR NEW.w9_evidence_history <> '[]' OR NEW.w9_completed_at IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'PANTRY_W9_EXPIRY_EVIDENCE'); END;
CREATE TRIGGER pt_w9_erased_evidence_immutable BEFORE UPDATE ON pt_contractor_tax
WHEN OLD.erased_at IS NOT NULL AND (NEW.w9_evidence_sealed IS NOT OLD.w9_evidence_sealed OR NEW.w9_evidence_history IS NOT OLD.w9_evidence_history OR NEW.w9_completed_at IS NOT OLD.w9_completed_at)
BEGIN SELECT RAISE(ABORT,'PANTRY_ERASED_IMMUTABLE'); END;
