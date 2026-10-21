-- CLOSE-004 continuous checks. Daily runs raise flags that cite their lines and the
-- rule and setting that raised them. A dismissal keeps the exact lines it was made
-- on, so a flag whose lines change opens again. `pt_check_watch` remembers the first
-- day a time-based condition (a processor clearing difference) was seen.
ALTER TABLE pt_accounts ADD COLUMN suspense INTEGER NOT NULL DEFAULT 0 CHECK (suspense IN (0, 1));
CREATE TABLE pt_check_settings (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 settings TEXT NOT NULL CHECK (json_valid(settings)),
 revision TEXT NOT NULL,
 updated_by TEXT,
 updated_at TEXT,
 last_run_on TEXT,
 last_run_at TEXT
);
INSERT INTO pt_check_settings (id, settings, revision) VALUES (1, '{}', 'initial');
CREATE TABLE pt_check_flags (
 id TEXT PRIMARY KEY,
 rule TEXT NOT NULL,
 subject TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('open', 'dismissed', 'cleared')),
 signature TEXT NOT NULL,
 title TEXT NOT NULL,
 detail TEXT NOT NULL,
 setting TEXT NOT NULL CHECK (json_valid(setting)),
 lines TEXT NOT NULL CHECK (json_valid(lines)),
 first_flagged_on TEXT NOT NULL,
 last_seen_on TEXT NOT NULL,
 cleared_on TEXT,
 dismissed_by TEXT,
 dismissed_at TEXT,
 dismissed_reason TEXT,
 dismissed_signature TEXT,
 revision TEXT NOT NULL,
 UNIQUE (rule, subject)
);
CREATE INDEX pt_check_flags_status ON pt_check_flags(status, rule);
CREATE TABLE pt_check_watch (
 key TEXT PRIMARY KEY,
 since TEXT NOT NULL
);
