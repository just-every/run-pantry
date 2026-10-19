-- Economic nexus watch (SALESTAX-004). One open alert per state and level;
-- an alert resolves when the measure falls back below its level, and a later
-- crossing raises a new one. Decisions are the accountant's, kept in full.
CREATE TABLE pt_nexus_alerts (
 id TEXT PRIMARY KEY,
 state TEXT NOT NULL,
 level INTEGER NOT NULL CHECK (level IN (80, 100)),
 period TEXT NOT NULL,
 sales_cents INTEGER NOT NULL,
 transactions INTEGER NOT NULL,
 threshold_version TEXT NOT NULL,
 raised_at TEXT NOT NULL,
 resolved_at TEXT,
 recipients TEXT NOT NULL DEFAULT '[]',
 email_status TEXT NOT NULL DEFAULT 'pending',
 email_detail TEXT NOT NULL DEFAULT ''
);
CREATE UNIQUE INDEX pt_nexus_alerts_open ON pt_nexus_alerts(state, level) WHERE resolved_at IS NULL;

CREATE TABLE pt_nexus_decisions (
 id TEXT PRIMARY KEY,
 state TEXT NOT NULL,
 decision TEXT NOT NULL CHECK (decision IN ('register', 'not-required', 'monitor')),
 note TEXT NOT NULL,
 period TEXT NOT NULL,
 sales_cents INTEGER NOT NULL,
 transactions INTEGER NOT NULL,
 reached_bp INTEGER NOT NULL,
 threshold_version TEXT NOT NULL,
 decided_by TEXT NOT NULL,
 decided_at TEXT NOT NULL
);
CREATE INDEX pt_nexus_decisions_state ON pt_nexus_decisions(state, decided_at);
