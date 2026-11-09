-- Milestone 1 foundations. Scoring, receipts and mutation guards follow later.
CREATE TABLE children (
  id TEXT PRIMARY KEY NOT NULL,
  display_name TEXT NOT NULL CHECK (length(trim(display_name)) BETWEEN 1 AND 60),
  start_date TEXT NOT NULL,
  archive_effective_date TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  CHECK (archive_effective_date IS NULL OR archive_effective_date > start_date)
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE template_versions (
  template_id TEXT NOT NULL REFERENCES templates(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  effective_date TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 80),
  retired INTEGER NOT NULL CHECK (retired IN (0, 1)),
  activities_json TEXT NOT NULL CHECK (json_valid(activities_json) AND json_type(activities_json) = 'array'),
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  PRIMARY KEY (template_id, revision)
);
CREATE INDEX template_versions_effective ON template_versions(template_id, effective_date, revision);

CREATE TABLE assignment_versions (
  child_id TEXT NOT NULL REFERENCES children(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  effective_date TEXT NOT NULL,
  template_ids_json TEXT NOT NULL CHECK (json_valid(template_ids_json) AND json_type(template_ids_json) = 'array'),
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  PRIMARY KEY (child_id, revision)
);
CREATE INDEX assignment_versions_effective ON assignment_versions(child_id, effective_date, revision);
