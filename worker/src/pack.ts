/**
 * The Bounty Pack (spec 5.5, Compendium 02 Section 3.3): every open bounty, as a P code the
 * addon imports with /bl import. The bot keeps it pinned in #bounty-line and edits it whenever
 * a bounty opens or closes.
 */
import { encodePack, FACTION, type PackEntry } from "./codec";
import type { Env } from "./env";
import { log } from "./log";
import type { DiscordRest } from "./rest";
import { patchConfig, type Tenant } from "./tenants";

/** Oldest addon that reads this pack (major*1000 + minor): 0.4 added /bl import. */
export const MIN_ADDON_VERSION = 4;

/**
 * Each part goes in one Discord message (2,000 characters) with a short header and a code
 * block, so parts are kept well under the 3,800 the code format allows.
 */
export const PACK_PART_LENGTH = 1750;

interface OpenRow {
  id: number;
  target_guid: string;
  target_name: string | null;
  class: string | null;
  faction: string | null;
  reward_gold: number;
  poster_name: string | null;
  expires_at: number;
}

/** packVersion: normally the build time; the relay passes a fixed value to compare packs by content. */
export async function buildPack(env: Env, tenant: Tenant, now: number, packVersion = now): Promise<{ codes: string[]; count: number }> {
  const { results } = await env.DB.prepare(
    `SELECT id, target_guid, target_name, class, faction, reward_gold, poster_name, expires_at
       FROM bounties WHERE tenant_id = ?1 AND status = 'open' AND expires_at > ?2 ORDER BY id`,
  )
    .bind(tenant.id, now)
    .all<OpenRow>();
  const bounties: PackEntry[] = results.map((r) => ({
    bountyId: r.id,
    targetGUID: r.target_guid,
    targetName: r.target_name ?? "",
    targetClassID: Number(r.class) || 0,
    targetFaction: r.faction === "Alliance" ? FACTION.Alliance : FACTION.Horde,
    rewardGold: r.reward_gold,
    posterName: r.poster_name ?? "",
    expiresAt: r.expires_at,
  }));
  const codes = encodePack(
    {
      schema: 1,
      boardTag: tenant.board_tag,
      packVersion,
      minAddonVersion: MIN_ADDON_VERSION,
      discordDisplayName: tenant.config.discord_display_name || tenant.wow_guild_name || "",
      rewardMin: tenant.config.reward_min,
      rewardMax: tenant.config.reward_max,
      bounties,
    },
    PACK_PART_LENGTH,
  );
  return { codes, count: bounties.length };
}

export function packMessage(code: string, part: number, parts: number, count: number, now: number): string {
  const what = count === 1 ? "1 open bounty" : `${count} open bounties`;
  return [
    `**📦 Bounty Pack** · ${what} · updated <t:${now}:R>${parts > 1 ? ` · **part ${part} of ${parts}**` : ""}`,
    parts > 1
      ? "In game: type `/bl import` and paste **every part** (any order) into the box."
      : "In game: type `/bl import` and paste this into the box. One guildie importing it is enough once guild sync arrives.",
    "```",
    code,
    "```",
  ].join("\n");
}

/**
 * Posts or edits the pinned pack message(s) in #bounty-line. Never throws: a failed pack
 * update must not fail the bounty that triggered it. Returns the first message's link.
 */
export async function refreshPack(env: Env, rest: DiscordRest, tenant: Tenant, now: number): Promise<string | null> {
  const channel = tenant.bounty_line_ch;
  if (!channel) return null;
  try {
    const { codes, count } = await buildPack(env, tenant, now);
    const old = tenant.config.pack_message_ids ?? [];
    const ids: string[] = [];
    for (let i = 0; i < codes.length; i++) {
      const text = packMessage(codes[i]!, i + 1, codes.length, count, now);
      const existing = old[i];
      if (existing) {
        try {
          await rest.editMessage(channel, existing, text);
          ids.push(existing);
          continue;
        } catch {
          // deleted by someone: post a new one below
        }
      }
      const sent = await rest.sendMessage(channel, text);
      await rest.pinMessage(channel, sent.id).catch(() => undefined);
      ids.push(sent.id);
    }
    for (const extra of old.slice(codes.length)) await rest.deleteMessage(channel, extra).catch(() => undefined);
    if (ids.join() !== old.join()) await patchConfig(env.DB, tenant.id, { pack_message_ids: ids });
    tenant.config.pack_message_ids = ids;
    return `https://discord.com/channels/${tenant.id}/${channel}/${ids[0]}`;
  } catch (e) {
    log(env, "error", "pack.refresh_failed", { tenant_id: tenant.id, error: String(e) });
    return null;
  }
}
