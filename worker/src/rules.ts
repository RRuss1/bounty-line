/** Bounty rules (spec Section 10) and the player-facing messages (Compendium 02 Section 8). */
import type { BountyPost, ErrorCode } from "./codec";
import type { Tenant } from "./tenants";
import { bonusTotal } from "./terms";
import { gold } from "./wow";

export type RuleError = { code: string; message: string };

const ADDON_UPDATE = "I don't recognize that code. Is your Bounty Line addon up to date?";

/** Message for a codec decode error. */
export function decodeErrorMessage(error: ErrorCode): RuleError {
  switch (error) {
    case "CHECKSUM":
    case "FORMAT":
      return { code: "CHECKSUM", message: "That code looks cut off or changed. Copy it again in game with `/bl last`." };
    case "FACTION":
      return { code: "FACTION", message: "Bounties must be on the opposite faction." };
    case "PARTS":
    case "INCOMPLETE":
      return { code: "PARTS", message: "That's part of a Bounty Pack. Packs go into the addon with `/bl import`, not here." };
    default: // VERSION, TYPE, SCHEMA, PAYLOAD
      return { code: error, message: ADDON_UPDATE };
  }
}

/** Checks a decoded bounty post against this server's settings. */
export function checkBountyPost(f: BountyPost, tenant: Tenant, now: number): RuleError | null {
  if (f.boardTag !== "0000" && f.boardTag !== tenant.board_tag) {
    return { code: "BOARD", message: "That code belongs to a different Bounty Board." };
  }
  if (f.targetFaction === f.posterFaction) return { code: "FACTION", message: "Bounties must be on the opposite faction." };
  const { reward_min, reward_max, expiry_days } = tenant.config;
  if (f.rewardGold < reward_min || f.rewardGold > reward_max) {
    return { code: "LIMITS", message: `Reward must be between ${gold(reward_min)} and ${gold(reward_max)}.` };
  }
  // The Expand section (spec 5.4c): the bonuses count toward the limit too, and every kill pays something.
  const bonuses = bonusTotal(f.terms ?? []);
  if (f.rewardGold + bonuses > reward_max) {
    return { code: "LIMITS", message: `The reward plus every bonus (${gold(f.rewardGold + bonuses)}) can't be over ${gold(reward_max)}.` };
  }
  if ((f.kills ?? 1) > 1 && f.payout === 0 && f.rewardGold < (f.kills ?? 1)) {
    return { code: "LIMITS", message: `${gold(f.rewardGold)} can't be split over ${f.kills} kills: give at least 1g per kill.` };
  }
  if (now - f.createdAt > expiry_days * 86400) {
    return { code: "EXPIRED", message: "That bounty code is too old. Make a new one in game." };
  }
  return null;
}
