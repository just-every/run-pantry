-- Metadata-only events and per-consent delivery rows commit with each native write.
-- last_insert_rowid() identifies the event inserted immediately above the delivery SELECT.

CREATE TRIGGER pt_webhook_accounts_created AFTER INSERT ON pt_accounts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'account',NEW.id,CAST(NEW.revision AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_contacts_created AFTER INSERT ON pt_contacts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.kind,NEW.id,CAST(NEW.revision AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_tax_codes_created AFTER INSERT ON pt_tax_codes
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'tax-code',NEW.id,CAST(NEW.revision AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_items_created AFTER INSERT ON pt_items
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'item',NEW.id,CAST(NEW.revision AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_invoices_created AFTER INSERT ON pt_invoices
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.kind,NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_bills_created AFTER INSERT ON pt_bills
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bill',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_journal_entries_created AFTER INSERT ON pt_journal_entries
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'journal',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_payments_created AFTER INSERT ON pt_payments
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'payment',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_documents_created AFTER INSERT ON pt_documents
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'document',NEW.id,CAST(NEW.sha256 AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_bank_accounts_created AFTER INSERT ON pt_bank_accounts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bank-account',NEW.id,CAST(NEW.revision AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_statements_created AFTER INSERT ON pt_statements
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'statement',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_bank_lines_created AFTER INSERT ON pt_bank_lines
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bank-line',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_matches_created AFTER INSERT ON pt_matches
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'match',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_bank_rules_created AFTER INSERT ON pt_bank_rules
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bank-rule',NEW.id,CAST(NEW.revision AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_receipt_rules_created AFTER INSERT ON pt_receipt_rules
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'receipt-rule',NEW.id,CAST(NEW.id AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_recurring_created AFTER INSERT ON pt_recurring
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'recurring-invoice',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_recurring_bills_created AFTER INSERT ON pt_recurring_bills
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'recurring-bill',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_recurring_journals_created AFTER INSERT ON pt_recurring_journals
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'recurring-journal',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_recognition_schedules_created AFTER INSERT ON pt_recognition_schedules
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'recognition',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_budgets_created AFTER INSERT ON pt_budgets
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'budget',NEW.id,CAST(NEW.revision AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_checks_created AFTER INSERT ON pt_checks
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'check',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_check_batches_created AFTER INSERT ON pt_check_batches
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'check-batch',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_periods_created AFTER INSERT ON pt_periods
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'period',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_close_tasks_created AFTER INSERT ON pt_close_tasks
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'close-task',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_proposals_created AFTER INSERT ON pt_proposals
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'proposal',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_questions_created AFTER INSERT ON pt_questions
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'question',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_receipts_created AFTER INSERT ON pt_receipts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'receipt',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_exemption_certificates_created AFTER INSERT ON pt_exemption_certificates
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'exemption',NEW.id,CAST(NEW.id AS TEXT),CASE WHEN NEW.active=1 THEN 'active' ELSE 'inactive' END);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_vendor_credits_created AFTER INSERT ON pt_vendor_credits
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'vendor-credit',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_cutovers_created AFTER INSERT ON pt_cutovers
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'cutover',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_history_lines_created AFTER INSERT ON pt_history_lines
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'history-line',NEW.id,CAST(NEW.revision AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_custom_reports_created AFTER INSERT ON pt_custom_reports
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'custom-report',NEW.id,CAST(NEW.revision AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_management_packages_created AFTER INSERT ON pt_management_packages
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'management-package',NEW.id,CAST(NEW.revision AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_transfer_pairs_created AFTER INSERT ON pt_transfer_pairs
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'transfer',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_reconciliations_created AFTER INSERT ON pt_reconciliations
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'reconciliation',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_reclassifications_created AFTER INSERT ON pt_reclassifications
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'reclassification',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_review_notes_created AFTER INSERT ON pt_review_notes
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'review-note',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_reopen_requests_created AFTER INSERT ON pt_reopen_requests
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'reopen-request',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_stripe_payments_created AFTER INSERT ON pt_stripe_payments
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'processor-payment',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_stripe_payouts_created AFTER INSERT ON pt_stripe_payouts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'processor-payout',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_stripe_clearing_items_created AFTER INSERT ON pt_stripe_clearing_items
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'processor-clearing',NEW.id,CAST(NEW.id AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_feed_syncs_created AFTER INSERT ON pt_feed_syncs
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'feed-sync',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_feed_alerts_created AFTER INSERT ON pt_feed_alerts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'feed-alert',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_nexus_alerts_created AFTER INSERT ON pt_nexus_alerts
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'nexus-alert',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;

CREATE TRIGGER pt_webhook_notes_created AFTER INSERT ON pt_notes
WHEN (1) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='created') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'created',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'note',NEW.id,CAST(NEW.id AS TEXT),'recorded');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='created');
END;
