-- Trust needs kills on bounties from different posters (no farming trust off one friend's alt).
-- The posters already counted in the hunter's current streak; a denial clears it. Additive only.

ALTER TABLE hunters ADD COLUMN streak_posters TEXT NOT NULL DEFAULT '[]';

-- When a kill was approved (officer or auto). "Owing" counts from here, not from the claim.
-- Older rows fall back to claimed_at.
ALTER TABLE kills ADD COLUMN approved_at INTEGER;
