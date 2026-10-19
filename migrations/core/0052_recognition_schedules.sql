-- Recognition plans allocate real funding lines and retain exact-revision runs.
CREATE TABLE pt_recognition_schedules (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('prepaid', 'accrual', 'deferred')),
 name TEXT NOT NULL,
 balance_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 recognition_account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 amount_cents INTEGER NOT NULL CHECK (amount_cents > 0),
 start_date TEXT NOT NULL,
 months INTEGER CHECK (months > 0),
 plan TEXT NOT NULL CHECK (json_valid(plan)),
 source_journal_id TEXT REFERENCES pt_journal_entries(id),
 source_line_id TEXT UNIQUE REFERENCES pt_journal_lines(id),
 source_date TEXT,
 status TEXT NOT NULL CHECK (status IN ('awaiting-approval', 'active', 'ended')),
 prepared_by TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 approved_snapshot TEXT,
 revision TEXT NOT NULL,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 CHECK ((kind = 'accrual' AND source_line_id IS NULL AND source_journal_id IS NULL) OR (kind <> 'accrual' AND source_line_id IS NOT NULL AND source_journal_id IS NOT NULL))
);
CREATE TABLE pt_recognition_runs (
 schedule_id TEXT NOT NULL REFERENCES pt_recognition_schedules(id),
 revision TEXT NOT NULL,
 occurrence TEXT NOT NULL,
 scheduled_date TEXT NOT NULL,
 entry_date TEXT NOT NULL,
 snapshot TEXT NOT NULL CHECK (json_valid(snapshot)),
 journal_id TEXT UNIQUE REFERENCES pt_journal_entries(id),
 status TEXT NOT NULL CHECK (status IN ('posted', 'blocked', 'failed')),
 detail TEXT NOT NULL,
 at TEXT NOT NULL,
 PRIMARY KEY (schedule_id, revision, occurrence)
);
CREATE TABLE pt_recognition_milestones (
 schedule_id TEXT NOT NULL REFERENCES pt_recognition_schedules(id),
 revision TEXT NOT NULL,
 occurrence TEXT NOT NULL,
 achieved_date TEXT NOT NULL,
 recorded_by TEXT NOT NULL,
 recorded_at TEXT NOT NULL,
 PRIMARY KEY (schedule_id, revision, occurrence)
);
CREATE INDEX pt_recognition_runs_date ON pt_recognition_runs(entry_date);
-- A successful plan is corrected through a new plan or journal, never rewritten.
CREATE TRIGGER pt_recognition_plan_frozen BEFORE UPDATE ON pt_recognition_schedules
WHEN EXISTS (SELECT 1 FROM pt_recognition_runs WHERE schedule_id = OLD.id AND status = 'posted')
 AND (NEW.revision <> OLD.revision OR NEW.plan <> OLD.plan OR NEW.amount_cents <> OLD.amount_cents
 OR NEW.kind <> OLD.kind OR NEW.name <> OLD.name OR NEW.start_date <> OLD.start_date
 OR NEW.months IS NOT OLD.months OR NEW.source_line_id IS NOT OLD.source_line_id
 OR NEW.source_journal_id IS NOT OLD.source_journal_id OR NEW.source_date IS NOT OLD.source_date
 OR NEW.balance_account_id <> OLD.balance_account_id OR NEW.recognition_account_id <> OLD.recognition_account_id)
BEGIN SELECT RAISE(ABORT, 'PANTRY_RECOGNITION_PLAN_FROZEN'); END;
CREATE TRIGGER pt_recognition_run_immutable BEFORE UPDATE ON pt_recognition_runs
WHEN OLD.status = 'posted'
BEGIN SELECT RAISE(ABORT, 'PANTRY_RECOGNITION_RUN_IMMUTABLE'); END;
CREATE TRIGGER pt_recognition_run_no_delete BEFORE DELETE ON pt_recognition_runs
BEGIN SELECT RAISE(ABORT, 'PANTRY_RECOGNITION_RUN_IMMUTABLE'); END;
CREATE TRIGGER pt_recognition_milestone_immutable BEFORE UPDATE ON pt_recognition_milestones
BEGIN SELECT RAISE(ABORT, 'PANTRY_RECOGNITION_MILESTONE_IMMUTABLE'); END;
CREATE TRIGGER pt_recognition_milestone_no_delete BEFORE DELETE ON pt_recognition_milestones
BEGIN SELECT RAISE(ABORT, 'PANTRY_RECOGNITION_MILESTONE_IMMUTABLE'); END;
