-- Phase 4: kill claims with officer review.
-- Additive only (Compendium 01 Section 6): new columns with no default needed.

ALTER TABLE kills ADD COLUMN claimed_at INTEGER;       -- when the code was pasted in Discord
ALTER TABLE kills ADD COLUMN proof_message_id TEXT;    -- the proof post (with Approve/Deny) in the bounty thread
