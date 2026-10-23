-- Ordinary reminders and reviewed collections share one daily claim per
-- recipient. Every billing contact and cc still receives their own reminder.
DROP INDEX pt_deliveries_reminder_business_day;
CREATE UNIQUE INDEX pt_deliveries_reminder_business_day
  ON pt_deliveries(invoice_id, reminder_day, lower(recipient))
  WHERE kind = 'reminder' AND reminder_day IS NOT NULL;
