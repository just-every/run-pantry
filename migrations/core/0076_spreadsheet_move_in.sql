-- Editable header mappings survive undo; row identities follow the same native
-- import snapshot/undo protocol as the records they identify.
CREATE TABLE pt_spreadsheet_mappings (
 dataset TEXT PRIMARY KEY,
 columns_json TEXT NOT NULL,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
-- Identity columns are SHA-256 of normalized values, never an extra copy of
-- contact names or external IDs outside their ordinary record/source custody.
CREATE TABLE pt_spreadsheet_keys (
 id TEXT PRIMARY KEY,
 dataset TEXT NOT NULL,
 external_id TEXT NOT NULL DEFAULT '',
 name TEXT NOT NULL,
 revision TEXT NOT NULL
);
CREATE UNIQUE INDEX pt_spreadsheet_external ON pt_spreadsheet_keys(dataset, lower(external_id)) WHERE external_id <> '';
CREATE UNIQUE INDEX pt_spreadsheet_name ON pt_spreadsheet_keys(dataset, lower(name));

-- Keep all applied cutovers while admitting the generic source.
CREATE TABLE pt_cutovers_spreadsheet (
 id TEXT PRIMARY KEY,
 source TEXT NOT NULL CHECK (source IN ('quickbooks-online', 'xero', 'spreadsheet')),
 cutover_date TEXT NOT NULL,
 opening_entry_id TEXT NOT NULL REFERENCES pt_journal_entries(id),
 summary TEXT NOT NULL,
 status TEXT NOT NULL CHECK (status IN ('staged', 'accepted')),
 accepted_by TEXT,
 accepted_at TEXT,
 revision TEXT NOT NULL
);
INSERT INTO pt_cutovers_spreadsheet SELECT id, source, cutover_date, opening_entry_id, summary, status, accepted_by, accepted_at, revision FROM pt_cutovers;
DROP TABLE pt_cutovers;
ALTER TABLE pt_cutovers_spreadsheet RENAME TO pt_cutovers;
