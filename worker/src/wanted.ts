/**
 * Bounties set by name from Discord (spec 5.12): `/bl wanted name: faction: gold:` for an enemy
 * nobody has met in game yet. The bounty has no GUID: `target_guid` holds "name:<lowercase name>"
 * until an officer approves a kill on it, which locks it to the victim's GUID. Addons match the
 * name themselves (pack schema 4) and mark the player like any bounty once they see them.
 */
import { decode, FACTION } from "./codec";
import type { Env } from "./env";
import { type BountyRow, rowToPost } from "./kills";
import { log } from "./log";
import { refreshPack } from "./pack";
import { SKULL, wantedPoster, wantedPosterImage } from "./poster";
import { posterChecks } from "./limits";
import type { DiscordRest } from "./rest";
import { audit, bountyTagIds, type Tenant } from "./tenants";
import { escapeMd, gold } from "./wow";

export const NAME_PREFIX = "name:";

/** "  Grimlok   ASHVEIL " -> "grimlok ashveil": how two names are compared. */
export const normalName = (name: string) => name.trim().replace(/\s+/g, " ").toLowerCase();

/** The stand-in GUID of a bounty set by name. */
export const nameKey = (name: string) => NAME_PREFIX + normalName(name);

/** True for a bounty set by name and not yet locked to a player. Takes a row or its target_guid. */
export const isNameOnly = (b: { target_guid: string } | string) => (typeof b === "string" ? b : b.target_guid).startsWith(NAME_PREFIX);

export const sameName = (a: string, b: string) => normalName(a) !== "" && normalName(a) === normalName(b);

/** A character name as the game shows it: one to three words of letters, ' or -, 2 to 40 characters. */
const NAME_RE = /^\p{L}[\p{L}'-]*(?: \p{L}[\p{L}'-]*){0,2}$/u;
export const MAX_NAME = 40;

export function checkName(raw: string): string | null {
  const name = raw.trim().replace(/\s+/g, " ");
  if ([...name].length < 2 || [...name].length > MAX_NAME || !NAME_RE.test(name)) return null;
  return name;
}

/** /bl wanted: a bounty on an enemy known only by name. Returns the reply. */
export async function postWanted(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  input: { name: string; faction: string; gold: number },
  authorId: string,
  discordName: string,
  now: number,
): Promise<string> {
  const name = checkName(input.name);
  if (!name) return "❌ Type the character's full name as the game shows it, like `Grimlok Ashveil` (letters only, at most 40).";
  const faction = input.faction === "Alliance" ? FACTION.Alliance : input.faction === "Horde" ? FACTION.Horde : 0;
  if (!faction) return "❌ Pick the enemy's faction: Alliance or Horde.";
  const { reward_min, reward_max, expiry_days } = tenant.config;
  if (!Number.isInteger(input.gold) || input.gold < reward_min || input.gold > reward_max) return `❌ Reward must be between ${gold(reward_min)} and ${gold(reward_max)}.`;
  const limited = await posterChecks(env, tenant, authorId, now, { newBounty: true });
  if (limited) return `❌ ${limited.message}`;

  // One open bounty per player: by name, or a GUID bounty whose name matches.
  const existing = await env.DB.prepare(
    `SELECT id, target_guid FROM bounties WHERE tenant_id = ?1 AND status IN ('open', 'review', 'awaiting_payment')
       AND (target_guid = ?2 OR LOWER(target_name) = ?3) ORDER BY id LIMIT 1`,
  )
    .bind(tenant.id, nameKey(name), normalName(name))
    .first<{ id: number; target_guid: string }>();
  if (existing) return `❌ There's already a bounty on **${escapeMd(name)}** (#${existing.id}).`;

  // The poster's name on the poster: their linked character, or their Discord name.
  const linked = await env.DB.prepare("SELECT name FROM characters WHERE tenant_id = ?1 AND discord_user_id = ?2 AND name IS NOT NULL LIMIT 1")
    .bind(tenant.id, authorId)
    .first<{ name: string }>();
  const posterName = [...(linked?.name || discordName || "")].slice(0, MAX_NAME).join("");

  const expiresAt = now + expiry_days * 86400;
  const row = await env.DB.prepare(
    `INSERT INTO bounties (tenant_id, target_guid, target_name, faction, reward_gold, poster_name, poster_discord_id,
       created_at, expires_at, status)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'open') RETURNING *`,
  )
    .bind(tenant.id, nameKey(name), name, faction === FACTION.Alliance ? "Alliance" : "Horde", input.gold, posterName, authorId, now, expiresAt)
    .first<BountyRow>();
  const b = row!;

  const post = rowToPost(b);
  const poster = wantedPoster(post, { id: b.id, expiresAt, postedBy: authorId, tenant, killsDone: 0 });
  const image = await wantedPosterImage(env, post, { id: b.id, expiresAt, tenant });
  const { hunter_role: role, hunter_ping_min_gold: pingMin } = tenant.config;
  const pingRole = role && pingMin > 0 && input.gold >= pingMin ? role : undefined;
  let threadId: string;
  try {
    const thread = await rest.createForumPost(tenant.bounty_board_forum!, {
      name: poster.threadName,
      tagIds: bountyTagIds(tenant, "open", input.gold),
      content: pingRole ? `${poster.content}\n<@&${pingRole}> new bounty!` : poster.content,
      embed: poster.embed,
      image,
      pingRole,
    });
    threadId = thread.id;
  } catch (e) {
    await env.DB.prepare("DELETE FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(b.id, tenant.id).run();
    log(env, "error", "poster.failed", { tenant_id: tenant.id, error: String(e) });
    return `❌ I couldn't create the wanted poster in <#${tenant.bounty_board_forum}>. An admin should check my permissions there, then try again.`;
  }
  await env.DB.prepare("UPDATE bounties SET thread_id = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(threadId, b.id, tenant.id).run();
  // The poster is the one contributor: payment works as for any bounty.
  await env.DB.prepare(
    `INSERT INTO contributions (tenant_id, bounty_id, poster_discord_id, poster_name, reward_gold, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6)`,
  )
    .bind(tenant.id, b.id, authorId, posterName, input.gold, now)
    .run();
  await audit(env.DB, tenant.id, authorId, "bounty.wanted", { id: b.id, name, reward: input.gold }, now);
  log(env, "info", "bounty.created", { tenant_id: tenant.id, bounty_id: b.id, outcome: "by_name" });
  const packLink = await refreshPack(env, rest, tenant, now);
  return [
    `${SKULL} Bounty #${b.id} on **${escapeMd(name)}** for **${gold(input.gold)}** is up: <#${threadId}>`,
    "It's set by name: guildies' addons mark them as soon as someone sees them in game. Kills on it go to the officers, and the first approved one locks it to that player.",
    ...(packLink ? [`📦 [Bounty Pack](${packLink}) updated: copy it and type \`/bl import\` in game.`] : []),
  ].join("\n");
}

/**
 * An approved kill locks a bounty set by name to the victim: their GUID, and their level if the
 * hunter's addon saw it. Returns the row as it now is.
 */
export async function lockToVictim(env: Env, tenant: Tenant, b: BountyRow, killId: number): Promise<BountyRow> {
  const kill = await env.DB.prepare("SELECT victim_guid, code FROM kills WHERE id = ?1 AND tenant_id = ?2")
    .bind(killId, tenant.id)
    .first<{ victim_guid: string | null; code: string | null }>();
  if (!kill?.victim_guid || isNameOnly(kill.victim_guid)) return b;
  const r = kill.code ? decode(kill.code) : null;
  const victimLevel = r && r.ok && r.type === "K" ? (r.fields.victimLevel ?? 0) : 0;
  const level = victimLevel > 0 ? victimLevel : b.level;
  const done = await env.DB.prepare(
    "UPDATE bounties SET target_guid = ?3, level = ?4 WHERE id = ?1 AND tenant_id = ?2 AND target_guid LIKE 'name:%'",
  )
    .bind(b.id, tenant.id, kill.victim_guid, level)
    .run();
  if ((done.meta?.changes ?? 0) === 0) return b;
  log(env, "info", "bounty.locked", { tenant_id: tenant.id, bounty_id: b.id });
  return { ...b, target_guid: kill.victim_guid, level };
}
