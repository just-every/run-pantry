-- Retain every existing question and reply while adding person-created questions.
CREATE TABLE pt_question_messages_saved AS SELECT * FROM pt_question_messages;
DROP TABLE pt_question_messages;
CREATE TABLE pt_questions_saved AS SELECT * FROM pt_questions;
DROP TABLE pt_questions;
CREATE TABLE pt_questions (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('unmatched-deposit', 'unfiled', 'missing-receipt', 'duplicate-payment', 'balance-mismatch', 'accountant')),
 -- One question per thing that doesn't add up, ever: answered, dismissed or filed ones are never asked again.
 fingerprint TEXT NOT NULL UNIQUE,
 subject_kind TEXT NOT NULL,
 subject_id TEXT NOT NULL,
 period TEXT NOT NULL,
 record_date TEXT NOT NULL,
 amount_cents INTEGER NOT NULL DEFAULT 0,
 title TEXT NOT NULL,
 question TEXT NOT NULL,
 why TEXT NOT NULL,
 facts TEXT NOT NULL DEFAULT '{}',
 choices TEXT NOT NULL DEFAULT '[]',
 status TEXT NOT NULL CHECK (status IN ('open', 'confirm', 'filed', 'answered', 'dismissed', 'resolved')),
 -- The reference an emailed reply carries back in its subject.
 ref TEXT NOT NULL UNIQUE,
 asked_at TEXT NOT NULL,
 email_status TEXT NOT NULL DEFAULT '' CHECK (email_status IN ('', 'sent', 'local', 'no-mail', 'failed', 'held')),
 emailed_at TEXT,
 emailed_to TEXT,
 email_detail TEXT NOT NULL DEFAULT '',
 -- An answer read from the owner's own words, waiting for their yes: {choice, remember, note, read}.
 pending TEXT,
 answer TEXT NOT NULL DEFAULT '',
 answered_by TEXT,
 answered_via TEXT CHECK (answered_via IS NULL OR answered_via IN ('app', 'email')),
 answered_at TEXT,
 result_kind TEXT,
 result_id TEXT,
 rule_id TEXT,
 revision TEXT NOT NULL,
 assignee TEXT
);
INSERT INTO pt_questions SELECT *, NULL FROM pt_questions_saved;
DROP TABLE pt_questions_saved;
CREATE INDEX pt_questions_period ON pt_questions(period, status);

-- The thread: the agent's question, the owner's answers in the app or by
-- email, and what Pantry did, in order.
CREATE TABLE pt_question_messages (
 id TEXT PRIMARY KEY,
 question_id TEXT NOT NULL REFERENCES pt_questions(id),
 at TEXT NOT NULL,
 author TEXT NOT NULL,
 via TEXT NOT NULL CHECK (via IN ('agent', 'app', 'email')),
 body TEXT NOT NULL
);
CREATE INDEX pt_question_messages_question ON pt_question_messages(question_id, at);


INSERT INTO pt_question_messages SELECT * FROM pt_question_messages_saved;
DROP TABLE pt_question_messages_saved;
