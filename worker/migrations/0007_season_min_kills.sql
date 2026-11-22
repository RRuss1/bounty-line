-- Open Season: a prize pool's minimum number of kills (spec 5.11). Additive only.
ALTER TABLE seasons ADD COLUMN min_kills INTEGER NOT NULL DEFAULT 0;
