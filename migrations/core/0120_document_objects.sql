-- Object receipts are installation-local. Archives keep the exact recovery copy.
CREATE TABLE pt_document_objects (
  document_id TEXT PRIMARY KEY REFERENCES pt_documents(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  ready INTEGER NOT NULL DEFAULT 0 CHECK(ready IN (0,1))
);
