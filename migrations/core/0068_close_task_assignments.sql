-- Assignment is coordination, not a new grant. Existing recording/lock authority applies.
ALTER TABLE pt_close_tasks ADD COLUMN assignee TEXT;
ALTER TABLE pt_close_tasks ADD COLUMN due_date TEXT;
CREATE INDEX pt_close_tasks_period_status ON pt_close_tasks(period, status);
