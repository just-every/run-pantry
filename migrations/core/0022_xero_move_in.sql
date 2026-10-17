-- Move in from Xero beside QuickBooks Online, and attachments carried over from Xero.

-- A cutover now comes from either source (SQLite cannot widen a CHECK in place).
CREATE TABLE pt_cutovers_next (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK (source IN ('quickbooks-online', 'xero')),
 cutover_date TEXT NOT NULL,
 opening_entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 summary TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('staged', 'accepted')),
 accepted_by TEXT,
 accepted_at TEXT,
 revision TEXT NOT NULL
);
INSERT INTO pt_cutovers_next (id, source, cutover_date, opening_entry_id, summary, status, accepted_by, accepted_at, revision)
 SELECT id, source, cutover_date, opening_entry_id, summary, status, accepted_by, accepted_at, revision FROM pt_cutovers;
DROP TABLE pt_cutovers;
ALTER TABLE pt_cutovers_next RENAME TO pt_cutovers;

-- What an import brought in and what it left out, with why, as the person saw it at commit.
CREATE TABLE pt_move_in_reports (
 job_id TEXT PRIMARY KEY,
 source TEXT NOT NULL,
 cutover_date TEXT NOT NULL,
 came_in TEXT NOT NULL,
 left_out TEXT NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);

-- The one Xero organisation connected to carry attachments over; tokens sealed with the session secret.
CREATE TABLE pt_xero_connection (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 status TEXT NOT NULL CHECK (status IN ('pending', 'connected')),
 state TEXT,
 state_by TEXT,
 state_at TEXT,
 tenant_id TEXT,
 tenant_name TEXT,
 connection_id TEXT,
 tokens TEXT,
 connected_by TEXT,
 connected_at TEXT
);

-- Each imported open invoice or bill, once looked up in Xero.
CREATE TABLE pt_xero_items (
 item_id TEXT PRIMARY KEY,
 item_kind TEXT NOT NULL CHECK (item_kind IN ('invoice', 'bill')),
 number TEXT NOT NULL,
 xero_id TEXT,
 status TEXT NOT NULL CHECK (status IN ('found', 'not-found')),
 has_attachments INTEGER NOT NULL CHECK (has_attachments IN (0, 1)),
 listed INTEGER NOT NULL CHECK (listed IN (0, 1)),
 checked_at TEXT NOT NULL
);

-- Each file Xero lists on those items: waiting, kept as a Pantry document, or too large to keep.
CREATE TABLE pt_xero_attachments (
 id TEXT PRIMARY KEY,
 item_id TEXT NOT NULL REFERENCES pt_xero_items(item_id),
 item_kind TEXT NOT NULL,
 xero_item_id TEXT NOT NULL,
 file_name TEXT NOT NULL,
 media_type TEXT NOT NULL,
 size INTEGER NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('pending', 'carried', 'too-large')),
 document_id TEXT
);
