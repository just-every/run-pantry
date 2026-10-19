-- Matching facts are evidence from the document, never an inferred FX rate.
ALTER TABLE pt_receipts ADD COLUMN read_match_fields TEXT;
