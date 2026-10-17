-- Receipts: a photo, file or forwarded email kept as a document byte for byte,
-- read by the install's own AI model, matched to a transaction, and attached
-- once a person accepts it (or a rule the business set says so).

-- Documents larger than one D1 value keep their bytes in ordered parts; the
-- document row then holds an empty content and the SHA-256 of the whole file.
CREATE TABLE pt_document_parts (
 document_id TEXT NOT NULL REFERENCES pt_documents(id),
 seq INTEGER NOT NULL,
 content BLOB NOT NULL,
 PRIMARY KEY (document_id, seq)
);

CREATE TABLE pt_receipts (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES pt_documents(id),
 -- What the model read when it is not the original: an email's attachment, or
 -- the smaller copy of a large photo made on the phone.
 file_document_id TEXT REFERENCES pt_documents(id),
 source TEXT NOT NULL CHECK (source IN ('upload', 'camera', 'email')),
 sender TEXT NOT NULL DEFAULT '',
 subject TEXT NOT NULL DEFAULT '',
 read_status TEXT NOT NULL CHECK (read_status IN ('read', 'failed', 'no-key', 'unavailable')),
 read_note TEXT NOT NULL DEFAULT '',
 read_model TEXT,
 read_at TEXT,
 -- The fields exactly as the model read them; never edited.
 read_vendor TEXT,
 read_date TEXT,
 read_total_cents INTEGER,
 read_tax_cents INTEGER,
 read_currency TEXT,
 read_account_id TEXT REFERENCES pt_accounts(id),
 -- The fields a person accepted (or corrected) when attaching.
 vendor TEXT,
 receipt_date TEXT,
 total_cents INTEGER,
 tax_cents INTEGER,
 currency TEXT,
 account_id TEXT REFERENCES pt_accounts(id),
 status TEXT NOT NULL CHECK (status IN ('review', 'attached', 'dismissed')),
 -- The transaction it is attached to: a bank or card line, bill, payment or journal entry.
 target_kind TEXT CHECK (target_kind IN ('bankline', 'bill', 'payment', 'journal')),
 target_id TEXT,
 -- The record the document now belongs to (a bank line resolves to its entry).
 linked_kind TEXT,
 linked_id TEXT,
 rule_id TEXT,
 decided_by TEXT,
 decided_at TEXT,
 received_by TEXT NOT NULL,
 received_at TEXT NOT NULL,
 revision TEXT NOT NULL
);
CREATE INDEX pt_receipts_status ON pt_receipts(status, received_at);
CREATE UNIQUE INDEX pt_receipts_target_once ON pt_receipts(target_kind, target_id) WHERE status = 'attached';

-- The install's own AI model key, sealed with a key derived from SESSION_SECRET.
CREATE TABLE pt_reader (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 provider TEXT NOT NULL CHECK (provider IN ('anthropic', 'openai')),
 endpoint TEXT NOT NULL,
 model TEXT NOT NULL,
 workspace TEXT NOT NULL DEFAULT '',
 key_sealed TEXT NOT NULL,
 key_hint TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 revision TEXT NOT NULL
);

-- The Pantry address: the mailbox Email Routing sends to this Worker, plus a
-- private random tag (sealed). Only mail to mailbox+tag@domain is kept.
CREATE TABLE pt_receipt_inbox (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 mailbox TEXT NOT NULL,
 tag_sealed TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 last_received_at TEXT,
 last_note TEXT NOT NULL DEFAULT '',
 confirmation TEXT NOT NULL DEFAULT '',
 revision TEXT NOT NULL
);

-- Rules the business set: receipts from a vendor that match one bank or card
-- line exactly are attached and recorded to an account without waiting.
CREATE TABLE pt_receipt_rules (
 id TEXT PRIMARY KEY,
 vendor TEXT NOT NULL,
 account_id TEXT NOT NULL REFERENCES pt_accounts(id),
 max_cents INTEGER NOT NULL CHECK (max_cents > 0),
 active INTEGER NOT NULL DEFAULT 1 CHECK (active IN (0, 1)),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);

-- Spending a person said needs no receipt, with the reason.
CREATE TABLE pt_receipt_waivers (
 entry_id TEXT PRIMARY KEY REFERENCES pt_journal_entries(id),
 reason TEXT NOT NULL,
 waived_by TEXT NOT NULL,
 waived_at TEXT NOT NULL
);
