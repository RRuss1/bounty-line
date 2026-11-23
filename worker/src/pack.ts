/**
 * The Bounty Pack (spec 5.5, Compendium 02 Section 3.3): every open bounty, as a P code the
 * addon imports with /bl import. The bot keeps it pinned in #bounty-line and edits it whenever
 * a bounty opens or closes.
 */
import { encodePack, FACTION, type PackEntry, type PackTerms } from "./codec";
import type { Env } from "./env";
import { log } from "./log";
import type { DiscordRest } from "./rest";
import { packSeasons } from "./seasons";
import { patchConfig, type Tenant } from "./tenants";
import { allOrNothing, isExpanded, killsWanted, termsOf } from "./terms";

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
  kills_wanted: number;
  payout_mode: number;
  terms_json: string;
  kills_done: number;
}

/** packVersion: normally the build time; the relay passes a fixed value to compare packs by content. */
export async function buildPack(env: Env, tenant: Tenant, now: number, packVersion = now): Promise<{ codes: string[]; count: number; seasons: number }> {
  const { results } = await env.DB.prepare(
    `SELECT b.id, b.target_guid, b.target_name, b.class, b.faction, b.reward_gold, b.poster_name, b.expires_at,
            b.kills_wanted, b.payout_mode, b.terms_json,
            (SELECT COUNT(*) FROM kills k WHERE k.tenant_id = b.tenant_id AND k.bounty_id = b.id AND k.verdict IN ('approved', 'auto')) AS kills_done
       FROM bounties b WHERE b.tenant_id = ?1 AND b.status = 'open' AND b.expires_at > ?2 ORDER BY b.id`,
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
  // Bounty terms (spec 5.4c) ride in schema 3, written only when a bounty has some.
  const bountyTerms: PackTerms[] = results.filter(isExpanded).map((r) => ({
    bountyId: r.id,
    kills: killsWanted(r),
    killsLeft: allOrNothing(r) ? killsWanted(r) : Math.max(0, killsWanted(r) - r.kills_done),
    payout: r.payout_mode,
    terms: termsOf(r),
  }));
  // Open seasons ride in schema 2, written only when there is one: older addons read either.
  const seasons = await packSeasons(env, tenant, now);
  const codes = encodePack(
    {
      schema: bountyTerms.length ? 3 : seasons.length ? 2 : 1,
      boardTag: tenant.board_tag,
      packVersion,
      minAddonVersion: MIN_ADDON_VERSION,
      discordDisplayName: tenant.config.discord_display_name || tenant.wow_guild_name || "",
      rewardMin: tenant.config.reward_min,
      rewardMax: tenant.config.reward_max,
      bounties,
      ...(seasons.length || bountyTerms.length ? { seasons } : {}),
      ...(bountyTerms.length ? { bountyTerms } : {}),
    },
    PACK_PART_LENGTH,
  );
  return { codes, count: bounties.length, seasons: seasons.length };
}

export function packMessage(code: string, part: number, parts: number, count: number, now: number, seasons = 0): string {
  const what = (count === 1 ? "1 open bounty" : `${count} open bounties`) + (seasons ? ` · ${seasons} Open Season${seasons === 1 ? "" : "s"}` : "");
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
 * `repost` (/bl pack) posts and pins a fresh copy at the bottom of the channel and deletes
 * the old one; the automatic refreshes edit in place so the channel stays quiet.
 */
export async function refreshPack(env: Env, rest: DiscordRest, tenant: Tenant, now: number, repost = false): Promise<string | null> {
  const channel = tenant.bounty_line_ch;
  if (!channel) return null;
  try {
    const { codes, count, seasons } = await buildPack(env, tenant, now);
    const old = tenant.config.pack_message_ids ?? [];
    const ids: string[] = [];
    for (let i = 0; i < codes.length; i++) {
      const text = packMessage(codes[i]!, i + 1, codes.length, count, now, seasons);
      const existing = old[i];
      if (existing && !repost) {
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
    // Old copies go only after the new ones are up, so the channel is never without a pack.
    for (const extra of repost ? old : old.slice(codes.length)) await rest.deleteMessage(channel, extra).catch(() => undefined);
    if (ids.join() !== old.join()) await patchConfig(env.DB, tenant.id, { pack_message_ids: ids });
    tenant.config.pack_message_ids = ids;
    return `https://discord.com/channels/${tenant.id}/${channel}/${ids[0]}`;
  } catch (e) {
    log(env, "error", "pack.refresh_failed", { tenant_id: tenant.id, error: String(e) });
    return null;
  }
}
