-- Open Season (spec 5.11): a bounty on every member of an enemy guild. Additive only.

CREATE TABLE seasons (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  guild_name        TEXT NOT NULL,              -- the enemy guild, as the game shows it
  guild_key         TEXT NOT NULL,              -- lowercase, for matching
  faction           TEXT NOT NULL,              -- the enemy guild's faction: Alliance|Horde
  kind              INTEGER NOT NULL,           -- 1 per head + pot, 2 prize pool, 3 per head with no ceiling
  per_kill_gold     INTEGER NOT NULL DEFAULT 0,
  total_gold        INTEGER NOT NULL DEFAULT 0, -- the pot (kind 1) or the pool (kind 2); 0 for kind 3
  spent_gold        INTEGER NOT NULL DEFAULT 0, -- credited to approved kills so far (kinds 1 and 3)
  poster_guid       TEXT,
  poster_name       TEXT,
  poster_discord_id TEXT,
  created_at        INTEGER NOT NULL,
  expires_at        INTEGER NOT NULL,
  status            TEXT NOT NULL,              -- open|settling|awaiting_payment|paid|expired
  closed_at         INTEGER,
  thread_id         TEXT,
  source_code       TEXT UNIQUE
);
CREATE INDEX idx_seasons_tenant_status ON seasons(tenant_id, status);
CREATE INDEX idx_seasons_guild ON seasons(tenant_id, guild_key);

CREATE TABLE season_funds (                     -- who put gold in (the poster first, then anyone adding to it)
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  season_id         INTEGER NOT NULL,
  poster_discord_id TEXT,
  poster_name       TEXT,
  poster_guid       TEXT,
  gold              INTEGER NOT NULL,           -- 0 for the one funder of a kind 3 season
  source_code       TEXT UNIQUE,
  created_at        INTEGER
);
CREATE INDEX idx_season_funds_season ON season_funds(tenant_id, season_id);

CREATE TABLE season_kills (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  season_id         INTEGER NOT NULL,
  killer_guid       TEXT,
  killer_name       TEXT,
  killer_discord_id TEXT,
  victim_guid       TEXT,
  victim_name       TEXT,
  killed_at         INTEGER,
  day               INTEGER NOT NULL,           -- UTC day number of the kill: one payout per hunter, victim and day
  zone_map_id       INTEGER,
  guild_seen        INTEGER NOT NULL DEFAULT 1, -- 0: the addon never saw the victim's guild
  code              TEXT UNIQUE,
  image_r2_key      TEXT,
  image_hash        TEXT,
  checks_json       TEXT,
  verdict           TEXT,                       -- auto|approved|denied|pending
  reviewed_by       TEXT,
  gold              INTEGER NOT NULL DEFAULT 0, -- credited when approved (kinds 1 and 3)
  proof_message_id  TEXT,
  claimed_at        INTEGER
);
CREATE INDEX idx_season_kills_season ON season_kills(tenant_id, season_id, verdict);
CREATE INDEX idx_season_kills_daily ON season_kills(season_id, victim_guid, killer_discord_id, day);
CREATE INDEX idx_season_kills_image_hash ON season_kills(tenant_id, image_hash);

CREATE TABLE season_payouts (                   -- one line of the payout sheet: what a hunter collects
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id         TEXT NOT NULL,
  season_id         INTEGER NOT NULL,
  hunter_discord_id TEXT NOT NULL,
  kills             INTEGER NOT NULL,
  gold              INTEGER NOT NULL,
  payers_json       TEXT NOT NULL,              -- [{ id, name, gold, paid_at }]
  received_at       INTEGER,
  done_at           INTEGER,
  message_id        TEXT
);
CREATE INDEX idx_season_payouts_season ON season_payouts(tenant_id, season_id);
