/**
 * The code pipeline shared by chat pastes (gateway) and /bl submit.
 * Callers have already passed the allowlist check and loaded the tenant.
 */
import { decode, type BountyPost } from "./codec";
import { claimKill, linkCharacter, setBountyStatus, type Attachment, type BountyRow } from "./kills";
import type { Env } from "./env";
import { log } from "./log";
import { refreshPack } from "./pack";
import { SKULL, wantedPoster, wantedPosterImage } from "./poster";
import type { DiscordRest } from "./rest";
import { checkBountyPost, decodeErrorMessage } from "./rules";
import { claimSeasonKill, isSeasonKill, postSeason } from "./seasons";
import { audit, type Tenant } from "./tenants";
import { escapeMd, gold } from "./wow";

export type Outcome =
  | { ok: true; message: string; bountyId?: number; threadId?: string }
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
  attachments: Attachment[] = [],
): Promise<Outcome> {
  const r = decode(raw);
  if (!r.ok) return { ok: false, ...decodeErrorMessage(r.error) };
  if (r.type === "P") return { ok: null };
  if (r.type === "K") {
    const k = r.fields;
    if (!isSeasonKill(k)) return claimKill(env, rest, tenant, k, r.code, authorId, attachments, now);
    // An Open Season kill (spec 5.11). The victim may have a personal bounty too: one code claims both.
    const season = await claimSeasonKill(env, rest, tenant, k, r.code, authorId, attachments, now);
    const personal =
      k.bountyId !== 0 ||
      !!(await env.DB.prepare("SELECT 1 FROM bounties WHERE tenant_id = ?1 AND target_guid = ?2 AND status = 'open' AND expires_at > ?3")
        .bind(tenant.id, k.victimGUID, now)
        .first());
    if (!personal) return season;
    const bounty = await claimKill(env, rest, tenant, k, r.code, authorId, attachments, now);
    if (bounty.ok && season.ok) return { ok: true, message: `${bounty.message}\n${season.message}` };
    // Half of it went through: answer with the failure (❌ and the reason), naming what did count.
    if (bounty.ok && !season.ok) return { ok: false, code: season.code, message: `The bounty claim went in, but not the Open Season one: ${season.message}` };
    if (season.ok && !bounty.ok) return { ok: false, code: bounty.code, message: `The Open Season kill counted, but not the bounty claim: ${bounty.message}` };
    return bounty;
  }
  if (r.type === "L") return linkCharacter(env, tenant, r.fields, authorId, now);
  if (r.type === "S") return postSeason(env, rest, tenant, r.fields, r.code, authorId, now);
  return postBounty(env, rest, tenant, r.fields, r.code, authorId, now);
}

async function postBounty(env: Env, rest: DiscordRest, tenant: Tenant, b: BountyPost, code: string, authorId: string, now: number): Promise<Outcome> {
  const broken = checkBountyPost(b, tenant, now);
  if (broken) return { ok: false, ...broken };

  const DUPLICATE = { ok: false as const, code: "DUPLICATE", message: "That code was already used." };
  if (await env.DB.prepare("SELECT 1 FROM bounties WHERE source_code = ?1").bind(code).first()) return DUPLICATE;
  if (await env.DB.prepare("SELECT 1 FROM contributions WHERE source_code = ?1").bind(code).first()) return DUPLICATE;
  if (b.mode === 1) return stackBounty(env, rest, tenant, b, code, authorId, now);

  const existing = await env.DB.prepare(
    "SELECT id FROM bounties WHERE tenant_id = ?1 AND target_guid = ?2 AND status IN ('open', 'review', 'awaiting_payment')",
  )
    .bind(tenant.id, b.targetGUID)
    .first<{ id: number }>();
  if (existing) {
    return {
      ok: false,
      code: "EXISTS",
      message: tenant.config.allow_stacking
        ? `There's already a bounty on ${escapeMd(b.targetName)} (#${existing.id}). To add gold, right-click them in game → **Add to Bounty…**.`
        : `There's already a bounty on ${escapeMd(b.targetName)} (#${existing.id}).`,
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
  const image = await wantedPosterImage(env, b, { id, expiresAt, tenant });
  const openTag = tenant.config.forum_tags.open;
  let threadId: string;
  try {
    const thread = await rest.createForumPost(tenant.bounty_board_forum!, {
      name: poster.threadName,
      tagIds: openTag ? [openTag] : [],
      content: poster.content,
      embed: poster.embed,
      image,
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
  await addContribution(env, tenant, id, b, code, authorId, now);
  await audit(env.DB, tenant.id, authorId, "bounty.create", { id, target: b.targetGUID, reward: b.rewardGold }, now);
  log(env, "info", "bounty.created", { tenant_id: tenant.id, bounty_id: id, outcome: "ok" });
  // The pinned pack is edited in place, so it never shows at the bottom of the channel: link it.
  const packLink = await refreshPack(env, rest, tenant, now);
  return {
    ok: true,
    bountyId: id,
    threadId,
    message: [
      `${SKULL} Bounty #${id} on **${escapeMd(b.targetName)}** for **${gold(b.rewardGold)}** is up: <#${threadId}>`,
      ...(packLink ? [`📦 [Bounty Pack](${packLink}) updated: copy it and type \`/bl import\` in game.`] : []),
    ].join("\n"),
  };
}

// ---------------------------------------------------------------- stacking (spec 10)

async function addContribution(env: Env, tenant: Tenant, bountyId: number, b: BountyPost, code: string, authorId: string, now: number) {
  await env.DB.prepare(
    `INSERT INTO contributions (tenant_id, bounty_id, poster_discord_id, poster_name, poster_guid, reward_gold, source_code, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(tenant.id, bountyId, authorId, b.posterName, b.posterGUID, b.rewardGold, code, now)
    .run();
}

/** "Add to Bounty…" (B code, mode 1): more gold on an open bounty. Each contributor pays their share. */
async function stackBounty(env: Env, rest: DiscordRest, tenant: Tenant, b: BountyPost, code: string, authorId: string, now: number): Promise<Outcome> {
  if (!tenant.config.allow_stacking) return { ok: false, code: "STACK", message: "This Bounty Board doesn't allow adding gold to bounties." };
  const row = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(b.existingBountyId, tenant.id).first<BountyRow>();
  if (!row) return { ok: false, code: "CLOSED", message: `Bounty #${b.existingBountyId} isn't on this Bounty Board.` };
  if (row.target_guid !== b.targetGUID) return { ok: false, code: "MISMATCH", message: `That code isn't for bounty #${row.id}'s target.` };
  if (row.status !== "open" || row.expires_at <= now) return { ok: false, code: "CLOSED", message: `Bounty #${row.id} is no longer open.` };
  try {
    await addContribution(env, tenant, row.id, b, code, authorId, now);
  } catch (e) {
    if (String(e).includes("contributions.source_code")) return { ok: false, code: "DUPLICATE", message: "That code was already used." };
    throw e;
  }
  await env.DB.prepare("UPDATE bounties SET reward_gold = reward_gold + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(b.rewardGold, row.id, tenant.id).run();
  const total = row.reward_gold + b.rewardGold;
  const updated = { ...row, reward_gold: total };
  // Same status: this redraws the poster with the new total and refreshes the pack.
  await setBountyStatus(env, rest, tenant, updated, "open", now);
  if (row.thread_id) {
    await rest.renameThread(row.thread_id, `${SKULL} ${row.target_name ?? "Unknown"} · ${gold(total)}`.slice(0, 100)).catch(() => undefined);
  }
  await audit(env.DB, tenant.id, authorId, "bounty.stack", { id: row.id, added: b.rewardGold, total }, now);
  return {
    ok: true,
    bountyId: row.id,
    threadId: row.thread_id ?? undefined,
    message: `💰 **${escapeMd(b.posterName || "Someone")}** added **${gold(b.rewardGold)}** to bounty #${row.id} on **${escapeMd(row.target_name ?? "?")}**: now **${gold(total)}**${row.thread_id ? ` <#${row.thread_id}>` : ""}`,
  };
}
