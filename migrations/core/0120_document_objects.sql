-- Immutable object keys remain after erasure as empty tombstones. This prevents
-- a delayed create-only upload from restoring erased originals after a crash.
CREATE TABLE pt_document_objects (
  object_key TEXT PRIMARY KEY,
  document_id TEXT NOT NULL UNIQUE,
  state TEXT NOT NULL CHECK(state IN ('staged','ready','erase-pending','erased'))
);
CREATE INDEX pt_document_objects_work ON pt_document_objects(state,object_key);
INSERT INTO pt_document_objects(object_key,document_id,state)
  SELECT 'documents/'||id,id,CASE WHEN erased_at IS NULL THEN 'staged' ELSE 'erase-pending' END FROM pt_documents;
CREATE TRIGGER pt_document_object_insert AFTER INSERT ON pt_documents BEGIN
  INSERT INTO pt_document_objects(object_key,document_id,state)
    VALUES('documents/'||NEW.id,NEW.id,CASE WHEN NEW.erased_at IS NULL THEN 'staged' ELSE 'erase-pending' END);
END;
CREATE TRIGGER pt_document_object_erase AFTER UPDATE OF erased_at ON pt_documents
WHEN OLD.erased_at IS NULL AND NEW.erased_at IS NOT NULL BEGIN
  UPDATE pt_document_objects SET state='erase-pending' WHERE document_id=NEW.id;
END;
CREATE TRIGGER pt_document_object_delete BEFORE DELETE ON pt_documents BEGIN
  UPDATE pt_document_objects SET state='erase-pending' WHERE document_id=OLD.id;
END;
