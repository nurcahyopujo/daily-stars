CREATE TABLE stored_balances (
  child_id TEXT PRIMARY KEY REFERENCES children(id) ON DELETE CASCADE,
  total INTEGER NOT NULL DEFAULT 0,
  balance INTEGER NOT NULL DEFAULT 0
);

INSERT INTO stored_balances(child_id,total,balance)
SELECT children.id,
  (SELECT coalesce(sum(points),0) FROM effective_scores WHERE child_id=children.id),
  child_balances.balance
FROM children JOIN child_balances ON child_balances.child_id=children.id;

DROP VIEW child_balances;
ALTER TABLE stored_balances RENAME TO child_balances;

CREATE TRIGGER child_balance_created AFTER INSERT ON children BEGIN
  INSERT INTO child_balances(child_id) VALUES (NEW.id);
END;

-- Apply only the change from the previous effective revision, including historical corrections.
CREATE TRIGGER score_balance_inserted AFTER INSERT ON score_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM score_revisions WHERE child_id=NEW.child_id AND day=NEW.day
    AND stream=NEW.stream AND revision>NEW.revision
)
BEGIN
  UPDATE child_balances SET
    total=total+NEW.points-coalesce((
      SELECT points FROM score_revisions WHERE child_id=NEW.child_id AND day=NEW.day
        AND stream=NEW.stream AND revision<NEW.revision ORDER BY revision DESC LIMIT 1
    ),0),
    balance=balance+NEW.points-coalesce((
      SELECT points FROM score_revisions WHERE child_id=NEW.child_id AND day=NEW.day
        AND stream=NEW.stream AND revision<NEW.revision ORDER BY revision DESC LIMIT 1
    ),0)
  WHERE child_id=NEW.child_id;
END;

CREATE TRIGGER score_balance_deleted AFTER DELETE ON score_revisions
WHEN NOT EXISTS (
  SELECT 1 FROM score_revisions WHERE child_id=OLD.child_id AND day=OLD.day
    AND stream=OLD.stream AND revision>OLD.revision
)
BEGIN
  UPDATE child_balances SET
    total=total-OLD.points+coalesce((
      SELECT points FROM score_revisions WHERE child_id=OLD.child_id AND day=OLD.day
        AND stream=OLD.stream ORDER BY revision DESC LIMIT 1
    ),0),
    balance=balance-OLD.points+coalesce((
      SELECT points FROM score_revisions WHERE child_id=OLD.child_id AND day=OLD.day
        AND stream=OLD.stream ORDER BY revision DESC LIMIT 1
    ),0)
  WHERE child_id=OLD.child_id;
END;

CREATE TRIGGER redemption_balance_inserted AFTER INSERT ON redemptions
WHEN NEW.voided IS NULL BEGIN
  UPDATE child_balances SET balance=balance-NEW.cost WHERE child_id=NEW.child_id;
END;

CREATE TRIGGER redemption_balance_voided AFTER UPDATE OF voided ON redemptions
WHEN OLD.voided IS NULL AND NEW.voided IS NOT NULL BEGIN
  UPDATE child_balances SET balance=balance+OLD.cost WHERE child_id=OLD.child_id;
END;

CREATE TRIGGER redemption_balance_deleted AFTER DELETE ON redemptions
WHEN OLD.voided IS NULL BEGIN
  UPDATE child_balances SET balance=balance+OLD.cost WHERE child_id=OLD.child_id;
END;
