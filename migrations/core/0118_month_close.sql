-- Recurring preparation is explicit owner consent; existing approvals still govern posting.
CREATE TABLE pt_month_close_schedules (
 agent_id TEXT NOT NULL REFERENCES pt_agents(id),
 period TEXT NOT NULL,
 enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
 approved_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY (agent_id, period)
);
ALTER TABLE pt_close_tasks ADD COLUMN judgment_kind TEXT;
ALTER TABLE pt_close_tasks ADD COLUMN proposal_id TEXT;
