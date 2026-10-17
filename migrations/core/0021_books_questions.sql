-- The books agent's questions: what doesn't add up in the books (a deposit
-- nothing explains, a transaction still unfiled or without its receipt past a
-- set age, a payment made twice, a bank balance the books cannot reach), asked
-- once, by email first, with a link to the record. The owner's answer files
-- it; nothing posts without that answer. Each month's questions are one thread
-- the close shows until every one is answered.
CREATE TABLE pt_questions (
 id TEXT PRIMARY KEY,
 kind TEXT NOT NULL CHECK (kind IN ('unmatched-deposit', 'unfiled', 'missing-receipt', 'duplicate-payment', 'balance-mismatch')),
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
 revision TEXT NOT NULL
);
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

-- How the agent asks: the ages that make a transaction worth a question, the
-- receipt threshold, and whether and how often it emails. Replies come back
-- to the Pantry address (pt_receipt_inbox).
CREATE TABLE pt_books_agent (
 id INTEGER PRIMARY KEY CHECK (id = 1),
 email_on INTEGER NOT NULL DEFAULT 1 CHECK (email_on IN (0, 1)),
 per_day INTEGER NOT NULL DEFAULT 3 CHECK (per_day BETWEEN 1 AND 20),
 deposit_days INTEGER NOT NULL DEFAULT 5 CHECK (deposit_days BETWEEN 0 AND 90),
 file_days INTEGER NOT NULL DEFAULT 14 CHECK (file_days BETWEEN 0 AND 120),
 receipt_cents INTEGER NOT NULL DEFAULT 7500 CHECK (receipt_cents >= 0),
 last_run_at TEXT,
 last_run TEXT NOT NULL DEFAULT '{}',
 updated_by TEXT,
 updated_at TEXT,
 revision TEXT NOT NULL
);
INSERT INTO pt_books_agent (id, revision) VALUES (1, 'initial');
