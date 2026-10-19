-- Additive rule controls. Existing rules keep their automatic percentage behavior and order.
ALTER TABLE pt_bank_rules ADD COLUMN priority INTEGER NOT NULL DEFAULT 0 CHECK (typeof(priority) = 'integer' AND priority >= 0);
UPDATE pt_bank_rules SET priority = position;
ALTER TABLE pt_bank_rules ADD COLUMN mode TEXT NOT NULL DEFAULT 'automatic' CHECK (mode IN ('automatic', 'suggest'));
ALTER TABLE pt_bank_rules ADD COLUMN description_mode TEXT NOT NULL DEFAULT 'contains' CHECK (description_mode IN ('contains', 'equals'));
ALTER TABLE pt_bank_rules ADD COLUMN split_mode TEXT NOT NULL DEFAULT 'percent' CHECK (split_mode IN ('percent', 'amount'));
CREATE INDEX pt_bank_rules_order ON pt_bank_rules(active, priority, created_at, id);

ALTER TABLE pt_matches ADD COLUMN rule_revision TEXT;
ALTER TABLE pt_matches ADD COLUMN rule_snapshot TEXT CHECK (rule_snapshot IS NULL OR json_valid(rule_snapshot));
-- Prior filings retain their original audited authority revision where available.
-- Legacy rows cannot recover conditions that predate retained audit snapshots;
-- distinguish that explicitly rather than inventing an original rule revision.
UPDATE pt_matches SET
 rule_revision = (SELECT a.authority_revision FROM pt_audit a WHERE a.action = 'bank-rule.file' AND a.subject_id = pt_matches.id ORDER BY a.at DESC LIMIT 1),
 rule_snapshot = json_object('id', rule_id, 'name', COALESCE((SELECT json_extract(a.detail, '$.rule') FROM pt_audit a WHERE a.action = 'bank-rule.file' AND a.subject_id = pt_matches.id ORDER BY a.at DESC LIMIT 1), (SELECT name FROM pt_bank_rules r WHERE r.id = pt_matches.rule_id)), 'legacy', json('true'))
 WHERE rule_id IS NOT NULL;

CREATE TRIGGER pt_rule_filing_evidence_required BEFORE INSERT ON pt_matches
WHEN NEW.rule_id IS NOT NULL AND (NEW.rule_revision IS NULL OR NEW.rule_snapshot IS NULL)
BEGIN SELECT RAISE(ABORT, 'Rule filing requires its revision and snapshot'); END;
CREATE TRIGGER pt_rule_filing_evidence_immutable BEFORE UPDATE OF rule_id, rule_revision, rule_snapshot ON pt_matches
WHEN OLD.rule_snapshot IS NOT NULL AND (NEW.rule_id IS NOT OLD.rule_id OR NEW.rule_revision IS NOT OLD.rule_revision OR NEW.rule_snapshot IS NOT OLD.rule_snapshot)
BEGIN SELECT RAISE(ABORT, 'Rule filing evidence is immutable'); END;
