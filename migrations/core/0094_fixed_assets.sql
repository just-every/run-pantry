-- Human-reviewed fixed assets; tax elections remain separate from the ledger.
CREATE TABLE pt_asset_settings(id INTEGER PRIMARY KEY CHECK(id=1),threshold_cents INTEGER,safe_harbor TEXT NOT NULL DEFAULT 'Not elected',tax_year INTEGER,revision TEXT NOT NULL);
INSERT INTO pt_asset_settings(id,revision)VALUES(1,'initial');
CREATE TABLE pt_assets(
 id TEXT PRIMARY KEY,name TEXT NOT NULL,bill_id TEXT NOT NULL REFERENCES pt_bills(id),bill_line_id TEXT NOT NULL UNIQUE REFERENCES pt_bill_lines(id),
 source_journal_id TEXT NOT NULL REFERENCES pt_journal_entries(id),capitalization_journal_id TEXT REFERENCES pt_journal_entries(id),
 cost_cents INTEGER NOT NULL CHECK(cost_cents>0),residual_cents INTEGER NOT NULL CHECK(residual_cents>=0 AND residual_cents<cost_cents),
 placed_date TEXT NOT NULL,months INTEGER NOT NULL CHECK(months BETWEEN 1 AND 1200),method TEXT NOT NULL CHECK(method IN('straight-line','declining-balance')),
 asset_account_id TEXT NOT NULL REFERENCES pt_accounts(id),accumulated_account_id TEXT NOT NULL REFERENCES pt_accounts(id),expense_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 class_name TEXT NOT NULL DEFAULT '',location_name TEXT NOT NULL DEFAULT '',project_name TEXT NOT NULL DEFAULT '',
 disposed_date TEXT,disposal_journal_id TEXT REFERENCES pt_journal_entries(id),created_by TEXT NOT NULL,created_at TEXT NOT NULL,revision TEXT NOT NULL
);
CREATE TABLE pt_asset_depreciation(asset_id TEXT NOT NULL REFERENCES pt_assets(id),occurrence TEXT NOT NULL,amount_cents INTEGER NOT NULL CHECK(amount_cents>0),recurring_id TEXT NOT NULL UNIQUE REFERENCES pt_recurring_journals(id),PRIMARY KEY(asset_id,occurrence));
CREATE TABLE pt_asset_tax(asset_id TEXT PRIMARY KEY REFERENCES pt_assets(id),election_year INTEGER NOT NULL,section179_cents INTEGER NOT NULL CHECK(section179_cents>=0),bonus_cents INTEGER NOT NULL CHECK(bonus_cents>=0),method TEXT NOT NULL CHECK(method IN('none','MACRS','accountant-entered')),schedule TEXT NOT NULL CHECK(json_valid(schedule)),note TEXT NOT NULL,updated_by TEXT NOT NULL,updated_at TEXT NOT NULL,revision TEXT NOT NULL);
-- A recurring journal bound to the asset's reviewed book plan may be paused
-- or approved, but cannot silently become a different asset's accounting.
CREATE TRIGGER pt_asset_template_immutable BEFORE UPDATE ON pt_recurring_journals
WHEN EXISTS(SELECT 1 FROM pt_asset_depreciation WHERE recurring_id=OLD.id)
 AND (NEW.lines IS NOT OLD.lines OR NEW.start_date IS NOT OLD.start_date OR NEW.end_date IS NOT OLD.end_date OR NEW.mode IS NOT OLD.mode OR NEW.every IS NOT OLD.every OR NEW.cadence IS NOT OLD.cadence)
BEGIN SELECT RAISE(ABORT,'Asset depreciation plan is retained; reverse incorrect postings and prepare a reviewed correction'); END;
CREATE TRIGGER pt_asset_depreciation_source BEFORE UPDATE OF status ON pt_journal_entries
WHEN NEW.status='posted' AND OLD.status='draft' AND EXISTS(SELECT 1 FROM pt_asset_depreciation WHERE recurring_id=NEW.source_id)
 AND NOT EXISTS(SELECT 1 FROM pt_asset_depreciation d JOIN pt_assets a ON a.id=d.asset_id JOIN pt_journal_entries s ON s.id=a.source_journal_id
 WHERE d.recurring_id=NEW.source_id AND d.occurrence=NEW.entry_date AND s.status='posted' AND s.reversed_by_id IS NULL
 AND (a.disposed_date IS NULL OR NEW.entry_date<a.disposed_date)
 AND (a.capitalization_journal_id IS NULL OR EXISTS(SELECT 1 FROM pt_journal_entries j WHERE j.id=a.capitalization_journal_id AND j.status='posted' AND j.reversed_by_id IS NULL)))
BEGIN SELECT RAISE(ABORT,'Asset source reversed or disposed; review the retained depreciation plan'); END;
