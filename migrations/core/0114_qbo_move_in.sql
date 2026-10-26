-- Own-account Intuit grants never enter the book archive.
CREATE TABLE pt_qbo_connection (
 id INTEGER PRIMARY KEY CHECK(id=1),
 realm_id TEXT NOT NULL,
 environment TEXT NOT NULL CHECK(environment IN('sandbox','production')),
 tokens TEXT NOT NULL,
 verified INTEGER NOT NULL DEFAULT 0 CHECK(verified IN(0,1)),
 connected_at TEXT NOT NULL
);
