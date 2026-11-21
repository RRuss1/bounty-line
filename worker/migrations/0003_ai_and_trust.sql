-- Phase 6a: AI stamp checks (daily cap) and trust streaks. Additive only.

CREATE TABLE ai_usage (                     -- whole deployment, per UTC day (Compendium 01: AI_DAILY_CAP)
  day   TEXT PRIMARY KEY,                   -- YYYY-MM-DD
  count INTEGER NOT NULL DEFAULT 0
);

ALTER TABLE hunters ADD COLUMN streak INTEGER DEFAULT 0;   -- approvals since the last denial (spec 9.4)
