-- ACCESS-001: preserve existing people while extending roles and owner policy.
CREATE TABLE pt_members_access (
 email TEXT PRIMARY KEY, name TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('bookkeeper','accountant','viewer','sales','payables-clerk','time-only')),
 can_post INTEGER NOT NULL DEFAULT 0 CHECK(can_post IN (0,1)),
 can_lock INTEGER NOT NULL DEFAULT 0 CHECK(can_lock IN (0,1)),
 can_reopen INTEGER NOT NULL DEFAULT 0 CHECK(can_reopen IN (0,1)),
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), revision TEXT NOT NULL, erased_at TEXT,
 bank_accounts TEXT, time_people TEXT NOT NULL DEFAULT '[]',
 bill_limit_cents INTEGER CHECK(bill_limit_cents >= 0), payment_limit_cents INTEGER CHECK(payment_limit_cents >= 0), journal_limit_cents INTEGER CHECK(journal_limit_cents >= 0)
);
INSERT INTO pt_members_access(email,name,role,can_post,can_lock,can_reopen,active,revision,erased_at)
 SELECT email,name,role,can_post,can_lock,can_reopen,active,revision,erased_at FROM pt_members;
DROP TABLE pt_members;
ALTER TABLE pt_members_access RENAME TO pt_members;
CREATE TABLE pt_role_privacy (
 role TEXT PRIMARY KEY CHECK(role IN ('bookkeeper','accountant','viewer','sales','payables-clerk','time-only')),
 mask_tin INTEGER NOT NULL CHECK(mask_tin IN (0,1)), mask_bank INTEGER NOT NULL CHECK(mask_bank IN (0,1)), revision TEXT NOT NULL
);
INSERT INTO pt_role_privacy VALUES
 ('bookkeeper',0,0,'initial'),('accountant',0,0,'initial'),('viewer',0,0,'initial'),
 ('sales',1,1,'initial'),('payables-clerk',1,1,'initial'),('time-only',1,1,'initial');
CREATE TABLE pt_time_projects (
 id TEXT PRIMARY KEY, customer_id TEXT NOT NULL REFERENCES pt_contacts(id), name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)), revision TEXT NOT NULL,
 UNIQUE(customer_id,name)
);
CREATE TABLE pt_time_entries (
 id TEXT PRIMARY KEY, person_email TEXT NOT NULL, recorded_by TEXT NOT NULL,
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id), project_id TEXT NOT NULL REFERENCES pt_time_projects(id), item_id TEXT NOT NULL REFERENCES pt_items(id),
 work_date TEXT NOT NULL, minutes INTEGER NOT NULL CHECK(minutes > 0 AND minutes <= 1440), note TEXT NOT NULL DEFAULT '',
 invoice_id TEXT REFERENCES pt_invoices(id), revision TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE INDEX pt_time_waiting ON pt_time_entries(customer_id,invoice_id,work_date);
