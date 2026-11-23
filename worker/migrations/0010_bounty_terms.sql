-- Bounty terms (spec 5.4c, the Expand section of Set Bounty): kills wanted, how it pays out,
-- bonuses and restrictions. A kill on such a bounty is paid on its own: what it pays (share plus
-- bonuses) and which bonuses it earned. Additive only; old rows are plain one-kill bounties.

ALTER TABLE bounties ADD COLUMN kills_wanted INTEGER NOT NULL DEFAULT 1;
ALTER TABLE bounties ADD COLUMN payout_mode INTEGER NOT NULL DEFAULT 0;
ALTER TABLE bounties ADD COLUMN terms_json TEXT NOT NULL DEFAULT '[]';

ALTER TABLE kills ADD COLUMN amount_gold INTEGER;
ALTER TABLE kills ADD COLUMN bonus_json TEXT;
