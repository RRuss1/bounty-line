-- Relay tokens (spec 5.10): one per officer who runs the relay program. Additive only.
-- The token itself is never stored, only its SHA-256.

CREATE TABLE relay_tokens (
  tenant_id       TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  token_hash      TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  revoked_at      INTEGER,                  -- NULL while the token works
  PRIMARY KEY (tenant_id, discord_user_id)
);
CREATE UNIQUE INDEX idx_relay_tokens_hash ON relay_tokens(token_hash);
