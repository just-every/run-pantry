-- A duplicate stays in review until a person skips it or keeps it with a reason.
ALTER TABLE pt_receipts ADD COLUMN vendor_key TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_receipts ADD COLUMN duplicate_of TEXT REFERENCES pt_receipts(id);
ALTER TABLE pt_receipts ADD COLUMN duplicate_basis TEXT;
ALTER TABLE pt_receipts ADD COLUMN duplicate_reason TEXT;

-- Match the same case/spacing/punctuation normalization used for new receipts.
WITH RECURSIVE names(id, remaining, normalized) AS (
  SELECT id, lower(COALESCE(vendor, read_vendor, '')), '' FROM pt_receipts
  UNION ALL
  SELECT id, substr(remaining, 2), normalized || CASE WHEN substr(remaining, 1, 1) GLOB '[a-z0-9]' THEN substr(remaining, 1, 1) ELSE '' END
  FROM names WHERE remaining <> ''
)
UPDATE pt_receipts SET vendor_key = (SELECT normalized FROM names WHERE names.id = pt_receipts.id AND remaining = '');
CREATE INDEX pt_receipts_fingerprint ON pt_receipts(vendor_key, receipt_date, read_date, total_cents, read_total_cents);
DROP INDEX pt_receipts_target_once;
CREATE INDEX pt_receipts_target ON pt_receipts(target_kind, target_id) WHERE status = 'attached';
