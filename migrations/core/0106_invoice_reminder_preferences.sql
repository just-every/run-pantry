-- The business-calendar batch replaces the old UTC-calendar fence.
DROP INDEX pt_deliveries_reminder_day;
ALTER TABLE pt_sending ADD COLUMN reminder_subject TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_sending ADD COLUMN reminder_body TEXT NOT NULL DEFAULT '';
ALTER TABLE pt_contacts ADD COLUMN reminder_days TEXT;
CREATE TABLE pt_reminder_batches (
  invoice_id TEXT NOT NULL REFERENCES pt_invoices(id),
  day TEXT NOT NULL,
  id TEXT NOT NULL UNIQUE,
  PRIMARY KEY(invoice_id, day)
);
INSERT INTO pt_reminder_batches(invoice_id,day,id)
  SELECT invoice_id,reminder_day,min(id) FROM pt_deliveries
  WHERE kind='reminder' AND reminder_day IS NOT NULL GROUP BY invoice_id,reminder_day;
