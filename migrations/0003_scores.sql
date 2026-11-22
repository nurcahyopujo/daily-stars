CREATE TABLE score_revisions (
  child_id TEXT NOT NULL REFERENCES children(id),
  day TEXT NOT NULL,
  stream TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision > 0),
  points INTEGER NOT NULL,
  outcome TEXT NOT NULL CHECK(outcome IN ('done_correctly','needs_improvement','unrecorded','one-off','void')),
  reason TEXT NOT NULL,
  actor TEXT NOT NULL,
  recorded TEXT NOT NULL,
  PRIMARY KEY(child_id,day,stream,revision)
);
CREATE VIEW effective_scores AS SELECT s.* FROM score_revisions s
WHERE NOT EXISTS (SELECT 1 FROM score_revisions n WHERE n.child_id=s.child_id
  AND n.day=s.day AND n.stream=s.stream AND n.revision>s.revision);
