CREATE TABLE prizes (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  cost INTEGER NOT NULL CHECK (cost > 0),
  one_time INTEGER NOT NULL CHECK (one_time IN (0, 1)),
  link TEXT,
  image_url TEXT,
  archived TEXT,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  actor_email TEXT NOT NULL
);

-- Names are unique among active prizes, ignoring case.
CREATE UNIQUE INDEX prizes_active_name ON prizes(name COLLATE NOCASE) WHERE archived IS NULL;

-- A redemption keeps its own label and cost; prize_id only traces where it came from.
ALTER TABLE redemptions ADD COLUMN prize_id TEXT REFERENCES prizes(id);
CREATE INDEX redemptions_active_prize ON redemptions(child_id, prize_id) WHERE voided IS NULL;
