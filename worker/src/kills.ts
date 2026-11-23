/**
 * Kill claims (K codes, spec 9.3) and character links (L codes). Phase 4: every claim goes
 * to officer review; AI stamp reading and auto-approval arrive in Phase 6.
 *
 * Hard failures reply with the Compendium 02 Section 8 message and store nothing. Soft
 * failures (late post, character linked to someone else) still post the proof, with the
 * failing checks listed for the officers.
 */
import { checkStamp, type StampResult } from "./ai";
import type { CharacterLink, KillClaim } from "./codec";
import { FACTION } from "./codec";
import type { Env } from "./env";
import { log } from "./log";
import { refreshPack } from "./pack";
import { postPaymentPrompt } from "./payments";
import { SKULL, wantedPoster, wantedPosterImage } from "./poster";
import type { PosterStatus } from "./poster-image";
import type { DiscordRest } from "./rest";
import { audit, type ForumTagKey, type Tenant } from "./tenants";
import { escapeMd, gold, openWorldCheck } from "./wow";

export interface Attachment {
  url: string;
  filename?: string;
  content_type?: string;
  size?: number;
}

export type Result = { ok: true; message: string } | { ok: false; code: string; message: string };

export const IMAGE_TYPES: Record<string, string> = { "image/png": "png", "image/jpeg": "jpg" };
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;

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

export async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
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
  // A practice kill (/bl test): the addon uses the player as their own victim, with no bounty.
  if (k.bountyId === 0 && k.victimGUID === k.killerGUID) {
    return fail("PRACTICE", "That's a practice kill (`/bl test`), and I read it fine. Real kills are claimed the same way: just drop the screenshot here.");
  }
  // bountyId 0: the hunter's addon knew the bounty only from guild sync (no pack listed it
  // yet), so there was no number to put in the code. Find it by the victim.
  const b =
    k.bountyId === 0
      ? await env.DB.prepare(
          "SELECT * FROM bounties WHERE tenant_id = ?1 AND target_guid = ?2 AND status IN ('open', 'review', 'awaiting_payment') ORDER BY id DESC LIMIT 1",
        )
          .bind(tenant.id, k.victimGUID)
          .first<BountyRow>()
      : await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(k.bountyId, tenant.id).first<BountyRow>();
  if (!b) {
    return fail(
      "CLOSED",
      k.bountyId === 0
        ? "There's no open bounty on that player here yet. If the bounty code was only just made, it has to be posted in the Bounty Line channel first; then post your kill screenshot again."
        : `Bounty #${k.bountyId} isn't on this Bounty Board.`,
    );
  }
  if (b.status === "review") return fail("CLOSED", `Bounty #${b.id} already has a kill claim waiting for the officers.`);
  if (b.status !== "open" || b.expires_at <= now) return fail("CLOSED", `Bounty #${b.id} is no longer open.`);
  if (k.victimGUID !== b.target_guid) return fail("MISMATCH", `That kill wasn't on ${escapeMd(b.target_name ?? "the target")} (bounty #${b.id}).`);
  if (k.killerFaction === factionId(b.faction)) return fail("FACTION", "Bounties must be on the opposite faction.");
  const contributor = await env.DB.prepare("SELECT 1 FROM contributions WHERE tenant_id = ?1 AND bounty_id = ?2 AND poster_guid = ?3")
    .bind(tenant.id, b.id, k.killerGUID)
    .first();
  if ((b.poster_guid && k.killerGUID === b.poster_guid) || contributor) return fail("SELF", "You can't claim your own bounty.");
  if (await env.DB.prepare("SELECT 1 FROM kills WHERE code = ?1").bind(code).first()) return fail("DUPLICATE", "That code was already used.");

  // 2. The screenshot (check 4): one PNG/JPG under 25 MB, never seen before.
  const image = attachments.find((a) => IMAGE_TYPES[(a.content_type ?? "").split(";")[0]!.trim()]);
  if (!image) return fail("NO_IMAGE", "Kill codes need your screenshot attached in the same message. It's the newest file in `World of Warcraft\\_forever_\\Screenshots`.");
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
    openWorld: openWorldCheck(k.mapID).ok,
    imageHash: hash,
  };

  // 4. AI stamp read (check 5), trust (spec 9.4) and the verdict (spec 9.3).
  const ai = await checkStamp(env, { bytes, contentType }, { code, bountyId: b.id, target: b.target_name ?? "" }, now);
  const hunter = await env.DB.prepare("SELECT trust FROM hunters WHERE tenant_id = ?1 AND discord_user_id = ?2")
    .bind(tenant.id, authorId)
    .first<{ trust: string | null }>();
  const trusted = hunter?.trust === "trusted";
  const clean = checks.openWorld && checks.window && checks.linked !== false && ai.status === "match";
  const mode = tenant.config.auto_approve;
  const auto = clean && (mode === "all_clean" || (mode === "trusted_only" && trusted));
  const allChecks = { ...checks, ai: ai.status, aiRead: "read" in ai ? ai.read : undefined, trusted };

  // 5. Record the claim, then show it in the bounty's thread.
  const row = await env.DB.prepare(
    `INSERT INTO kills (tenant_id, bounty_id, killer_guid, killer_name, killer_discord_id, victim_guid, killed_at, zone_map_id,
       code, image_r2_key, image_hash, checks_json, verdict, claimed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?14, ?13) RETURNING id`,
  )
    .bind(tenant.id, b.id, k.killerGUID, k.killerName, authorId, k.victimGUID, k.killedAt, k.mapID, code, key, hash, JSON.stringify(allChecks), now, auto ? "auto" : "pending")
    .first<{ id: number }>();
  const killId = row!.id;

  const lines = [
    `✅ Victim matches the bounty (GUID)`,
    `✅ Killer isn't the poster`,
    openWorldCheck(k.mapID).line,
    checks.window ? `✅ Posted ${ageMin} min after the kill` : `⚠️ Posted ${ageMin} min after the kill (limit ${windowHours}h)`,
    checks.honor ? "✅ Honor kill confirmed in game" : "➖ No honor message (some kills give none)",
    checks.linked === true ? "✅ Character linked to this Discord user" : checks.linked === false ? "⚠️ Character is linked to a different Discord user" : "➖ Character not linked yet (`/bl link` in game)",
    aiLine(ai),
    trusted ? "⭐ Trusted hunter" : `➖ New hunter (trusted after ${tenant.config.trust_threshold} approved kills in a row)`,
    ...(checks.pet ? ["🐾 Killing blow by their pet"] : []),
  ];
  const embed = {
    title: `💰 BOUNTY CLAIMED by ${escapeMd(k.killerName)}`,
    color: auto ? 0x2e8b57 : 0xd4a017,
    description: [
      `<@${authorId}> claims **${gold(b.reward_gold)}** for killing **${escapeMd(b.target_name ?? "the target")}** <t:${k.killedAt}:f>.`,
      "",
      ...lines,
      "",
      auto
        ? `Verdict: **AUTO-APPROVED** (all checks green${mode === "trusted_only" ? ", trusted hunter" : ""}). Officers can still deny it.`
        : `Verdict: **NEEDS OFFICER REVIEW** (<@&${tenant.officer_role_id}>)`,
    ].join("\n"),
    image: { url: `attachment://proof.${ext}` },
    footer: { text: `Claim #${killId} · Bounty #${b.id}` },
  };
  const components = [
    {
      type: 1,
      components: auto
        ? [{ type: 2, style: 4, label: "Deny (officers)", custom_id: `kill:deny:${killId}` }]
        : [
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
  if (auto) await onApproved(env, rest, tenant, b, killId, authorId, now);
  else await setBountyStatus(env, rest, tenant, b, "review", now);
  await audit(env.DB, tenant.id, authorId, "kill.claim", { kill: killId, bounty: b.id, auto }, now);
  log(env, "info", "kill.claimed", { tenant_id: tenant.id, bounty_id: b.id, kill_id: killId, outcome: auto ? "auto" : "pending", ai: ai.status });
  const where = b.thread_id ? `<#${b.thread_id}>` : `bounty #${b.id}`;
  const target = escapeMd(b.target_name ?? "the target");
  return {
    ok: true,
    message: auto
      ? `${SKULL} Kill on **${target}** auto-approved! Payment details are in ${where}.`
      : `${SKULL} Kill claim on **${target}** received. Officers will review it in ${where}.`,
  };
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
  const closed = status === "paid" || status === "expired" || status === "cancelled";
  await env.DB.prepare("UPDATE bounties SET status = ?1, closed_at = CASE WHEN ?4 THEN ?5 ELSE closed_at END WHERE id = ?2 AND tenant_id = ?3")
    .bind(status, b.id, tenant.id, closed ? 1 : 0, now)
    .run();
  const updated = { ...b, status };
  if (b.thread_id) {
    const tag = tenant.config.forum_tags[STATUS_TAG[status]!];
    if (tag) await rest.setThreadTags(b.thread_id, [tag]).catch((e) => log(env, "warn", "bounty.tag_failed", { tenant_id: tenant.id, error: String(e) }));
    try {
      const post = rowToPost(updated);
      const { n } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM contributions WHERE tenant_id = ?1 AND bounty_id = ?2").bind(tenant.id, b.id).first<{ n: number }>()) ?? { n: 1 };
      if (n > 1) post.posterName = `${post.posterName} +${n - 1}`; // stacked: "paid by Slac Jaw +2"
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
  /** The clicked message, updated: new text and buttons. */
  update?: { content: string; components: unknown[] };
  /** Runs after the update (e.g. closing the thread). */
  after?: () => Promise<unknown>;
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
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(kill.bounty_id, tenant.id).first<BountyRow>();
  // An auto-approved claim can still be denied until the bounty is paid.
  const overturn = action === "deny" && kill.verdict === "auto" && b?.status === "awaiting_payment";
  if (kill.verdict !== "pending" && !overturn) {
    return { ephemeral: `That claim was already ${kill.verdict === "auto" ? "auto-approved" : kill.verdict}.` };
  }

  const verdict = action === "approve" ? "approved" : "denied";
  await env.DB.prepare("UPDATE kills SET verdict = ?1, reviewed_by = ?2 WHERE id = ?3").bind(verdict, officer.id, killId).run();
  if (action === "approve") {
    if (b && b.status === "review") await onApproved(env, rest, tenant, b, killId, kill.killer_discord_id, now);
  } else {
    if (kill.killer_discord_id) {
      await env.DB.prepare(
        `INSERT INTO hunters (tenant_id, discord_user_id, denied, streak, trust) VALUES (?1, ?2, 1, 0, 'new')
         ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET denied = denied + 1, streak = 0, trust = 'new'`,
      )
        .bind(tenant.id, kill.killer_discord_id)
        .run();
    }
    if (b && (b.status === "review" || overturn)) await setBountyStatus(env, rest, tenant, b, "open", now);
  }
  await audit(env.DB, tenant.id, officer.id, `kill.${verdict}`, { kill: killId, bounty: kill.bounty_id }, now);
  log(env, "info", "kill.reviewed", { tenant_id: tenant.id, kill_id: killId, outcome: verdict });

  const line =
    action === "approve"
      ? `✅ **Approved** by <@${officer.id}>. Payment instructions are below.`
      : `❌ **Denied** by <@${officer.id}>. The bounty is open again.`;
  return { update: { content: line, components: [] } };
}

// ---------------------------------------------------------------- shared approval

/** Approved (by an officer or automatically): credit the hunter, await payment, post the payment buttons. */
async function onApproved(env: Env, rest: DiscordRest, tenant: Tenant, b: BountyRow, killId: number, hunterId: string | null, now: number) {
  if (hunterId) await creditHunter(env, tenant, hunterId);
  await setBountyStatus(env, rest, tenant, b, "awaiting_payment", now);
  await postPaymentPrompt(env, rest, b, killId, hunterId).catch((e) =>
    log(env, "warn", "bounty.payment_prompt_failed", { tenant_id: tenant.id, error: String(e) }),
  );
}

/** One more approved kill for a hunter. Trusted after trust_threshold approvals in a row (a denial resets the streak). */
export async function creditHunter(env: Env, tenant: Tenant, hunterId: string): Promise<void> {
  await env.DB.prepare(
    `INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?1, ?2, 1, 1, CASE WHEN 1 >= ?3 THEN 'trusted' ELSE 'new' END)
     ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET approved = approved + 1, streak = COALESCE(streak, 0) + 1,
       trust = CASE WHEN COALESCE(streak, 0) + 1 >= ?3 THEN 'trusted' ELSE trust END`,
  )
    .bind(tenant.id, hunterId, tenant.config.trust_threshold)
    .run();
}

function aiLine(ai: StampResult): string {
  switch (ai.status) {
    case "match":
      return "✅ AI read the stamp: matches the code";
    case "mismatch":
      return `⚠️ AI read the stamp: says ${ai.read.target ?? "?"}, bounty #${ai.read.bountyId ?? "?"}. Doesn't match`;
    case "unreadable":
      return "⚠️ AI couldn't find the Bounty Line stamp in the screenshot";
    default:
      return ai.reason === "cap" ? "➖ AI check skipped (daily limit reached)" : ai.reason === "off" ? "➖ AI check off" : "➖ AI check unavailable";
  }
}
