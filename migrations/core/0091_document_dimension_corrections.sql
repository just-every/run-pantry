-- A document correction remains an ordinary immutable linked journal. Cash
-- reports recognize its coding on settlement dates, never its journal date.
ALTER TABLE pt_reclassifications ADD COLUMN document_line_id TEXT REFERENCES pt_journal_lines(id);
CREATE INDEX pt_reclassification_document ON pt_reclassifications(document_line_id);
