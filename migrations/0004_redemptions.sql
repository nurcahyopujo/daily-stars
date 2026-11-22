CREATE TABLE redemptions (
  child_id TEXT NOT NULL REFERENCES children(id),
  id TEXT NOT NULL,
  label TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK(cost > 0),
  actor TEXT NOT NULL,
  recorded TEXT NOT NULL,
  voided TEXT,
  voided_by TEXT,
  PRIMARY KEY(child_id, id)
);
CREATE VIEW child_balances AS
SELECT id AS child_id,
  (SELECT coalesce(sum(points),0) FROM effective_scores WHERE child_id=children.id)
  - (SELECT coalesce(sum(cost),0) FROM redemptions WHERE child_id=children.id AND voided IS NULL) AS balance
FROM children;
