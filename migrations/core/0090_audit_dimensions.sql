-- Event-time dimension membership. Older events remain explicitly uncoded;
-- never infer their past coding from a record that may since have changed.
CREATE TABLE pt_audit_dimensions (
 audit_id TEXT NOT NULL REFERENCES pt_audit(id),
 kind TEXT NOT NULL CHECK(kind IN ('class','location','project')),
 name TEXT NOT NULL,
 PRIMARY KEY(audit_id,kind,name)
);
CREATE INDEX pt_audit_dimension_lookup ON pt_audit_dimensions(kind,name,audit_id);
