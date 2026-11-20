/**
 * The code pipeline shared by chat pastes (gateway) and /bl submit.
 * Callers have already passed the allowlist check and loaded the tenant.
 */
import { decode, type BountyPost } from "./codec";
import type { Env } from "./env";
import { log } from "./log";
import { SKULL, wantedPoster } from "./poster";
import type { DiscordRest } from "./rest";
import { checkBountyPost, decodeErrorMessage } from "./rules";
import { audit, type Tenant } from "./tenants";
import { escapeMd, gold } from "./wow";

export type Outcome =
  | { ok: true; bountyId: number; threadId: string; message: string }
  | { ok: false; code: string; message: string }
  | { ok: null }; // ignored (packs pasted in chat)

/** Codes in a chat message (spec 7.4), including other versions so outdated addons get a helpful reply. */
export function extractCodes(text: string, max = 5): string[] {
  return (text.match(/BL[0-9]+-[A-Z]{1,2}-[0-9A-Z]+(?:-[0-9A-Z]+)+/gi) ?? []).slice(0, max);
}

export async function processCode(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  raw: string,
  authorId: string,
  now: number,
): Promise<Outcome> {
  const r = decode(raw);
  if (!r.ok) return { ok: false, ...decodeErrorMessage(r.error) };
  if (r.type === "P") return { ok: null };
  if (r.type !== "B") {
    const what = r.type === "K" ? "Kill claims" : "Character links";
    return { ok: false, code: "NOT_YET", message: `${what} open in the next Bounty Board update. Keep your code; it'll still work.` };
  }
  return postBounty(env, rest, tenant, r.fields, r.code, authorId, now);
}

async function postBounty(env: Env, rest: DiscordRest, tenant: Tenant, b: BountyPost, code: string, authorId: string, now: number): Promise<Outcome> {
  const broken = checkBountyPost(b, tenant, now);
  if (broken) return { ok: false, ...broken };

  const DUPLICATE = { ok: false as const, code: "DUPLICATE", message: "That code was already used." };
  if (await env.DB.prepare("SELECT 1 FROM bounties WHERE source_code = ?1").bind(code).first()) return DUPLICATE;

  const existing = await env.DB.prepare(
    "SELECT id FROM bounties WHERE tenant_id = ?1 AND target_guid = ?2 AND status IN ('open', 'review', 'awaiting_payment')",
  )
    .bind(tenant.id, b.targetGUID)
    .first<{ id: number }>();
  if (existing) {
    return {
      ok: false,
      code: "EXISTS",
      message: `There's already a bounty on ${escapeMd(b.targetName)} (#${existing.id}). Adding gold to it arrives in a later update.`,
    };
  }

  // Insert first: the UNIQUE source_code settles races between two pastes of the same code.
  const expiresAt = now + tenant.config.expiry_days * 86400;
  let id: number;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO bounties (tenant_id, target_guid, target_name, class, race, level, faction, reward_gold,
         poster_guid, poster_name, poster_discord_id, zone_map_id, created_at, expires_at, status, source_code)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, 'open', ?15) RETURNING id`,
    )
      .bind(
        tenant.id,
        b.targetGUID,
        b.targetName,
        String(b.targetClassID),
        String(b.targetRaceID),
        b.targetLevel,
        b.targetFaction === 1 ? "Alliance" : "Horde",
        b.rewardGold,
        b.posterGUID,
        b.posterName,
        authorId,
        b.mapID,
        now,
        expiresAt,
        code,
      )
      .first<{ id: number }>();
    id = row!.id;
  } catch (e) {
    if (String(e).includes("bounties.source_code")) return DUPLICATE; // lost a race with the same paste
    throw e;
  }

  const poster = wantedPoster(b, { id, expiresAt, postedBy: authorId, tenant });
  const openTag = tenant.config.forum_tags.open;
  let threadId: string;
  try {
    const thread = await rest.createForumPost(tenant.bounty_board_forum!, {
      name: poster.threadName,
      tagIds: openTag ? [openTag] : [],
      content: poster.content,
      embed: poster.embed,
    });
    threadId = thread.id;
  } catch (e) {
    // No poster, no bounty: roll back so the code can be pasted again once permissions are fixed.
    await env.DB.prepare("DELETE FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant.id).run();
    log(env, "error", "poster.failed", { tenant_id: tenant.id, error: String(e) });
    return {
      ok: false,
      code: "POSTER",
      message: `I couldn't create the wanted poster in <#${tenant.bounty_board_forum}>. An admin should check my permissions there, then paste the code again.`,
    };
  }

  await env.DB.prepare("UPDATE bounties SET thread_id = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(threadId, id, tenant.id).run();
  await audit(env.DB, tenant.id, authorId, "bounty.create", { id, target: b.targetGUID, reward: b.rewardGold }, now);
  log(env, "info", "bounty.created", { tenant_id: tenant.id, bounty_id: id, outcome: "ok" });
  return {
    ok: true,
    bountyId: id,
    threadId,
    message: `${SKULL} Bounty #${id} on **${escapeMd(b.targetName)}** for **${gold(b.rewardGold)}** is up: <#${threadId}>`,
  };
}
