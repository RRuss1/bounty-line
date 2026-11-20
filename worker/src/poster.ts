/** Wanted-poster forum post (spec Section 8.2). */
import type { BountyPost } from "./codec";
import type { Tenant } from "./tenants";
import { className, escapeMd, factionName, gold, raceName, zoneName } from "./wow";

/** ☠ plus the emoji variation selector, so Discord draws the emoji, not the text glyph. */
export const SKULL = "☠️";

export function wantedPoster(b: BountyPost, opts: { id: number; expiresAt: number; postedBy: string; tenant: Tenant }) {
  const name = escapeMd(b.targetName || "Unknown");
  const color = Number.parseInt(opts.tenant.config.branding_color.replace("#", ""), 16);
  const embed = {
    title: `${SKULL} WANTED: ${name.toUpperCase()}`,
    color: Number.isFinite(color) ? color : 0xb8860b,
    description: [
      `${raceName(b.targetRaceID)} ${className(b.targetClassID)} · Level ${b.targetLevel} · ${factionName(b.targetFaction)}`,
      `**Reward: ${gold(b.rewardGold)}** (honor system, paid by ${escapeMd(b.posterName || "the poster")})`,
      `Marked in: ${zoneName(b.mapID)} · <t:${b.createdAt}:f>`,
      `Bounty #${opts.id} · Expires <t:${opts.expiresAt}:D>`,
      "Status: **OPEN**",
    ].join("\n"),
    fields: b.note ? [{ name: "Note", value: escapeMd(b.note) }] : [],
    footer: { text: `Board ${opts.tenant.board_tag}` },
  };
  const threadName = `${SKULL} ${b.targetName || "Unknown"} · ${gold(b.rewardGold)}`.slice(0, 100);
  // Forum cards preview only the message text (never embeds), so the key facts go here too.
  const content = [
    `**Reward: ${gold(b.rewardGold)}** · ${raceName(b.targetRaceID)} ${className(b.targetClassID)} ${b.targetLevel} · ${factionName(b.targetFaction)}`,
    `Bounty #${opts.id} · expires <t:${opts.expiresAt}:D> · posted by <@${opts.postedBy}>`,
  ].join("\n");
  return { threadName, embed, content };
}
