CREATE TABLE mutation_receipts (
  actor_id TEXT NOT NULL,
  action_id TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  status INTEGER NOT NULL,
  result_json TEXT NOT NULL CHECK (json_valid(result_json)),
  actor_email TEXT NOT NULL,
  created_at TEXT NOT NULL,
  success_guard INTEGER NOT NULL CONSTRAINT mutation_write_guard CHECK (success_guard = 1),
  date_guard INTEGER NOT NULL CONSTRAINT mutation_date_guard CHECK (date_guard = 1),
  PRIMARY KEY (actor_id, action_id)
);

-- A failed zero-row prerequisite must abort the entire D1 batch.
CREATE TABLE mutation_assertions (
  id TEXT PRIMARY KEY NOT NULL,
  ok INTEGER NOT NULL CONSTRAINT mutation_write_guard CHECK (ok = 1)
);

CREATE TABLE child_profile_revisions (
  child_id TEXT NOT NULL REFERENCES children(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  display_name TEXT NOT NULL,
  archive_effective_date TEXT,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  PRIMARY KEY (child_id, revision)
);
