CREATE TABLE pt_collection_cases(
 invoice_id TEXT PRIMARY KEY REFERENCES pt_invoices(id),status TEXT NOT NULL CHECK(status IN('draft','approved','sent','promise','disputed','stopped','paid')),
 subject TEXT NOT NULL,body TEXT NOT NULL,recipient TEXT NOT NULL,evidence TEXT NOT NULL CHECK(json_valid(evidence)),
 promise_date TEXT,reply_note TEXT NOT NULL DEFAULT '',invoice_revision TEXT NOT NULL,open_cents INTEGER NOT NULL,
 approved_by TEXT,approved_revision TEXT,revision TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE pt_collection_sends(id TEXT PRIMARY KEY,invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),case_revision TEXT NOT NULL,delivery_id TEXT NOT NULL UNIQUE REFERENCES pt_deliveries(id),at TEXT NOT NULL);

ALTER TABLE pt_deliveries ADD COLUMN reminder_day TEXT;
CREATE UNIQUE INDEX pt_deliveries_reminder_business_day ON pt_deliveries(invoice_id,reminder_day) WHERE kind='reminder' AND reminder_day IS NOT NULL;
