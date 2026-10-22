-- Owner-reviewed coding for future processor postings; posted lines stay immutable.
CREATE TABLE pt_processor_dimensions (role TEXT PRIMARY KEY CHECK(role IN ('sales','refunds','fees','clearing','bank','receivable')), class_name TEXT NOT NULL DEFAULT '', location_name TEXT NOT NULL DEFAULT '', project_name TEXT NOT NULL DEFAULT '', revision TEXT NOT NULL);
