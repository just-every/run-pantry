-- Business transitions, including indirect postings and settlement by allocations.

CREATE TRIGGER pt_webhook_invoices_posted_insert AFTER INSERT ON pt_invoices
WHEN (NEW.status='issued') AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.kind,NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_invoices_posted_update AFTER UPDATE OF status ON pt_invoices
WHEN (NEW.status='issued' AND OLD.status<>NEW.status) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.kind,NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_bills_posted_insert AFTER INSERT ON pt_bills
WHEN (NEW.status='posted') AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bill',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_bills_posted_update AFTER UPDATE OF status ON pt_bills
WHEN (NEW.status='posted' AND OLD.status<>NEW.status) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bill',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_journal_entries_posted_insert AFTER INSERT ON pt_journal_entries
WHEN (NEW.status='posted') AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'journal',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_journal_entries_posted_update AFTER UPDATE OF status ON pt_journal_entries
WHEN (NEW.status='posted' AND OLD.status<>NEW.status) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='posted') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'posted',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'journal',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='posted');
END;

CREATE TRIGGER pt_webhook_matches_matched_insert AFTER INSERT ON pt_matches
WHEN (NEW.status='approved') AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='matched') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'matched',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'match',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='matched');
END;

CREATE TRIGGER pt_webhook_matches_matched_update AFTER UPDATE OF status ON pt_matches
WHEN (NEW.status='approved' AND OLD.status<>NEW.status) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='matched') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'matched',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'match',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='matched');
END;

CREATE TRIGGER pt_webhook_periods_locked_insert AFTER INSERT ON pt_periods
WHEN (NEW.status='locked') AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='locked') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'locked',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'period',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='locked');
END;

CREATE TRIGGER pt_webhook_periods_locked_update AFTER UPDATE OF status ON pt_periods
WHEN (NEW.status='locked' AND OLD.status<>NEW.status) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='locked') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'locked',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'period',NEW.id,CAST(NEW.revision AS TEXT),NEW.status);
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='locked');
END;

CREATE TRIGGER pt_webhook_approved AFTER INSERT ON pt_approvals
WHEN (NEW.decision='approved' AND NEW.subject_kind IN ('invoice','credit','bill','journal','proposal','period','capture-draft')) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='approved') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'approved',strftime('%Y-%m-%dT%H:%M:%fZ','now'),NEW.subject_kind,NEW.subject_id,CAST(NEW.subject_revision AS TEXT),'approved');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='approved');
END;

CREATE TRIGGER pt_webhook_invoice_paid AFTER INSERT ON pt_allocations
WHEN (NEW.target_kind='invoice' AND NEW.voided_on IS NULL AND (NEW.source_kind='credit' OR EXISTS (SELECT 1 FROM pt_payments WHERE id=NEW.source_id AND reversal_id IS NULL)) AND EXISTS (SELECT 1 FROM pt_invoices i WHERE i.id=NEW.target_id AND i.status='issued' AND COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id WHERE a.target_kind=NEW.target_kind AND a.target_id=NEW.target_id AND a.voided_on IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL)),0)>=i.total_cents AND COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id WHERE a.target_kind=NEW.target_kind AND a.target_id=NEW.target_id AND a.voided_on IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL)),0)-NEW.amount_cents<i.total_cents)) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='paid') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'paid',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'invoice',NEW.target_id,CAST((SELECT revision FROM pt_invoices WHERE id=NEW.target_id) AS TEXT),'paid');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='paid');
END;

CREATE TRIGGER pt_webhook_bill_paid AFTER INSERT ON pt_allocations
WHEN (NEW.target_kind='bill' AND NEW.voided_on IS NULL AND (NEW.source_kind='credit' OR EXISTS (SELECT 1 FROM pt_payments WHERE id=NEW.source_id AND reversal_id IS NULL)) AND EXISTS (SELECT 1 FROM pt_bills i WHERE i.id=NEW.target_id AND i.status='posted' AND COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id WHERE a.target_kind=NEW.target_kind AND a.target_id=NEW.target_id AND a.voided_on IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL)),0)>=i.total_cents AND COALESCE((SELECT sum(a.amount_cents) FROM pt_allocations a LEFT JOIN pt_payments p ON a.source_kind='payment' AND p.id=a.source_id WHERE a.target_kind=NEW.target_kind AND a.target_id=NEW.target_id AND a.voided_on IS NULL AND (a.source_kind='credit' OR p.reversal_id IS NULL)),0)-NEW.amount_cents<i.total_cents)) AND EXISTS (SELECT 1 FROM pt_webhook_subscriptions s,json_each(s.events) j WHERE s.enabled=1 AND s.deleted_at IS NULL AND j.value='paid') BEGIN
 INSERT INTO pt_webhook_events VALUES (lower(hex(randomblob(16))),'paid',strftime('%Y-%m-%dT%H:%M:%fZ','now'),'bill',NEW.target_id,CAST((SELECT revision FROM pt_bills WHERE id=NEW.target_id) AS TEXT),'paid');
 INSERT INTO pt_webhook_deliveries (id,event_id,subscription_id,host,state,next_at)
 SELECT e.id||':'||s.id,e.id,s.id,s.host,'pending',e.at FROM pt_webhook_events e JOIN pt_webhook_subscriptions s
 WHERE e.rowid=last_insert_rowid() AND s.enabled=1 AND s.deleted_at IS NULL AND EXISTS (SELECT 1 FROM json_each(s.events) WHERE value='paid');
END;
