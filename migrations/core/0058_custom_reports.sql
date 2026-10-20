-- Definitions contain no cached financial figures: every render reads the books again.
-- Creator emails follow the books' existing identity rule; sign-in identities do not travel in domain archives.
CREATE TABLE pt_custom_reports (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL CHECK(json_valid(definition)),
  revision TEXT NOT NULL,
  created_by TEXT NOT NULL,
  shared_roles TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(shared_roles) AND json_type(shared_roles) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX pt_custom_reports_creator ON pt_custom_reports(created_by);

CREATE TABLE pt_management_packages (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  definition TEXT NOT NULL CHECK(json_valid(definition)),
  revision TEXT NOT NULL,
  created_by TEXT NOT NULL,
  shared_roles TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(shared_roles) AND json_type(shared_roles) = 'array'),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX pt_management_packages_creator ON pt_management_packages(created_by);
