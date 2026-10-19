-- Every billing and cc recipient may receive a reminder, once per step and
-- at most once per day. Keep earlier delivery history and normalize its keys.
DROP INDEX pt_deliveries_reminder_step;
DROP INDEX pt_deliveries_reminder_day;
CREATE UNIQUE INDEX pt_deliveries_reminder_step ON pt_deliveries(invoice_id, step, lower(recipient)) WHERE kind = 'reminder';
CREATE UNIQUE INDEX pt_deliveries_reminder_day ON pt_deliveries(invoice_id, substr(at, 1, 10), lower(recipient)) WHERE kind = 'reminder';
