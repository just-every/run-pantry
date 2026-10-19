-- Existing schedules remain monthly. Remove the original interval ceiling so
-- an every-N-weeks schedule includes quarterly (13-week) intervals as well.
ALTER TABLE pt_recurring_journals ADD COLUMN cadence TEXT NOT NULL DEFAULT 'month' CHECK (cadence IN ('day', 'week', 'month'));
ALTER TABLE pt_recurring_journals RENAME COLUMN every TO old_interval;
ALTER TABLE pt_recurring_journals ADD COLUMN every INTEGER NOT NULL DEFAULT 1 CHECK (every >= 1);
UPDATE pt_recurring_journals SET every = old_interval;
ALTER TABLE pt_recurring_journals DROP COLUMN old_interval;
