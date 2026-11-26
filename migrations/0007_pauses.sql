-- Pauses (ADR 0006). Each save appends the child's whole pause list, ended pauses
-- included, so any past date still resolves. The revision shares the child's
-- assignment revision counter: a child's assignment revision is the highest
-- revision across assignment_versions and assignment_pause_versions, so pause
-- saves and assignment changes conflict with each other.
CREATE TABLE assignment_pause_versions (
  child_id TEXT NOT NULL REFERENCES children(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  pauses_json TEXT NOT NULL CHECK (json_valid(pauses_json) AND json_type(pauses_json) = 'array'),
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL,
  recorded_at_utc TEXT NOT NULL,
  PRIMARY KEY (child_id, revision)
);
