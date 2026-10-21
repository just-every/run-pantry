-- One original photograph, with independently reviewable derived receipts.
CREATE TABLE pt_capture_sources (
 id TEXT PRIMARY KEY,
 document_id TEXT NOT NULL REFERENCES pt_documents(id),
 revision TEXT NOT NULL,
 regions TEXT NOT NULL CHECK(json_valid(regions)),
 source TEXT NOT NULL CHECK(source IN ('camera','upload')),
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE pt_capture_parts (
 source_id TEXT NOT NULL REFERENCES pt_capture_sources(id),
 part_index INTEGER NOT NULL CHECK(part_index BETWEEN 0 AND 19),
 receipt_id TEXT NOT NULL UNIQUE REFERENCES pt_receipts(id),
 document_id TEXT NOT NULL UNIQUE REFERENCES pt_documents(id),
 PRIMARY KEY(source_id,part_index)
);
