-- Dated prices preserve earlier approved amounts instead of editing history.
ALTER TABLE pt_recurring ADD COLUMN amount_snapshot TEXT CHECK (amount_snapshot IS NULL OR json_valid(amount_snapshot));

-- Tax-code rates are immutable. Reconstruct the original line amounts from
-- their saved quantities, rates and tax codes so existing approvals survive.
-- Leave an inconsistent legacy record without a snapshot: it needs review.
WITH units AS (
 SELECT r.id, j.key AS line_no,
  CAST(round(CAST(json_extract(j.value, '$.quantity') AS REAL) * 1000) AS INTEGER) AS qty,
  CAST(round(CAST(replace(replace(json_extract(j.value, '$.rate'), ',', ''), '$', '') AS REAL) * 100) AS INTEGER) AS unit,
  coalesce(t.rate_milli_percent, 0) AS tax_rate
 FROM pt_recurring r, json_each(r.lines) j
 LEFT JOIN pt_tax_codes t ON t.id = json_extract(j.value, '$.taxCode')
), amounts AS (
 SELECT id, line_no, CAST(round(qty * unit / 1000.0) AS INTEGER) AS amount, tax_rate FROM units
), taxed AS (
 SELECT id, line_no, amount, CAST(round(amount * tax_rate / 100000.0) AS INTEGER) AS tax FROM amounts
), snapshots AS (
 SELECT id, json_group_array(json_array(amount, tax)) AS snapshot, sum(amount) AS subtotal, sum(tax) AS tax
 FROM (SELECT * FROM taxed ORDER BY id, line_no) GROUP BY id
)
UPDATE pt_recurring SET amount_snapshot = (
 SELECT s.snapshot FROM snapshots s WHERE s.id = pt_recurring.id
 AND s.subtotal = pt_recurring.subtotal_cents AND s.tax = pt_recurring.tax_cents
 AND s.subtotal + s.tax = pt_recurring.total_cents
);

CREATE TABLE pt_recurring_prices (
 id TEXT PRIMARY KEY,
 recurring_id TEXT NOT NULL REFERENCES pt_recurring(id),
 effective_date TEXT NOT NULL,
 lines TEXT NOT NULL CHECK (json_valid(lines)),
 amount_snapshot TEXT NOT NULL CHECK (json_valid(amount_snapshot)),
 subtotal_cents INTEGER NOT NULL,
 tax_cents INTEGER NOT NULL,
 total_cents INTEGER NOT NULL CHECK (total_cents > 0),
 prepared_by TEXT NOT NULL,
 revision TEXT NOT NULL,
 approved_by TEXT,
 approved_revision TEXT,
 template_revision TEXT,
 created_at TEXT NOT NULL,
 UNIQUE (recurring_id, effective_date)
);
