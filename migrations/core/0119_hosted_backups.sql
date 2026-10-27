-- Operational backup receipts stay with this installation, outside its archive.
CREATE TABLE pt_hosted_backup_runs (
  day TEXT PRIMARY KEY,
  job_id TEXT,
  object_key TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','building','complete')),
  lease_id TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  content_hash TEXT,
  error_code TEXT
);
