-- Mail is retained before an owner accepts an unknown sender.
ALTER TABLE pt_receipts ADD COLUMN mail_state TEXT NOT NULL DEFAULT 'accepted' CHECK (mail_state IN ('accepted', 'quarantined', 'refused'));
ALTER TABLE pt_receipts ADD COLUMN mail_auth TEXT;

CREATE TABLE pt_receipt_chase (id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)), repeat_days INTEGER NOT NULL DEFAULT 7 CHECK (repeat_days BETWEEN 1 AND 90), revision TEXT NOT NULL, owner_id TEXT);
CREATE TABLE pt_receipt_cardholders (last_four TEXT PRIMARY KEY, operator_id TEXT NOT NULL);
CREATE TABLE pt_receipt_request_attempts (question_id TEXT NOT NULL REFERENCES pt_questions(id), prior_email TEXT NOT NULL, attempted_at TEXT NOT NULL, outcome TEXT NOT NULL, PRIMARY KEY (question_id, prior_email));
