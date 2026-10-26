CREATE TABLE pt_autopay_mail_controls (
 customer_id TEXT NOT NULL REFERENCES pt_contacts(id),
 recipient TEXT NOT NULL,
 time_zone TEXT NOT NULL,
 suppression TEXT CHECK(suppression IN('bounced','complained')),
 reason TEXT NOT NULL DEFAULT '',
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 revision TEXT NOT NULL,
 PRIMARY KEY(customer_id,recipient)
);
