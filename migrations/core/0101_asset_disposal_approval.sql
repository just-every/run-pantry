-- A disposal is a one-date CLOSE-001 journal template: its gain or loss posts
-- only after ordinary exact-revision approval of the reviewed snapshot.
CREATE TABLE pt_asset_disposals(
 recurring_id TEXT PRIMARY KEY REFERENCES pt_recurring_journals(id),asset_id TEXT NOT NULL REFERENCES pt_assets(id),
 disposal_date TEXT NOT NULL,proceeds_cents INTEGER NOT NULL CHECK(proceeds_cents>=0),
 accumulated_cents INTEGER NOT NULL CHECK(accumulated_cents>=0),gain_cents INTEGER NOT NULL,prepared_at TEXT NOT NULL
);
CREATE INDEX pt_asset_disposals_asset ON pt_asset_disposals(asset_id,prepared_at);
CREATE TRIGGER pt_asset_disposal_template_immutable BEFORE UPDATE ON pt_recurring_journals
WHEN EXISTS(SELECT 1 FROM pt_asset_disposals WHERE recurring_id=OLD.id)
 AND (NEW.lines IS NOT OLD.lines OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.mode IS NOT OLD.mode OR NEW.every IS NOT OLD.every OR NEW.cadence IS NOT OLD.cadence)
BEGIN SELECT RAISE(ABORT,'PANTRY_ASSET_DISPOSAL a prepared disposal is retained; prepare a new one'); END;
-- The approved snapshot posts only while the asset, its source and its posted
-- depreciation are exactly what the owner reviewed.
CREATE TRIGGER pt_asset_disposal_source BEFORE UPDATE OF status ON pt_journal_entries
WHEN NEW.status='posted' AND OLD.status='draft' AND EXISTS(SELECT 1 FROM pt_asset_disposals WHERE recurring_id=NEW.source_id)
 AND NOT EXISTS(SELECT 1 FROM pt_asset_disposals x JOIN pt_assets a ON a.id=x.asset_id JOIN pt_journal_entries s ON s.id=a.source_journal_id
 WHERE x.recurring_id=NEW.source_id AND x.disposal_date=NEW.entry_date AND a.disposed_date IS NULL AND s.status='posted' AND s.reversed_by_id IS NULL
 AND (a.capitalization_journal_id IS NULL OR EXISTS(SELECT 1 FROM pt_journal_entries j WHERE j.id=a.capitalization_journal_id AND j.status='posted' AND j.reversed_by_id IS NULL))
 AND x.accumulated_cents=(SELECT COALESCE(SUM(d.amount_cents),0) FROM pt_asset_depreciation d JOIN pt_recurring_journal_runs r ON r.recurring_id=d.recurring_id JOIN pt_journal_entries j ON j.id=r.journal_id WHERE d.asset_id=a.id AND j.status='posted' AND j.reversed_by_id IS NULL)
 AND NOT EXISTS(SELECT 1 FROM pt_asset_depreciation d JOIN pt_recurring_journal_runs r ON r.recurring_id=d.recurring_id JOIN pt_journal_entries j ON j.id=r.journal_id WHERE d.asset_id=a.id AND j.status='posted' AND j.reversed_by_id IS NULL AND j.entry_date>NEW.entry_date))
BEGIN SELECT RAISE(ABORT,'PANTRY_ASSET_DISPOSAL the asset, its source or its depreciation changed'); END;
-- Posting the disposal retires the asset and stops its later book entries and
-- any other prepared disposal, whichever runner posted it.
CREATE TRIGGER pt_asset_disposal_posted AFTER UPDATE OF status ON pt_journal_entries
WHEN NEW.status='posted' AND OLD.status='draft' AND EXISTS(SELECT 1 FROM pt_asset_disposals WHERE recurring_id=NEW.source_id)
BEGIN
 UPDATE pt_assets SET disposed_date=NEW.entry_date,disposal_journal_id=NEW.id,revision=lower(hex(randomblob(16))) WHERE id=(SELECT asset_id FROM pt_asset_disposals WHERE recurring_id=NEW.source_id);
 UPDATE pt_recurring_journals SET status='paused' WHERE status IN('active','awaiting-approval') AND (
  id IN(SELECT d.recurring_id FROM pt_asset_depreciation d WHERE d.asset_id=(SELECT asset_id FROM pt_asset_disposals WHERE recurring_id=NEW.source_id) AND d.occurrence>=NEW.entry_date)
  OR id IN(SELECT y.recurring_id FROM pt_asset_disposals y WHERE y.asset_id=(SELECT asset_id FROM pt_asset_disposals WHERE recurring_id=NEW.source_id) AND y.recurring_id<>NEW.source_id));
END;
