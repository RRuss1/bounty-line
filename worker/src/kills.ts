/**
 * Kill claims (K codes, spec 9.3) and character links (L codes). Phase 4: every claim goes
 * to officer review; AI stamp reading and auto-approval arrive in Phase 6.
 *
 * Hard failures reply with the Compendium 02 Section 8 message and store nothing. Soft
 * failures (late post, character linked to someone else) still post the proof, with the
 * failing checks listed for the officers.
 */
import type { CharacterLink, KillClaim } from "./codec";
import { FACTION } from "./codec";
import type { Env } from "./env";
import { log } from "./log";
import { refreshPack } from "./pack";
import { SKULL, wantedPoster, wantedPosterImage } from "./poster";
import type { PosterStatus } from "./poster-image";
import type { DiscordRest } from "./rest";
import { audit, type ForumTagKey, type Tenant } from "./tenants";
import { escapeMd, gold } from "./wow";

export interface Attachment {
  url: string;
  filename?: string;
  content_type?: string;
  size?: number;
}

export type Result = { ok: true; message: string } | { ok: false; code: string; message: string };

const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };
const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

export interface BountyRow {
  id: number;
  tenant_id: string;
  target_guid: string;
  target_name: string | null;
  class: string | null;
  race: string | null;
  level: number | null;
  faction: string | null;
  reward_gold: number;
  poster_guid: string | null;
  poster_name: string | null;
  poster_discord_id: string | null;
  zone_map_id: number | null;
  created_at: number | null;
  expires_at: number;
  status: string;
  thread_id: string | null;
}

const fail = (code: string, message: string): Result => ({ ok: false, code, message });
const factionId = (name: string | null) => (name === "Alliance" ? FACTION.Alliance : FACTION.Horde);

// ---------------------------------------------------------------- L: link a character

export async function linkCharacter(env: Env, tenant: Tenant, f: CharacterLink, authorId: string, now: number): Promise<Result> {
  if (f.boardTag !== "0000" && f.boardTag !== tenant.board_tag) return fail("BOARD", "That code belongs to a different Bounty Board.");
  await env.DB.prepare(
    `INSERT INTO characters (tenant_id, guid, name, discord_user_id) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT(tenant_id, guid) DO UPDATE SET name = excluded.name, discord_user_id = excluded.discord_user_id`,
  )
    .bind(tenant.id, f.charGUID, f.charName, authorId)
    .run();
  await audit(env.DB, tenant.id, authorId, "character.link", { guid: f.charGUID, name: f.charName }, now);
  return { ok: true, message: `🔗 Linked **${escapeMd(f.charName)}** to <@${authorId}>. Your kills will be credited to you.` };
}

// ---------------------------------------------------------------- K: claim a kill

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

export async function claimKill(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  k: KillClaim,
  code: string,
  authorId: string,
  attachments: Attachment[],
  now: number,
): Promise<Result> {
  // 1. Code and bounty (spec 9.3 checks 1-3).
  if (k.boardTag !== "0000" && k.boardTag !== tenant.board_tag) return fail("BOARD", "That code belongs to a different Bounty Board.");
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(k.bountyId, tenant.id).first<BountyRow>();
  if (!b) return fail("CLOSED", `Bounty #${k.bountyId} isn't on this Bounty Board.`);
  if (b.status === "review") return fail("CLOSED", `Bounty #${b.id} already has a kill claim waiting for the officers.`);
  if (b.status !== "open" || b.expires_at <= now) return fail("CLOSED", `Bounty #${b.id} is no longer open.`);
  if (k.victimGUID !== b.target_guid) return fail("MISMATCH", `That kill wasn't on ${escapeMd(b.target_name ?? "the target")} (bounty #${b.id}).`);
  if (k.killerFaction === factionId(b.faction)) return fail("FACTION", "Bounties must be on the opposite faction.");
  if (b.poster_guid && k.killerGUID === b.poster_guid) return fail("SELF", "You can't claim your own bounty.");
  if (await env.DB.prepare("SELECT 1 FROM kills WHERE code = ?1").bind(code).first()) return fail("DUPLICATE", "That code was already used.");

  // 2. The screenshot (check 4): one PNG/JPG under 25 MB, never seen before.
  const image = attachments.find((a) => IMAGE_TYPES[(a.content_type ?? "").split(";")[0]!.trim()]);
  if (!image) return fail("NO_IMAGE", "Kill codes need your screenshot attached in the same message.");
  if ((image.size ?? 0) > MAX_IMAGE_BYTES) return fail("NO_IMAGE", "That screenshot is over 25 MB. Attach the PNG or JPG from your Screenshots folder.");
  const res = await fetch(image.url);
  if (!res.ok) return fail("NO_IMAGE", "I couldn't download your screenshot. Try posting it again.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return fail("NO_IMAGE", "That screenshot is over 25 MB.");
  const hash = await sha256Hex(bytes);
  if (await env.DB.prepare("SELECT 1 FROM kills WHERE tenant_id = ?1 AND image_hash = ?2").bind(tenant.id, hash).first()) {
    return fail("DUPLICATE", "That screenshot was already used for a claim.");
  }
  const contentType = (image.content_type ?? "image/png").split(";")[0]!.trim();
  const ext = IMAGE_TYPES[contentType]!;
  const key = `proofs/${tenant.id}/${b.id}/${hash.slice(0, 24)}.${ext}`;
  await env.PROOFS.put(key, bytes, { httpMetadata: { contentType } });

  // 3. Soft checks for the officers (checks 3 and 6).
  const windowHours = tenant.config.proof_window_hours;
  const ageMin = Math.round((now - k.killedAt) / 60);
  const linked = await env.DB.prepare("SELECT discord_user_id FROM characters WHERE tenant_id = ?1 AND guid = ?2")
    .bind(tenant.id, k.killerGUID)
    .first<{ discord_user_id: string | null }>();
  const checks = {
    guid: true,
    notSelf: true,
    honor: (k.flags & 1) === 1,
    pet: (k.flags & 2) === 2,
    window: k.killedAt <= now + 300 && now - k.killedAt <= windowHours * 3600,
    ageMinutes: ageMin,
    linked: linked ? linked.discord_user_id === authorId : null, // null = not linked yet
    imageHash: hash,
  };

  // 4. Record the claim, then show it in the bounty's thread.
  const row = await env.DB.prepare(
    `INSERT INTO kills (tenant_id, bounty_id, killer_guid, killer_name, killer_discord_id, victim_guid, killed_at, zone_map_id,
       code, image_r2_key, image_hash, checks_json, verdict, claimed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'pending', ?13) RETURNING id`,
  )
    .bind(tenant.id, b.id, k.killerGUID, k.killerName, authorId, k.victimGUID, k.killedAt, k.mapID, code, key, hash, JSON.stringify(checks), now)
    .first<{ id: number }>();
  const killId = row!.id;

  const lines = [
    `✅ Victim matches the bounty (GUID)`,
    `✅ Killer isn't the poster`,
    checks.window ? `✅ Posted ${ageMin} min after the kill` : `⚠️ Posted ${ageMin} min after the kill (limit ${windowHours}h)`,
    checks.honor ? "✅ Honor kill confirmed in game" : "➖ No honor message (some kills give none)",
    checks.linked === true ? "✅ Character linked to this Discord user" : checks.linked === false ? "⚠️ Character is linked to a different Discord user" : "➖ Character not linked yet (`/bl link` in game)",
    ...(checks.pet ? ["🐾 Killing blow by their pet"] : []),
  ];
  const embed = {
    title: `💰 BOUNTY CLAIMED by ${escapeMd(k.killerName)}`,
    color: 0xd4a017,
    description: [
      `<@${authorId}> claims **${gold(b.reward_gold)}** for killing **${escapeMd(b.target_name ?? "the target")}** <t:${k.killedAt}:f>.`,
      "",
      ...lines,
      "",
      `Verdict: **NEEDS OFFICER REVIEW** (<@&${tenant.officer_role_id}>)`,
    ].join("\n"),
    image: { url: `attachment://proof.${ext}` },
    footer: { text: `Claim #${killId} · Bounty #${b.id}` },
  };
  const components = [
    {
      type: 1,
      components: [
        { type: 2, style: 3, label: "Approve", custom_id: `kill:approve:${killId}` },
        { type: 2, style: 4, label: "Deny", custom_id: `kill:deny:${killId}` },
      ],
    },
  ];
  let proofId: string | null = null;
  if (b.thread_id) {
    try {
      const sent = await rest.sendFiles(
        b.thread_id,
        { content: "", embeds: [embed], components, allowed_mentions: { parse: [] } },
        [{ name: `proof.${ext}`, data: new Uint8Array(bytes), type: contentType }],
      );
      proofId = sent.id;
    } catch (e) {
      log(env, "error", "kill.proof_post_failed", { tenant_id: tenant.id, bounty_id: b.id, error: String(e) });
    }
  }
  await env.DB.prepare("UPDATE kills SET proof_message_id = ?1 WHERE id = ?2").bind(proofId, killId).run();
  await setBountyStatus(env, rest, tenant, b, "review", now);
  await audit(env.DB, tenant.id, authorId, "kill.claim", { kill: killId, bounty: b.id }, now);
  log(env, "info", "kill.claimed", { tenant_id: tenant.id, bounty_id: b.id, kill_id: killId, outcome: "pending" });
  const where = b.thread_id ? `<#${b.thread_id}>` : `bounty #${b.id}`;
  return { ok: true, message: `${SKULL} Kill claim on **${escapeMd(b.target_name ?? "the target")}** received. Officers will review it in ${where}.` };
}

// ---------------------------------------------------------------- status changes

const STATUS_TAG: Record<string, ForumTagKey> = {
  open: "open",
  review: "review",
  awaiting_payment: "awaiting_payment",
  paid: "paid",
  expired: "expired",
  cancelled: "cancelled",
};

/** Moves a bounty to a new status: database, forum tag, poster picture, then the Bounty Pack. */
export async function setBountyStatus(env: Env, rest: DiscordRest, tenant: Tenant, b: BountyRow, status: PosterStatus, now: number): Promise<void> {
  await env.DB.prepare("UPDATE bounties SET status = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(status, b.id, tenant.id).run();
  const updated = { ...b, status };
  if (b.thread_id) {
    const tag = tenant.config.forum_tags[STATUS_TAG[status]!];
    if (tag) await rest.setThreadTags(b.thread_id, [tag]).catch((e) => log(env, "warn", "bounty.tag_failed", { tenant_id: tenant.id, error: String(e) }));
    try {
      const post = rowToPost(updated);
      const poster = wantedPoster(post, { id: b.id, expiresAt: b.expires_at, postedBy: b.poster_discord_id ?? "", tenant, status });
      const image = await wantedPosterImage(env, post, { id: b.id, expiresAt: b.expires_at, tenant, status });
      // The forum post's first message has the thread's id.
      await rest.editPost(b.thread_id, b.thread_id, { content: poster.content, embed: poster.embed, image });
    } catch (e) {
      log(env, "warn", "bounty.poster_update_failed", { tenant_id: tenant.id, bounty_id: b.id, error: String(e) });
    }
  }
  await refreshPack(env, rest, tenant, now);
}

/** Rebuilds the B-code view of a stored bounty, for redrawing its poster. */
export function rowToPost(b: BountyRow) {
  return {
    schema: 1,
    boardTag: "",
    targetGUID: b.target_guid,
    targetName: b.target_name ?? "",
    targetClassID: Number(b.class) || 0,
    targetRaceID: Number(b.race) || 0,
    targetLevel: b.level ?? 0,
    targetFaction: factionId(b.faction),
    posterFaction: factionId(b.faction) === FACTION.Alliance ? FACTION.Horde : FACTION.Alliance,
    rewardGold: b.reward_gold,
    posterGUID: b.poster_guid ?? "",
    posterName: b.poster_name ?? "",
    mapID: b.zone_map_id ?? 0,
    createdAt: b.created_at ?? 0,
    nonce: 0,
    note: "",
    mode: 0,
    existingBountyId: 0,
  };
}

// ---------------------------------------------------------------- officer review (buttons)

export interface ReviewResult {
  /** Shown only to the clicker (permission problems, already reviewed). */
  ephemeral?: string;
  /** The proof post, updated: buttons removed, verdict line added. */
  update?: { content: string; components: unknown[] };
}

export async function reviewKill(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  action: "approve" | "deny",
  killId: number,
  officer: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
): Promise<ReviewResult> {
  if (!officer.isAdmin && !(tenant.officer_role_id && officer.roles.includes(tenant.officer_role_id))) {
    return { ephemeral: `Only <@&${tenant.officer_role_id}> can approve or deny kill claims.` };
  }
  const kill = await env.DB.prepare("SELECT id, bounty_id, verdict, killer_discord_id FROM kills WHERE id = ?1 AND tenant_id = ?2")
    .bind(killId, tenant.id)
    .first<{ id: number; bounty_id: number; verdict: string; killer_discord_id: string | null }>();
  if (!kill) return { ephemeral: "I can't find that claim any more." };
  if (kill.verdict !== "pending") return { ephemeral: `That claim was already ${kill.verdict}.` };
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(kill.bounty_id, tenant.id).first<BountyRow>();

  const verdict = action === "approve" ? "approved" : "denied";
  await env.DB.prepare("UPDATE kills SET verdict = ?1, reviewed_by = ?2 WHERE id = ?3 AND verdict = 'pending'").bind(verdict, officer.id, killId).run();
  if (kill.killer_discord_id) {
    const col = action === "approve" ? "approved" : "denied";
    await env.DB.prepare(
      `INSERT INTO hunters (tenant_id, discord_user_id, ${col}) VALUES (?1, ?2, 1)
       ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET ${col} = ${col} + 1${action === "deny" ? ", trust = 'new'" : ""}`,
    )
      .bind(tenant.id, kill.killer_discord_id)
      .run();
  }
  if (b && b.status === "review") await setBountyStatus(env, rest, tenant, b, action === "approve" ? "awaiting_payment" : "open", now);
  await audit(env.DB, tenant.id, officer.id, `kill.${verdict}`, { kill: killId, bounty: kill.bounty_id }, now);
  log(env, "info", "kill.reviewed", { tenant_id: tenant.id, kill_id: killId, outcome: verdict });

  const line =
    action === "approve"
      ? `✅ **Approved** by <@${officer.id}>. <@${b?.poster_discord_id ?? ""}>, please pay ${b ? gold(b.reward_gold) : "the reward"} to <@${kill.killer_discord_id ?? ""}> in game.`
      : `❌ **Denied** by <@${officer.id}>. The bounty is open again.`;
  return { update: { content: line, components: [] } };
}
