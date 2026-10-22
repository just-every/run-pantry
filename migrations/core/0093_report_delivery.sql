-- Private report attachments are deliberately separate from general documents.
CREATE TABLE pt_report_allowlist (
 email TEXT PRIMARY KEY, active INTEGER NOT NULL CHECK(active IN(0,1)),
 note TEXT NOT NULL, revision TEXT NOT NULL, approved_by TEXT NOT NULL, approved_at TEXT NOT NULL
);
CREATE TABLE pt_report_schedules (
 id TEXT PRIMARY KEY, revision TEXT NOT NULL, name TEXT NOT NULL, selection TEXT NOT NULL,
 format TEXT NOT NULL CHECK(format IN('pdf','xlsx','csv')),
 cadence TEXT NOT NULL CHECK(cadence IN('weekly','monthly','month-lock')),
 weekday INTEGER NOT NULL CHECK(weekday BETWEEN 0 AND 6), month_day INTEGER NOT NULL CHECK(month_day BETWEEN 1 AND 28),
 recipients TEXT NOT NULL, active INTEGER NOT NULL CHECK(active IN(0,1)), consent INTEGER NOT NULL CHECK(consent IN(0,1)),
 creator_id TEXT NOT NULL, creator_email TEXT NOT NULL, creator_version INTEGER NOT NULL,
 activated_at TEXT NOT NULL, activated_day TEXT NOT NULL, lock_watermark INTEGER NOT NULL,
 time_zone TEXT NOT NULL, CHECK(active=0 OR consent=1)
);
CREATE TABLE pt_report_deliveries (
 id TEXT PRIMARY KEY, schedule_id TEXT NOT NULL REFERENCES pt_report_schedules(id), schedule_revision TEXT NOT NULL,
 occurrence TEXT NOT NULL, due TEXT NOT NULL, recipient TEXT NOT NULL, recipient_scope TEXT NOT NULL,
 name TEXT NOT NULL, filename TEXT NOT NULL, content_type TEXT NOT NULL, bytes BLOB NOT NULL CHECK(length(bytes)<=1000000), sha256 TEXT NOT NULL,
 byte_size INTEGER NOT NULL DEFAULT 0 CHECK(byte_size BETWEEN 0 AND 25000000),
 part_count INTEGER NOT NULL DEFAULT 0 CHECK(part_count BETWEEN 0 AND 25),
 issue TEXT NOT NULL, selection TEXT NOT NULL, books_revision INTEGER NOT NULL,
 from_date TEXT NOT NULL, to_date TEXT NOT NULL, basis TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN('claimed','sending','accepted','rejected','rate_limited','uncertain','development','no-mail','cancelled','blocked')),
 detail TEXT NOT NULL DEFAULT '', provider TEXT, provider_message_id TEXT,
 claimed_at TEXT NOT NULL, finished_at TEXT,
 UNIQUE(schedule_id,schedule_revision,occurrence,recipient)
);
CREATE INDEX pt_report_deliveries_history ON pt_report_deliveries(claimed_at);
CREATE TRIGGER pt_report_delivery_frozen BEFORE UPDATE ON pt_report_deliveries
WHEN NEW.id!=OLD.id OR NEW.schedule_id!=OLD.schedule_id OR NEW.schedule_revision!=OLD.schedule_revision OR NEW.occurrence!=OLD.occurrence
 OR NEW.recipient!=OLD.recipient OR NEW.recipient_scope!=OLD.recipient_scope OR NEW.sha256!=OLD.sha256 OR NEW.bytes!=OLD.bytes
 OR NEW.byte_size!=OLD.byte_size OR NEW.part_count!=OLD.part_count
 OR NEW.issue!=OLD.issue OR NEW.selection!=OLD.selection OR NEW.books_revision!=OLD.books_revision
 OR NEW.from_date!=OLD.from_date OR NEW.to_date!=OLD.to_date OR NEW.basis!=OLD.basis
 OR NEW.name!=OLD.name OR NEW.filename!=OLD.filename OR NEW.content_type!=OLD.content_type OR NEW.claimed_at!=OLD.claimed_at OR NEW.due!=OLD.due
BEGIN SELECT RAISE(ABORT,'PANTRY_REPORT_DELIVERY_IMMUTABLE'); END;

CREATE TABLE pt_report_attachment_parts (
 delivery_id TEXT NOT NULL REFERENCES pt_report_deliveries(id),
 part INTEGER NOT NULL CHECK(part BETWEEN 0 AND 24),
 content BLOB NOT NULL CHECK(length(content) BETWEEN 1 AND 1000000),
 PRIMARY KEY(delivery_id,part)
);
CREATE TRIGGER pt_report_attachment_part_insert BEFORE INSERT ON pt_report_attachment_parts
WHEN NOT EXISTS(SELECT 1 FROM pt_report_deliveries d WHERE d.id=NEW.delivery_id
 AND d.status='claimed' AND length(d.bytes)=0 AND NEW.part<d.part_count)
BEGIN SELECT RAISE(ABORT,'PANTRY_REPORT_ATTACHMENT_IMMUTABLE'); END;
CREATE TRIGGER pt_report_attachment_part_update BEFORE UPDATE ON pt_report_attachment_parts
BEGIN SELECT RAISE(ABORT,'PANTRY_REPORT_ATTACHMENT_IMMUTABLE'); END;
CREATE TRIGGER pt_report_attachment_part_delete BEFORE DELETE ON pt_report_attachment_parts
BEGIN SELECT RAISE(ABORT,'PANTRY_REPORT_ATTACHMENT_IMMUTABLE'); END;
