-- Signed estimate and accepted proposal evidence follows the existing owner
-- confirmed financial supporting-record retention clock.
CREATE TABLE pt_retained_items_next (
 table_name TEXT NOT NULL CHECK(table_name IN ('pt_documents','pt_invoice_documents','pt_estimate_documents','pt_estimate_sibling_links','pt_contractor_tax')),
 row_id TEXT NOT NULL, subject_id TEXT NOT NULL, erasure_id TEXT NOT NULL REFERENCES pt_erasure_journal(id),
 clock TEXT NOT NULL, expires TEXT NOT NULL, revision TEXT NOT NULL, erased_at TEXT,
 PRIMARY KEY(table_name,row_id)
);
INSERT INTO pt_retained_items_next SELECT * FROM pt_retained_items;
DROP TABLE pt_retained_items;
ALTER TABLE pt_retained_items_next RENAME TO pt_retained_items;
CREATE INDEX pt_retained_ready ON pt_retained_items(erased_at,expires);
