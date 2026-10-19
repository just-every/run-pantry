-- The adjusting designation belongs to the exact journal revision approved.
ALTER TABLE pt_journal_entries ADD COLUMN adjusting INTEGER NOT NULL DEFAULT 0 CHECK (adjusting IN (0, 1));

-- Separate from the general immutability trigger so even a reversal-link
-- update cannot change this designation on posted history.
CREATE TRIGGER pt_entries_adjusting_immutable BEFORE UPDATE OF adjusting ON pt_journal_entries
WHEN OLD.status = 'posted' AND NEW.adjusting IS NOT OLD.adjusting
BEGIN SELECT RAISE(ABORT, 'PANTRY_POSTED_IMMUTABLE'); END;

CREATE TRIGGER pt_entries_adjusting_insert BEFORE INSERT ON pt_journal_entries
WHEN NEW.adjusting = 1
BEGIN
 SELECT RAISE(ABORT, 'PANTRY_ADJUSTING_YEAR_END') WHERE
  NEW.source_kind <> 'manual'
  OR NEW.entry_date IS NOT date(NEW.entry_date, 'start of month', '+1 month', '-1 day')
  OR CAST(strftime('%m', date(NEW.entry_date, '+1 day')) AS INTEGER)
     IS NOT (SELECT fiscal_year_start FROM pt_entity WHERE id = 1);
END;

-- Also runs on posting: a draft must still fit the entity's fiscal year when
-- approved, even if the business's settings changed after it was prepared.
CREATE TRIGGER pt_entries_adjusting_update BEFORE UPDATE ON pt_journal_entries
WHEN NEW.adjusting = 1 AND OLD.status = 'draft'
BEGIN
 SELECT RAISE(ABORT, 'PANTRY_ADJUSTING_YEAR_END') WHERE
  NEW.source_kind <> 'manual'
  OR NEW.entry_date IS NOT date(NEW.entry_date, 'start of month', '+1 month', '-1 day')
  OR CAST(strftime('%m', date(NEW.entry_date, '+1 day')) AS INTEGER)
     IS NOT (SELECT fiscal_year_start FROM pt_entity WHERE id = 1);
END;
