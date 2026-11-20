-- Bounty Board schema v1 (design spec Section 12).
-- Every table carries tenant_id = the Discord server (guild) ID, and every query filters by it.
-- Never edit this file after it ships; fix forward with a new migration (Compendium 01 Section 6).

CREATE TABLE tenants (
  id                 TEXT PRIMARY KEY,          -- Discord guild (server) ID
  board_tag          TEXT UNIQUE NOT NULL,      -- 4-char code tag
  wow_guild_name     TEXT,
  bounty_line_ch     TEXT,
  bounty_board_forum TEXT,
  hall_of_fame_ch    TEXT,
  officer_role_id    TEXT,
  config_json        TEXT NOT NULL DEFAULT '{}', -- runtime settings that differ from defaults
  created_at         INTEGER NOT NULL
);

CREATE TABLE characters (                       -- Discord user <-> WoW character link
  tenant_id       TEXT NOT NULL,
  guid            TEXT NOT NULL,
  name            TEXT,
  discord_user_id TEXT,
  PRIMARY KEY (tenant_id, guid)
);
CREATE INDEX idx_characters_user ON characters(tenant_id, discord_user_id);

CREATE TABLE bounties (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  target_guid       TEXT NOT NULL,
  target_name       TEXT,
  class             TEXT,
  race              TEXT,
  level             INTEGER,
  faction           TEXT,
  reward_gold       INTEGER NOT NULL,
  poster_guid       TEXT,
  poster_name       TEXT,
  poster_discord_id TEXT,
  zone_map_id       INTEGER,
  created_at        INTEGER,
  expires_at        INTEGER,
  status            TEXT NOT NULL,              -- open|review|awaiting_payment|paid|expired|cancelled
  thread_id         TEXT,
  source_code       TEXT UNIQUE
);
CREATE INDEX idx_bounties_tenant_status ON bounties(tenant_id, status);
CREATE INDEX idx_bounties_target ON bounties(tenant_id, target_guid);

CREATE TABLE kills (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  bounty_id         INTEGER,
  killer_guid       TEXT,
  killer_name       TEXT,
  killer_discord_id TEXT,
  victim_guid       TEXT,
  killed_at         INTEGER,
  zone_map_id       INTEGER,
  code              TEXT UNIQUE,
  image_r2_key      TEXT,
  image_hash        TEXT,
  checks_json       TEXT,                       -- per-check pass/fail + AI read text
  verdict           TEXT,                       -- auto|approved|denied|pending
  reviewed_by       TEXT,
  paid_at           INTEGER,
  received_at       INTEGER
);
CREATE INDEX idx_kills_tenant_verdict ON kills(tenant_id, verdict);
CREATE INDEX idx_kills_image_hash ON kills(tenant_id, image_hash);

CREATE TABLE hunters (
  tenant_id       TEXT NOT NULL,
  discord_user_id TEXT NOT NULL,
  approved        INTEGER DEFAULT 0,
  denied          INTEGER DEFAULT 0,
  gold_earned     INTEGER DEFAULT 0,
  trust           TEXT DEFAULT 'new',
  PRIMARY KEY (tenant_id, discord_user_id)
);

CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id   TEXT NOT NULL,
  at          INTEGER NOT NULL,
  actor       TEXT,
  action      TEXT NOT NULL,
  detail_json TEXT
);
CREATE INDEX idx_audit_tenant_at ON audit_log(tenant_id, at);
