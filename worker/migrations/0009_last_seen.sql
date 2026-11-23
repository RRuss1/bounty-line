-- Last seen on the wanted posters (spec 5.10): the newest sighting a relay carried from the
-- game, and which sighting the poster shows (it is redrawn at most every 10 minutes). Additive only.

ALTER TABLE bounties ADD COLUMN last_seen_at INTEGER;
ALTER TABLE bounties ADD COLUMN last_seen_map INTEGER;
ALTER TABLE bounties ADD COLUMN last_seen_by TEXT;
ALTER TABLE bounties ADD COLUMN seen_shown_at INTEGER;
ALTER TABLE bounties ADD COLUMN seen_drawn_at INTEGER;
