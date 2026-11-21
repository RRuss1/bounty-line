-- Phase 6b: stacked bounties (several posters, each pays their share) and proof cleanup.
-- Additive only.

CREATE TABLE contributions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  bounty_id         INTEGER NOT NULL,
  poster_discord_id TEXT,
  poster_name       TEXT,
  poster_guid       TEXT,
  reward_gold       INTEGER NOT NULL,
  source_code       TEXT UNIQUE,
  created_at        INTEGER,
  paid_at           INTEGER                    -- this contributor clicked Paid
);
CREATE INDEX idx_contributions_bounty ON contributions(tenant_id, bounty_id);
CREATE INDEX idx_contributions_user ON contributions(tenant_id, poster_discord_id);

-- Every existing bounty has one contributor: its poster.
INSERT INTO contributions (tenant_id, bounty_id, poster_discord_id, poster_name, poster_guid, reward_gold, source_code, created_at, paid_at)
  SELECT b.tenant_id, b.id, b.poster_discord_id, b.poster_name, b.poster_guid, b.reward_gold, b.source_code, b.created_at,
         (SELECT k.paid_at FROM kills k WHERE k.bounty_id = b.id AND k.tenant_id = b.tenant_id AND k.paid_at IS NOT NULL LIMIT 1)
  FROM bounties b;

ALTER TABLE bounties ADD COLUMN closed_at INTEGER;  -- paid / expired / cancelled; proofs are deleted PROOF_RETENTION_DAYS later
UPDATE bounties SET closed_at = created_at WHERE status IN ('paid', 'expired', 'cancelled');
