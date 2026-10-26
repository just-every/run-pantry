-- A terminal invoice action retains its immutable issued document and posting.
-- Readers project the terminal state; dated reports retain the original sale
-- until its linked reversal date.
ALTER TABLE pt_invoices ADD COLUMN void_date TEXT;
ALTER TABLE pt_invoices ADD COLUMN void_reason TEXT;
ALTER TABLE pt_invoices ADD COLUMN void_reversal_id TEXT REFERENCES pt_journal_entries(id);
ALTER TABLE pt_invoices ADD COLUMN voided_by TEXT;
CREATE TRIGGER pt_invoice_void_terminal BEFORE UPDATE ON pt_invoices
WHEN OLD.void_date IS NOT NULL AND (
 NEW.void_date IS NOT OLD.void_date OR NEW.void_reason IS NOT OLD.void_reason OR
 NEW.void_reversal_id IS NOT OLD.void_reversal_id OR NEW.voided_by IS NOT OLD.voided_by OR
 NEW.status IS NOT OLD.status OR NEW.journal_id IS NOT OLD.journal_id OR
 NEW.customer_id IS NOT OLD.customer_id OR NEW.total_cents IS NOT OLD.total_cents
) BEGIN SELECT RAISE(ABORT,'Voided invoice is retained'); END;

CREATE TRIGGER pt_void_invoice_no_allocation BEFORE INSERT ON pt_allocations
WHEN NEW.target_kind='invoice' AND EXISTS(SELECT 1 FROM pt_invoices WHERE id=NEW.target_id AND void_date IS NOT NULL)
BEGIN SELECT RAISE(ABORT,'Voided invoice is retained'); END;
