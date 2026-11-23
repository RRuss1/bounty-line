/**
 * Open Season (spec 5.11): a bounty on every member of an enemy guild.
 *
 *   S code            declares a season, or adds gold to one
 *   K code, schema 2  claims a kill on a member of that guild
 *   close             pot spent, time up, or ended early: one payout sheet, a line per hunter
 *
 * Three kinds: 1 a price per head drawn from a pot, 2 a prize pool shared by kill count at
 * close, 3 a price per head with no ceiling. The same victim counts once per day per hunter.
 */
import { checkStamp } from "./ai";
import { FACTION, SEASON_KIND, type KillClaim, type PackSeason, type SeasonPost } from "./codec";
import type { Env } from "./env";
import { creditHunter, posterKeyOf, IMAGE_TYPES, MAX_IMAGE_BYTES, sha256Hex, type Attachment, type Result, type ReviewResult } from "./kills";
import { posterChecks } from "./limits";
import { log } from "./log";
import { refreshPack } from "./pack";
import { SKULL } from "./poster";
import type { DiscordRest } from "./rest";
import { audit, type ForumTagKey, type Tenant } from "./tenants";
import { escapeMd, gold, openWorldCheck } from "./wow";

const DAY = 86400;
/** A season code must be posted within this long of being made in game. */
const CODE_MAX_AGE = 7 * DAY;
const COLOR = 0x8b0000;

export interface SeasonRow {
  id: number;
  tenant_id: string;
  guild_name: string;
  guild_key: string;
  faction: string;
  kind: number;
  per_kill_gold: number;
  total_gold: number;
  spent_gold: number;
  /** Prize pool only: no payout unless the season reaches this many approved kills (0 = none). */
  min_kills: number;
  poster_guid: string | null;
  poster_name: string | null;
  poster_discord_id: string | null;
  created_at: number;
  expires_at: number;
  status: string;
  closed_at: number | null;
  thread_id: string | null;
}

interface FundRow {
  id: number;
  poster_discord_id: string | null;
  poster_name: string | null;
  poster_guid: string | null;
  gold: number;
}

interface Payer {
  id: string;
  name: string;
  gold: number;
  paid_at: number | null;
}

interface PayoutRow {
  id: number;
  season_id: number;
  hunter_discord_id: string;
  kills: number;
  gold: number;
  payers_json: string;
  received_at: number | null;
  done_at: number | null;
  message_id: string | null;
}

type Outcome = { ok: true; message: string; bountyId?: number; threadId?: string } | { ok: false; code: string; message: string };

const fail = (code: string, message: string) => ({ ok: false as const, code, message });
const guildKey = (name: string) => name.trim().toLowerCase();
const factionName = (id: number) => (id === FACTION.Alliance ? "Alliance" : "Horde");
const factionId = (name: string) => (name === "Alliance" ? FACTION.Alliance : FACTION.Horde);
const remaining = (s: SeasonRow) => Math.max(0, s.total_gold - s.spent_gold);
const counted = "verdict IN ('auto', 'approved')";

const getSeason = (env: Env, tenantId: string, id: number) =>
  env.DB.prepare("SELECT * FROM seasons WHERE id = ?1 AND tenant_id = ?2").bind(id, tenantId).first<SeasonRow>();

const funds = async (env: Env, s: SeasonRow) =>
  (
    await env.DB.prepare("SELECT id, poster_discord_id, poster_name, poster_guid, gold FROM season_funds WHERE tenant_id = ?1 AND season_id = ?2 ORDER BY id")
      .bind(s.tenant_id, s.id)
      .all<FundRow>()
  ).results;

// ---------------------------------------------------------------- the forum post

/** "25g a head · pot 2,000g (1,875g left)" */
export function seasonTerms(s: SeasonRow): string {
  if (s.kind === SEASON_KIND.pot) return `**${gold(s.per_kill_gold)}** a head · pot **${gold(s.total_gold)}** (**${gold(remaining(s))}** left)`;
  if (s.kind === SEASON_KIND.pool) {
    const min = s.min_kills > 0 ? `, paid only if it reaches **${s.min_kills} kills**` : "";
    return `prize pool **${gold(s.total_gold)}**, shared by kills when it closes${min}`;
  }
  return `**${gold(s.per_kill_gold)}** a head, no ceiling (**${gold(s.spent_gold)}** owed so far)`;
}

const threadName = (s: SeasonRow) =>
  `${SKULL} OPEN SEASON · ${s.guild_name} · ${s.kind === SEASON_KIND.pool ? `${gold(s.total_gold)} pool` : `${gold(s.per_kill_gold)} a head`}`.slice(0, 100);

const STATUS_LINE: Record<string, string> = {
  open: "**OPEN**",
  settling: "**CLOSED**: waiting for the officers to finish reviewing claims",
  awaiting_payment: "**CLOSED**: awaiting payment (payout sheet below)",
  paid: "**PAID**",
  expired: "**ENDED**: nobody collected",
};
const STATUS_TAG: Record<string, ForumTagKey> = { open: "open", settling: "review", awaiting_payment: "awaiting_payment", paid: "paid", expired: "expired" };

async function tally(env: Env, s: SeasonRow): Promise<{ hunter: string; kills: number; gold: number }[]> {
  const { results } = await env.DB.prepare(
    `SELECT killer_discord_id AS hunter, COUNT(*) AS kills, SUM(gold) AS gold FROM season_kills
      WHERE tenant_id = ?1 AND season_id = ?2 AND ${counted} GROUP BY killer_discord_id ORDER BY kills DESC, hunter`,
  )
    .bind(s.tenant_id, s.id)
    .all<{ hunter: string; kills: number; gold: number }>();
  return results;
}

async function seasonPost(env: Env, s: SeasonRow) {
  const rows = await tally(env, s);
  const kills = rows.reduce((n, r) => n + r.kills, 0);
  const board = rows.slice(0, 10).map((r, i) => {
    const earned = s.kind === SEASON_KIND.pool ? "" : ` · ${gold(r.gold)}`;
    return `${i + 1}. <@${r.hunter}> · ${r.kills} ${r.kills === 1 ? "kill" : "kills"}${earned}`;
  });
  const description = [
    `Every member of **${escapeMd(s.guild_name)}** (${s.faction}) has a price on their head.`,
    "",
    seasonTerms(s),
    `Status: ${STATUS_LINE[s.status] ?? s.status} · ${s.status === "open" ? "ends" : "ended"} <t:${s.closed_at ?? s.expires_at}:R>`,
    `Declared by <@${s.poster_discord_id ?? ""}> (${escapeMd(s.poster_name ?? "?")})`,
    "",
    "Killing blow only. The same player counts **once a day per hunter**. Drop your kill screenshot in the Bounty Line channel. Everyone is paid from one sheet when the season closes.",
    "",
    kills ? `**Kills: ${kills}**` : "**No kills yet.**",
    ...board,
  ].join("\n");
  return {
    content: `${SKULL} **OPEN SEASON: ${escapeMd(s.guild_name)}**`,
    embed: { title: `OPEN SEASON · ${s.guild_name}`.slice(0, 256), description, color: COLOR, footer: { text: `Season #${s.id}` } },
  };
}

/** Redraws the season's forum post and tag from the database. Never throws. */
async function refreshSeason(env: Env, rest: DiscordRest, tenant: Tenant, id: number): Promise<SeasonRow | null> {
  const s = await getSeason(env, tenant.id, id);
  if (!s?.thread_id) return s;
  try {
    const tag = tenant.config.forum_tags[STATUS_TAG[s.status] ?? "open"];
    if (tag) await rest.setThreadTags(s.thread_id, [tag]);
    await rest.editPost(s.thread_id, s.thread_id, await seasonPost(env, s));
  } catch (e) {
    log(env, "warn", "season.post_update_failed", { tenant_id: tenant.id, season_id: id, error: String(e) });
  }
  return s;
}

// ---------------------------------------------------------------- S: declare, or add gold

export async function postSeason(env: Env, rest: DiscordRest, tenant: Tenant, f: SeasonPost, code: string, authorId: string, now: number): Promise<Outcome> {
  if (f.boardTag !== "0000" && f.boardTag !== tenant.board_tag) return fail("BOARD", "That code belongs to a different Bounty Board.");
  if (now - f.createdAt > CODE_MAX_AGE) return fail("EXPIRED", "That Open Season code is too old. Make a new one in game.");
  const owing = await posterChecks(env, tenant, authorId, now, { newBounty: false });
  if (owing) return fail(owing.code, owing.message);
  const { reward_min, reward_max } = tenant.config;
  const limits = fail("LIMITS", `Each amount must be between ${gold(reward_min)} and ${gold(reward_max)}.`);
  const within = (n: number) => n >= reward_min && n <= reward_max;

  const DUPLICATE = fail("DUPLICATE", "That code was already used.");
  if (await env.DB.prepare("SELECT 1 FROM seasons WHERE source_code = ?1").bind(code).first()) return DUPLICATE;
  if (await env.DB.prepare("SELECT 1 FROM season_funds WHERE source_code = ?1").bind(code).first()) return DUPLICATE;
  if (f.mode === 1) return fundSeason(env, rest, tenant, f, code, authorId, now);

  if (f.kind !== SEASON_KIND.pool && !within(f.perKillGold)) return limits;
  if (f.kind !== SEASON_KIND.open && !within(f.totalGold)) return limits;
  const minKills = f.kind === SEASON_KIND.pool ? (f.minKills ?? 0) : 0;
  if (minKills > 1000) return fail("LIMITS", "The minimum can be at most 1,000 kills.");

  const key = guildKey(f.guildName);
  const existing = await env.DB.prepare("SELECT id, kind, thread_id FROM seasons WHERE tenant_id = ?1 AND guild_key = ?2 AND status IN ('open', 'settling')")
    .bind(tenant.id, key)
    .first<{ id: number; kind: number; thread_id: string | null }>();
  if (existing) {
    const where = existing.thread_id ? ` <#${existing.thread_id}>` : "";
    return fail(
      "EXISTS",
      existing.kind === SEASON_KIND.open || !tenant.config.allow_stacking
        ? `There's already an Open Season on ${escapeMd(f.guildName)} (#${existing.id}).${where}`
        : `There's already an Open Season on ${escapeMd(f.guildName)} (#${existing.id}).${where} To add gold, right-click one of them in game → **Add to Open Season…**.`,
    );
  }

  const expiresAt = now + f.days * DAY;
  let id: number;
  try {
    const row = await env.DB.prepare(
      `INSERT INTO seasons (tenant_id, guild_name, guild_key, faction, kind, per_kill_gold, total_gold, poster_guid, poster_name,
         poster_discord_id, created_at, expires_at, status, source_code, min_kills)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, 'open', ?13, ?14) RETURNING id`,
    )
      .bind(tenant.id, f.guildName.trim(), key, factionName(f.guildFaction), f.kind, f.perKillGold, f.totalGold, f.posterGUID, f.posterName, authorId, Math.min(now, f.createdAt), expiresAt, code, minKills)
      .first<{ id: number }>();
    id = row!.id;
  } catch (e) {
    if (String(e).includes("seasons.source_code")) return DUPLICATE;
    throw e;
  }

  const s = (await getSeason(env, tenant.id, id))!;
  const openTag = tenant.config.forum_tags.open;
  let threadId: string;
  try {
    const thread = await rest.createForumPost(tenant.bounty_board_forum!, { name: threadName(s), tagIds: openTag ? [openTag] : [], ...(await seasonPost(env, s)) });
    threadId = thread.id;
  } catch (e) {
    await env.DB.prepare("DELETE FROM seasons WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant.id).run();
    log(env, "error", "season.post_failed", { tenant_id: tenant.id, error: String(e) });
    return fail("POSTER", `I couldn't create the Open Season post in <#${tenant.bounty_board_forum}>. An admin should check my permissions there, then paste the code again.`);
  }
  await env.DB.prepare("UPDATE seasons SET thread_id = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(threadId, id, tenant.id).run();
  await addFund(env, tenant, id, f, code, authorId, now);
  await audit(env.DB, tenant.id, authorId, "season.create", { id, guild: f.guildName, kind: f.kind, perKill: f.perKillGold, total: f.totalGold, days: f.days }, now);
  log(env, "info", "season.created", { tenant_id: tenant.id, season_id: id, outcome: "ok" });
  await refreshPack(env, rest, tenant, now);
  return { ok: true, bountyId: id, threadId, message: `${SKULL} Open Season #${id} on **${escapeMd(f.guildName)}** is up: <#${threadId}>` };
}

async function addFund(env: Env, tenant: Tenant, seasonId: number, f: SeasonPost, code: string, authorId: string, now: number) {
  await env.DB.prepare(
    `INSERT INTO season_funds (tenant_id, season_id, poster_discord_id, poster_name, poster_guid, gold, source_code, created_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)`,
  )
    .bind(tenant.id, seasonId, authorId, f.posterName, f.posterGUID, f.totalGold, code, now)
    .run();
}

/** S code, mode 1: more gold in a pot or a prize pool. */
async function fundSeason(env: Env, rest: DiscordRest, tenant: Tenant, f: SeasonPost, code: string, authorId: string, now: number): Promise<Outcome> {
  if (!tenant.config.allow_stacking) return fail("STACK", "This Bounty Board doesn't allow adding gold to bounties.");
  const s = await getSeason(env, tenant.id, f.existingSeasonId);
  if (!s) return fail("CLOSED", `Open Season #${f.existingSeasonId} isn't on this Bounty Board.`);
  if (s.guild_key !== guildKey(f.guildName)) return fail("MISMATCH", `That code isn't for Open Season #${s.id}'s guild.`);
  if (s.status !== "open" || s.expires_at <= now) return fail("CLOSED", `Open Season #${s.id} is no longer open.`);
  if (s.kind === SEASON_KIND.open) return fail("STACK", `Open Season #${s.id} has no pot to add to: it pays ${gold(s.per_kill_gold)} a head with no ceiling.`);
  const { reward_min, reward_max } = tenant.config;
  if (f.totalGold < reward_min || s.total_gold + f.totalGold > reward_max) {
    return fail("LIMITS", `You can add at least ${gold(reward_min)}, and the total can't go over ${gold(reward_max)} (it is ${gold(s.total_gold)} now).`);
  }
  try {
    await addFund(env, tenant, s.id, f, code, authorId, now);
  } catch (e) {
    if (String(e).includes("season_funds.source_code")) return fail("DUPLICATE", "That code was already used.");
    throw e;
  }
  await env.DB.prepare("UPDATE seasons SET total_gold = total_gold + ?1 WHERE id = ?2 AND tenant_id = ?3").bind(f.totalGold, s.id, tenant.id).run();
  const updated = await refreshSeason(env, rest, tenant, s.id);
  if (updated?.thread_id) await rest.renameThread(updated.thread_id, threadName(updated)).catch(() => undefined);
  await refreshPack(env, rest, tenant, now);
  await audit(env.DB, tenant.id, authorId, "season.fund", { id: s.id, added: f.totalGold, total: s.total_gold + f.totalGold }, now);
  return {
    ok: true,
    bountyId: s.id,
    threadId: s.thread_id ?? undefined,
    message: `💰 **${escapeMd(f.posterName || "Someone")}** added **${gold(f.totalGold)}** to Open Season #${s.id} on **${escapeMd(s.guild_name)}**: now **${gold(s.total_gold + f.totalGold)}**`,
  };
}

// ---------------------------------------------------------------- K (schema 2): claim a kill

/**
 * True when a kill code is an Open Season claim (it may also name a personal bounty). The addon
 * writes schema 2 only for those, including kills on a guild whose season has no number yet.
 * Schema 3 is also written for kills on a bounty with terms (its kill facts); with no season
 * number and no guild it is a plain bounty claim.
 */
export const isSeasonKill = (k: KillClaim) =>
  k.schema >= 2 && !(k.schema >= 3 && (k.seasonId ?? 0) === 0 && (k.guildName ?? "") === "" && k.bountyId !== 0);

/** Open seasons a kill by this faction could count for, newest first. */
const openSeasonsAgainst = async (env: Env, tenantId: string, killerFaction: number, now: number) =>
  (
    await env.DB.prepare("SELECT * FROM seasons WHERE tenant_id = ?1 AND status = 'open' AND expires_at > ?2 AND faction != ?3 ORDER BY id DESC")
      .bind(tenantId, now, factionName(killerFaction))
      .all<SeasonRow>()
  ).results;

export async function claimSeasonKill(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  k: KillClaim,
  code: string,
  authorId: string,
  attachments: Attachment[],
  now: number,
): Promise<Result> {
  if (k.boardTag !== "0000" && k.boardTag !== tenant.board_tag) return fail("BOARD", "That code belongs to a different Bounty Board.");
  const victim = k.victimName || "that player";
  // The season is found by the guild the addon saw, not by the number in the code: a season
  // declared moments ago has no number yet, and an old number may belong to a season that has
  // since closed while a new one runs on the same guild.
  const guild = (k.guildName ?? "").trim();
  const seen = k.guildSeen === 1 && guild !== "";
  const open = await openSeasonsAgainst(env, tenant.id, k.killerFaction, now);
  let candidates: SeasonRow[];
  if (guild) {
    candidates = open.filter((x) => x.guild_key === guildKey(guild));
    if (!candidates.length) {
      const own = await env.DB.prepare("SELECT 1 FROM seasons WHERE tenant_id = ?1 AND guild_key = ?2 AND status = 'open' AND faction = ?3")
        .bind(tenant.id, guildKey(guild), factionName(k.killerFaction))
        .first();
      if (own) return fail("FACTION", "Bounties must be on the opposite faction.");
      const old = k.seasonId ? await getSeason(env, tenant.id, k.seasonId) : null;
      return fail(
        "CLOSED",
        old && old.guild_key === guildKey(guild)
          ? `Open Season #${old.id} on ${escapeMd(old.guild_name)} is no longer open.`
          : `There's no Open Season on ${escapeMd(guild)} running here.`,
      );
    }
  } else {
    // The addon never saw the victim's guild: any season on their side could be the one. The
    // officers read the guild off the screenshot and approve it under the right season.
    candidates = open;
    if (!candidates.length) return fail("CLOSED", "There's no Open Season running that this kill could count for.");
  }
  const s = candidates[0]!;
  if (s.kind === SEASON_KIND.pot && remaining(s) <= 0) return fail("CLOSED", `Open Season #${s.id}'s pot is empty.`);
  if (k.killedAt < s.created_at - 300) return fail("CLOSED", `That kill was before Open Season #${s.id} on ${escapeMd(s.guild_name)} started.`);
  if (k.killerFaction === factionId(s.faction)) return fail("FACTION", "Bounties must be on the opposite faction.");
  const funder = await env.DB.prepare("SELECT 1 FROM season_funds WHERE tenant_id = ?1 AND season_id = ?2 AND (poster_guid = ?3 OR poster_discord_id = ?4)")
    .bind(tenant.id, s.id, k.killerGUID, authorId)
    .first();
  if (funder) return fail("SELF", "You can't collect on an Open Season you put gold into.");
  if (await env.DB.prepare("SELECT 1 FROM season_kills WHERE code = ?1").bind(code).first()) return fail("DUPLICATE", "That code was already used.");
  const day = Math.floor(k.killedAt / DAY);
  const already = await env.DB.prepare(
    "SELECT 1 FROM season_kills WHERE season_id = ?1 AND victim_guid = ?2 AND killer_discord_id = ?3 AND day = ?4 AND verdict != 'denied'",
  )
    .bind(s.id, k.victimGUID, authorId, day)
    .first();
  if (already) return fail("DAILY", `You already claimed ${escapeMd(victim)} today for this Open Season. Each player counts once a day per hunter.`);

  // The screenshot: one PNG/JPG, never used for a season claim before.
  const image = attachments.find((a) => IMAGE_TYPES[(a.content_type ?? "").split(";")[0]!.trim()]);
  if (!image) return fail("NO_IMAGE", "Kill codes need your screenshot attached in the same message. It's the newest file in `World of Warcraft\\_forever_\\Screenshots`.");
  if ((image.size ?? 0) > MAX_IMAGE_BYTES) return fail("NO_IMAGE", "That screenshot is over 25 MB. Attach the PNG or JPG from your Screenshots folder.");
  const res = await fetch(image.url);
  if (!res.ok) return fail("NO_IMAGE", "I couldn't download your screenshot. Try posting it again.");
  const bytes = await res.arrayBuffer();
  if (bytes.byteLength > MAX_IMAGE_BYTES) return fail("NO_IMAGE", "That screenshot is over 25 MB.");
  const hash = await sha256Hex(bytes);
  if (await env.DB.prepare("SELECT 1 FROM season_kills WHERE tenant_id = ?1 AND image_hash = ?2").bind(tenant.id, hash).first()) {
    return fail("DUPLICATE", "That screenshot was already used for a claim.");
  }
  const contentType = (image.content_type ?? "image/png").split(";")[0]!.trim();
  const ext = IMAGE_TYPES[contentType]!;
  const key = `proofs/${tenant.id}/season-${s.id}/${hash.slice(0, 24)}.${ext}`;
  await env.PROOFS.put(key, bytes, { httpMetadata: { contentType } });

  const windowHours = tenant.config.proof_window_hours;
  const ageMin = Math.round((now - k.killedAt) / 60);
  const linked = await env.DB.prepare("SELECT discord_user_id FROM characters WHERE tenant_id = ?1 AND guid = ?2")
    .bind(tenant.id, k.killerGUID)
    .first<{ discord_user_id: string | null }>();
  const checks = {
    guildSeen: seen,
    honor: (k.flags & 1) === 1,
    pet: (k.flags & 2) === 2,
    window: k.killedAt <= now + 300 && now - k.killedAt <= windowHours * 3600,
    ageMinutes: ageMin,
    linked: linked ? linked.discord_user_id === authorId : null,
    openWorld: openWorldCheck(k.mapID).ok,
    imageHash: hash,
  };
  const ai = await checkStamp(env, { bytes, contentType }, { code, bountyId: s.id, target: k.victimName ?? "" }, now);
  const hunter = await env.DB.prepare("SELECT trust FROM hunters WHERE tenant_id = ?1 AND discord_user_id = ?2").bind(tenant.id, authorId).first<{ trust: string | null }>();
  const trusted = hunter?.trust === "trusted";
  const clean = seen && checks.openWorld && checks.window && checks.linked !== false && ai.status === "match";
  const mode = tenant.config.auto_approve;
  const auto = clean && (mode === "all_clean" || (mode === "trusted_only" && trusted));

  const row = await env.DB.prepare(
    `INSERT INTO season_kills (tenant_id, season_id, killer_guid, killer_name, killer_discord_id, victim_guid, victim_name, killed_at, day,
       zone_map_id, guild_seen, code, image_r2_key, image_hash, checks_json, verdict, claimed_at)
     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17) RETURNING id`,
  )
    .bind(
      tenant.id, s.id, k.killerGUID, k.killerName, authorId, k.victimGUID, k.victimName ?? "", k.killedAt, day, k.mapID, seen ? 1 : 0, code, key, hash,
      JSON.stringify({ ...checks, ai: ai.status, trusted }), auto ? "auto" : "pending", now,
    )
    .first<{ id: number }>();
  const killId = row!.id;

  const others = candidates.slice(1, 4);
  const guildLine = seen
    ? `✅ The addon saw them in **${escapeMd(s.guild_name)}**`
    : others.length
      ? `⚠️ The addon never saw their guild. Check the nameplate in the screenshot and approve under the guild it shows: ${candidates.slice(0, 4).map((x) => `**${escapeMd(x.guild_name)}**`).join(", ")}. If it's none of them, deny.`
      : `⚠️ The addon never saw their guild: check the nameplate in the screenshot says **${escapeMd(s.guild_name)}**`;
  const lines = [
    guildLine,
    openWorldCheck(k.mapID).line,
    checks.window ? `✅ Posted ${ageMin} min after the kill` : `⚠️ Posted ${ageMin} min after the kill (limit ${windowHours}h)`,
    checks.honor ? "✅ Honor kill confirmed in game" : "➖ No honor message (some kills give none)",
    checks.linked === true ? "✅ Character linked to this Discord user" : checks.linked === false ? "⚠️ Character is linked to a different Discord user" : "➖ Character not linked yet (`/bl link` in game)",
    ai.status === "match" ? "✅ AI read the stamp: matches the code" : ai.status === "skipped" ? "➖ AI check not run" : "⚠️ AI couldn't match the stamp to the code",
    trusted ? "⭐ Trusted hunter" : `➖ New hunter (trusted after ${tenant.config.trust_threshold} approved kills in a row)`,
    ...(checks.pet ? ["🐾 Killing blow by their pet, totem or summon"] : []),
  ];
  const embed = {
    title: `${SKULL} OPEN SEASON KILL by ${escapeMd(k.killerName)}`.slice(0, 256),
    color: auto ? 0x2e8b57 : 0xd4a017,
    description: [
      `<@${authorId}> killed **${escapeMd(victim)}** of **${escapeMd(s.guild_name)}** <t:${k.killedAt}:f>.`,
      "",
      ...lines,
      "",
      auto ? "Verdict: **AUTO-APPROVED**. Officers can still deny it." : `Verdict: **NEEDS OFFICER REVIEW** (<@&${tenant.officer_role_id}>)`,
    ].join("\n"),
    image: { url: `attachment://proof.${ext}` },
    footer: { text: `Claim S${killId} · Season #${s.id}` },
  };
  // Unknown guild with several seasons running: one Approve per guild, so the officer files it
  // under the one the screenshot shows.
  const approve = others.length
    ? candidates.slice(0, 4).map((x) => ({ type: 2, style: 3, label: `Approve: ${x.guild_name}`.slice(0, 80), custom_id: `skill:approve:${killId}:${x.id}` }))
    : [{ type: 2, style: 3, label: "Approve", custom_id: `skill:approve:${killId}` }];
  const components = [
    {
      type: 1,
      components: auto
        ? [{ type: 2, style: 4, label: "Deny (officers)", custom_id: `skill:deny:${killId}` }]
        : [...approve, { type: 2, style: 4, label: "Deny", custom_id: `skill:deny:${killId}` }],
    },
  ];
  // No proof post means no buttons, and a claim nobody can review would hold the season's
  // payout sheet forever: undo the claim so the hunter can post the screenshot again.
  let posted = false;
  if (s.thread_id) {
    try {
      const sent = await rest.sendFiles(
        s.thread_id,
        { content: "", embeds: [embed], components, allowed_mentions: { parse: [] } },
        [{ name: `proof.${ext}`, data: new Uint8Array(bytes), type: contentType }],
      );
      await env.DB.prepare("UPDATE season_kills SET proof_message_id = ?1 WHERE id = ?2").bind(sent.id, killId).run();
      posted = true;
    } catch (e) {
      log(env, "error", "season.proof_post_failed", { tenant_id: tenant.id, season_id: s.id, error: String(e) });
    }
  }
  if (!posted) {
    await env.DB.prepare("DELETE FROM season_kills WHERE id = ?1").bind(killId).run();
    await env.PROOFS.delete(key).catch(() => undefined);
    return fail("POSTER", `I couldn't post your proof in the Open Season's thread. Try posting the screenshot again in a minute; if it keeps failing, an officer should check my permissions in <#${tenant.bounty_board_forum}>.`);
  }
  if (auto) await credit(env, rest, tenant, s, killId, authorId, now);
  await audit(env.DB, tenant.id, authorId, "season.claim", { kill: killId, season: s.id, auto }, now);
  log(env, "info", "season.claimed", { tenant_id: tenant.id, season_id: s.id, kill_id: killId, outcome: auto ? "auto" : "pending" });
  const where = s.thread_id ? `<#${s.thread_id}>` : `Open Season #${s.id}`;
  return {
    ok: true,
    message: auto
      ? `${SKULL} Open Season kill on **${escapeMd(victim)}** counted. The tally is in ${where}.`
      : `${SKULL} Open Season kill on **${escapeMd(victim)}** received. Officers will review it in ${where}.`,
  };
}

/** An approved kill: credit the hunter's record and (kinds 1 and 3) the gold; an empty pot closes the season. */
async function credit(env: Env, rest: DiscordRest, tenant: Tenant, s: SeasonRow, killId: number, hunterId: string | null, now: number): Promise<number> {
  if (hunterId) await creditHunter(env, tenant, hunterId, posterKeyOf(s));
  // One transaction: the kill takes its price (a pot's last kill takes what's left) and the
  // season's spent total moves by exactly that, so two approvals at once can't overspend a pot.
  const [, , got] = await env.DB.batch([
    env.DB.prepare(
      `UPDATE season_kills SET gold = (SELECT CASE s.kind WHEN 1 THEN MAX(0, MIN(s.per_kill_gold, s.total_gold - s.spent_gold))
         WHEN 3 THEN s.per_kill_gold ELSE 0 END FROM seasons s WHERE s.id = ?2) WHERE id = ?1`,
    ).bind(killId, s.id),
    env.DB.prepare("UPDATE seasons SET spent_gold = spent_gold + (SELECT gold FROM season_kills WHERE id = ?1) WHERE id = ?2").bind(killId, s.id),
    env.DB.prepare("SELECT gold FROM season_kills WHERE id = ?1").bind(killId),
  ]);
  const amount = Number((got?.results?.[0] as { gold?: number } | undefined)?.gold ?? 0);
  const fresh = (await getSeason(env, tenant.id, s.id)) ?? s;
  const after = await refreshSeason(env, rest, tenant, s.id);
  if (after && after.status === "open" && after.kind === SEASON_KIND.pot && remaining(after) <= 0) await closeSeason(env, rest, tenant, after, now);
  else if (fresh.kind === SEASON_KIND.pot) await refreshPack(env, rest, tenant, now); // the pot left travels in the pack
  return amount;
}

// ---------------------------------------------------------------- officer review (buttons)

export async function reviewSeasonKill(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  action: "approve" | "deny",
  killId: number,
  officer: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
  /** Approve under this season instead (a claim whose guild the addon never saw). */
  intoSeason?: number,
): Promise<ReviewResult> {
  if (!officer.isAdmin && !(tenant.officer_role_id && officer.roles.includes(tenant.officer_role_id))) {
    return { ephemeral: `Only <@&${tenant.officer_role_id}> can approve or deny kill claims.` };
  }
  const kill = await env.DB.prepare(
    "SELECT id, season_id, verdict, killer_discord_id, killer_guid, victim_guid, day, gold FROM season_kills WHERE id = ?1 AND tenant_id = ?2",
  )
    .bind(killId, tenant.id)
    .first<{ id: number; season_id: number; verdict: string; killer_discord_id: string | null; killer_guid: string | null; victim_guid: string; day: number; gold: number }>();
  const filed = kill && (await getSeason(env, tenant.id, kill.season_id));
  if (!kill || !filed) return { ephemeral: "I can't find that claim any more." };
  const live = (x: SeasonRow) => x.status === "open" || x.status === "settling";
  // An auto-approved claim can still be denied until the payout sheet is posted.
  const overturn = action === "deny" && kill.verdict === "auto" && live(filed);
  if (kill.verdict !== "pending" && !overturn) return { ephemeral: `That claim was already ${kill.verdict === "auto" ? "auto-approved" : kill.verdict}.` };
  if (!live(filed)) return { ephemeral: `Open Season #${filed.id} has already been settled.` };

  // Approving under another season (the officer read a different guild off the nameplate).
  let s = filed;
  if (action === "approve" && intoSeason && intoSeason !== filed.id) {
    const target = await getSeason(env, tenant.id, intoSeason);
    if (!target || target.status !== "open") return { ephemeral: `Open Season #${intoSeason} is no longer open.` };
    const clash = await env.DB.prepare(
      `SELECT 1 FROM season_kills WHERE season_id = ?1 AND victim_guid = ?2 AND killer_discord_id = ?3 AND day = ?4 AND verdict != 'denied' AND id != ?5
       UNION SELECT 1 FROM season_funds WHERE tenant_id = ?6 AND season_id = ?1 AND (poster_guid = ?7 OR poster_discord_id = ?3)`,
    )
      .bind(target.id, kill.victim_guid, kill.killer_discord_id, kill.day, killId, tenant.id, kill.killer_guid)
      .first();
    if (clash) return { ephemeral: `That hunter can't collect this kill under Open Season #${target.id} (already claimed today, or they funded it).` };
    await env.DB.prepare("UPDATE season_kills SET season_id = ?1 WHERE id = ?2").bind(target.id, killId).run();
    s = target;
  }

  // Only the first click counts: a double-click or two officers at once can't credit it twice.
  const verdict = action === "approve" ? "approved" : "denied";
  const changed = await env.DB.prepare("UPDATE season_kills SET verdict = ?1, reviewed_by = ?2 WHERE id = ?3 AND verdict = ?4")
    .bind(verdict, officer.id, killId, kill.verdict)
    .run();
  if ((changed.meta?.changes ?? 0) === 0) return { ephemeral: "Another officer just reviewed that claim." };
  let line: string;
  if (action === "approve") {
    const amount = await credit(env, rest, tenant, s, killId, kill.killer_discord_id, now);
    line = `✅ **Approved** by <@${officer.id}>.${s.kind === SEASON_KIND.pool ? "" : amount > 0 ? ` **${gold(amount)}** added to their tally.` : " The pot was already empty, so it adds no gold."}`;
  } else {
    if (kill.killer_discord_id) {
      await env.DB.prepare(
        `INSERT INTO hunters (tenant_id, discord_user_id, denied, streak, trust) VALUES (?1, ?2, 1, 0, 'new')
         ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET denied = denied + 1, streak = 0, streak_posters = '[]', trust = 'new'`,
      )
        .bind(tenant.id, kill.killer_discord_id)
        .run();
    }
    if (kill.gold > 0) {
      await env.DB.prepare("UPDATE season_kills SET gold = 0 WHERE id = ?1").bind(killId).run();
      await env.DB.prepare("UPDATE seasons SET spent_gold = MAX(0, spent_gold - ?1) WHERE id = ?2 AND tenant_id = ?3").bind(kill.gold, s.id, tenant.id).run();
    }
    await refreshSeason(env, rest, tenant, s.id);
    line = `❌ **Denied** by <@${officer.id}>. It doesn't count.`;
  }
  await audit(env.DB, tenant.id, officer.id, `season.kill_${verdict}`, { kill: killId, season: s.id }, now);

  // A season that closed while claims were waiting settles once the last one is reviewed (both
  // seasons, when the claim moved).
  for (const id of new Set([s.id, filed.id])) {
    const after = await getSeason(env, tenant.id, id);
    if (after?.status === "settling") await settle(env, rest, tenant, after, now);
  }
  if (s.id !== filed.id) line += ` Counted for **${escapeMd(s.guild_name)}** (Open Season #${s.id}).`;
  return { update: { content: line, components: [] } };
}

// ---------------------------------------------------------------- closing and the payout sheet

/** Stops new claims. The payout sheet follows at once, or after the officers finish any waiting claims. */
export async function closeSeason(env: Env, rest: DiscordRest, tenant: Tenant, s: SeasonRow, now: number): Promise<void> {
  if (s.status !== "open") return;
  // Only one caller closes it (the cron, /bl season end and the last kill of a pot can race).
  const closed = await env.DB.prepare("UPDATE seasons SET status = 'settling', closed_at = ?1 WHERE id = ?2 AND tenant_id = ?3 AND status = 'open'")
    .bind(now, s.id, tenant.id)
    .run();
  if ((closed.meta?.changes ?? 0) === 0) return;
  await refreshPack(env, rest, tenant, now);
  await settle(env, rest, tenant, { ...s, status: "settling", closed_at: now }, now, true);
}

/** justClosed: say in the thread that claims are still waiting (once, at the close). */
async function settle(env: Env, rest: DiscordRest, tenant: Tenant, s: SeasonRow, now: number, justClosed = false): Promise<void> {
  const { n: waiting } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM season_kills WHERE tenant_id = ?1 AND season_id = ?2 AND verdict = 'pending'")
    .bind(tenant.id, s.id)
    .first<{ n: number }>()) ?? { n: 0 };
  if (waiting > 0) {
    await refreshSeason(env, rest, tenant, s.id);
    if (s.thread_id && justClosed) {
      await rest
        .sendMessage(s.thread_id, `🔒 **Open Season closed.** ${waiting} ${waiting === 1 ? "claim is" : "claims are"} still waiting for the officers; the payout sheet posts when they're done.`)
        .catch(() => undefined);
    }
    return;
  }

  const rows = await tally(env, s);
  const kills = rows.reduce((n, r) => n + r.kills, 0);
  // A prize pool that didn't reach its minimum pays nobody: the funders keep their gold.
  const short = s.kind === SEASON_KIND.pool && kills < s.min_kills;
  const owed = (short ? [] : rows)
    .map((r) => ({ hunter: r.hunter, kills: r.kills, gold: s.kind === SEASON_KIND.pool ? Math.floor((s.total_gold * r.kills) / kills) : r.gold }))
    .filter((r) => r.gold > 0)
    .sort((a, b) => b.gold - a.gold);
  // Only one caller posts the sheet (two officers finishing the last reviews at once).
  const next = owed.length ? "awaiting_payment" : "expired";
  const moved = await env.DB.prepare("UPDATE seasons SET status = ?1, closed_at = COALESCE(closed_at, ?2) WHERE id = ?3 AND tenant_id = ?4 AND status = 'settling'")
    .bind(next, now, s.id, tenant.id)
    .run();
  if ((moved.meta?.changes ?? 0) === 0) return;
  if (!owed.length) {
    await refreshSeason(env, rest, tenant, s.id);
    if (s.thread_id) {
      const why = short
        ? `🔒 **Open Season closed.** It needed **${s.min_kills} kills** to pay out and got **${kills}**, so the prize pool isn't paid: the funders keep their gold.`
        : "🔒 **Open Season closed.** Nobody collected, so there is nothing to pay.";
      await rest.sendMessage(s.thread_id, why).catch(() => undefined);
      await rest.closeThread(s.thread_id).catch(() => undefined);
    }
    log(env, "info", "season.closed", { tenant_id: tenant.id, season_id: s.id, outcome: "no_kills" });
    return;
  }

  // Funders pay in the order they put gold in, so most hunters are paid by one person.
  const pots = (await funds(env, s)).map((f) => ({ id: f.poster_discord_id ?? "", name: f.poster_name ?? "?", left: s.kind === SEASON_KIND.open ? Infinity : f.gold }));
  await refreshSeason(env, rest, tenant, s.id);
  if (s.thread_id) {
    const total = owed.reduce((n, o) => n + o.gold, 0);
    await rest
      .sendMessage(s.thread_id, `🔒 **Open Season closed: payout sheet.** ${kills} ${kills === 1 ? "kill" : "kills"}, **${gold(total)}** to pay, in game (honor system).`)
      .catch(() => undefined);
  }
  for (const o of owed) {
    const payers: Payer[] = [];
    let need = o.gold;
    for (const p of pots) {
      if (need <= 0) break;
      const take = Math.min(need, p.left);
      if (take <= 0) continue;
      p.left -= take;
      need -= take;
      payers.push({ id: p.id, name: p.name, gold: take, paid_at: null });
    }
    const row = await env.DB.prepare(
      "INSERT INTO season_payouts (tenant_id, season_id, hunter_discord_id, kills, gold, payers_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6) RETURNING id",
    )
      .bind(tenant.id, s.id, o.hunter, o.kills, o.gold, JSON.stringify(payers))
      .first<{ id: number }>();
    if (!s.thread_id) continue;
    const p: PayoutRow = { id: row!.id, season_id: s.id, hunter_discord_id: o.hunter, kills: o.kills, gold: o.gold, payers_json: JSON.stringify(payers), received_at: null, done_at: null, message_id: null };
    const users = [...new Set([o.hunter, ...payers.map((x) => x.id)].filter(Boolean))];
    // Two tries; a line that still has no buttons is finished by an officer with /bl season action: close.
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const sent = await rest.send(s.thread_id, { content: payoutText(p), components: payoutButtons(p.id), allowed_mentions: { users } });
        await env.DB.prepare("UPDATE season_payouts SET message_id = ?1 WHERE id = ?2").bind(sent.id, p.id).run();
        break;
      } catch (e) {
        log(env, "warn", "season.payout_post_failed", { tenant_id: tenant.id, season_id: s.id, attempt, error: String(e) });
      }
    }
  }
  log(env, "info", "season.closed", { tenant_id: tenant.id, season_id: s.id, outcome: "payout", hunters: owed.length });
}

const mark = (done: boolean) => (done ? "✅" : "⬜");

function payoutText(p: PayoutRow, closedBy?: string): string {
  const payers = JSON.parse(p.payers_json) as Payer[];
  const head = `💰 <@${p.hunter_discord_id}> collects **${gold(p.gold)}** for ${p.kills} ${p.kills === 1 ? "kill" : "kills"}.`;
  if (closedBy) return `${head}\n🔒 **Closed by <@${closedBy}>.** Marked as paid.`;
  if (p.done_at) return `${head}\n✅ **PAID IN FULL.** Thanks for hunting!`;
  return [
    head,
    ...payers.map((x) => `${mark(!!x.paid_at)} <@${x.id}> pays **${gold(x.gold)}**`),
    `${mark(!!p.received_at)} Received (hunter)`,
    "Payers: click **Paid** once you've sent your share. Hunter: click **Received** once it all arrives.",
  ].join("\n");
}

function payoutButtons(id: number) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Paid", custom_id: `spay:paid:${id}` },
        { type: 2, style: 3, label: "Received", custom_id: `spay:received:${id}` },
        { type: 2, style: 2, label: "Force close (officers)", custom_id: `spay:close:${id}` },
      ],
    },
  ];
}

export async function handleSeasonPayout(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  action: "paid" | "received" | "close",
  payoutId: number,
  user: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
): Promise<ReviewResult> {
  const officer = user.isAdmin || (!!tenant.officer_role_id && user.roles.includes(tenant.officer_role_id));
  // Read, change, write only if nobody else wrote in between (two payers clicking at once);
  // otherwise read again. The write that finishes the line is the only one that credits it.
  let p: PayoutRow | null = null;
  let s: SeasonRow | null = null;
  let done = false;
  for (let attempt = 0; ; attempt++) {
    p = await env.DB.prepare("SELECT * FROM season_payouts WHERE id = ?1 AND tenant_id = ?2").bind(payoutId, tenant.id).first<PayoutRow>();
    s = p && (await getSeason(env, tenant.id, p.season_id));
    if (!p || !s) return { ephemeral: "I can't find that payout any more." };
    if (p.done_at) return { ephemeral: "That payout is already settled." };
    const before = { payers: p.payers_json, received: p.received_at };
    const payers = JSON.parse(p.payers_json) as Payer[];
    if (action === "paid") {
      if (!payers.some((x) => x.id === user.id)) return { ephemeral: `Only the payers (${payers.map((x) => `<@${x.id}>`).join(", ")}) can mark their share paid.` };
      for (const x of payers) if (x.id === user.id) x.paid_at = x.paid_at ?? now;
    } else if (action === "received") {
      if (user.id !== p.hunter_discord_id) return { ephemeral: `Only the hunter (<@${p.hunter_discord_id}>) can mark this received.` };
      p.received_at = p.received_at ?? now;
    } else if (!officer) {
      return { ephemeral: `Only <@&${tenant.officer_role_id}> can force-close a payout.` };
    }
    done = action === "close" || (payers.every((x) => x.paid_at) && !!p.received_at);
    if (done) {
      for (const x of payers) x.paid_at = x.paid_at ?? now;
      p.received_at = p.received_at ?? now;
      p.done_at = now;
    }
    p.payers_json = JSON.stringify(payers);
    const wrote = await env.DB.prepare(
      `UPDATE season_payouts SET payers_json = ?1, received_at = ?2, done_at = ?3
        WHERE id = ?4 AND done_at IS NULL AND payers_json = ?5 AND received_at IS ?6`,
    )
      .bind(p.payers_json, p.received_at, p.done_at, p.id, before.payers, before.received)
      .run();
    if ((wrote.meta?.changes ?? 0) === 1) break;
    if (attempt >= 3) return { ephemeral: "Someone else was updating that payout. Click again." };
  }
  await audit(env.DB, tenant.id, user.id, `season.payout_${action}`, { season: s.id, payout: p.id }, now);
  if (!done) return { update: { content: payoutText(p!), components: payoutButtons(p!.id) } };
  return lineSettled(env, rest, tenant, p!, s!, action === "close" ? user.id : undefined);
}

/** A payout line just settled: credit the hunter; when it was the last line, the season is PAID. */
async function lineSettled(env: Env, rest: DiscordRest, tenant: Tenant, p: PayoutRow, s: SeasonRow, closedBy?: string): Promise<ReviewResult> {
  await env.DB.prepare(
    `INSERT INTO hunters (tenant_id, discord_user_id, gold_earned) VALUES (?1, ?2, ?3)
     ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET gold_earned = gold_earned + ?3`,
  )
    .bind(tenant.id, p.hunter_discord_id, p.gold)
    .run();
  const { n: open } = (await env.DB.prepare("SELECT COUNT(*) AS n FROM season_payouts WHERE tenant_id = ?1 AND season_id = ?2 AND done_at IS NULL")
    .bind(tenant.id, s.id)
    .first<{ n: number }>()) ?? { n: 0 };
  const update = { content: payoutText(p, closedBy), components: [] };
  if (open > 0) return { update };

  // Every line settled: the season is paid (once, even if two last lines finish together).
  const paid = await env.DB.prepare("UPDATE seasons SET status = 'paid' WHERE id = ?1 AND tenant_id = ?2 AND status = 'awaiting_payment'").bind(s.id, tenant.id).run();
  if ((paid.meta?.changes ?? 0) === 0) return { update };
  await refreshSeason(env, rest, tenant, s.id);
  log(env, "info", "season.paid", { tenant_id: tenant.id, season_id: s.id });
  const threadId = s.thread_id;
  return {
    update,
    after: threadId ? () => rest.closeThread(threadId).catch((e) => log(env, "warn", "season.archive_failed", { tenant_id: tenant.id, error: String(e) })) : undefined,
  };
}

/**
 * /bl season action: close (officers): finishes a season that is stuck. Claims still waiting
 * for review are denied, so the payout sheet can post; payout lines still open are marked
 * paid (for lines whose buttons never appeared, or a payer who left).
 */
export async function forceCloseSeason(env: Env, rest: DiscordRest, tenant: Tenant, id: number, officerId: string, now: number): Promise<string> {
  let s = await getSeason(env, tenant.id, id);
  if (!s) return `❌ Open Season #${id} isn't on this Bounty Board.`;
  if (s.status === "paid" || s.status === "expired") return `❌ Open Season #${id} is already finished.`;
  if (s.status === "open") {
    await closeSeason(env, rest, tenant, s, now);
    s = (await getSeason(env, tenant.id, id))!;
  }
  if (s.status === "settling") {
    await env.DB.prepare("UPDATE season_kills SET verdict = 'denied', reviewed_by = ?1 WHERE tenant_id = ?2 AND season_id = ?3 AND verdict = 'pending'")
      .bind(officerId, tenant.id, id)
      .run();
    await settle(env, rest, tenant, s, now);
    s = (await getSeason(env, tenant.id, id))!;
  }
  if (s.status === "awaiting_payment") {
    const { results } = await env.DB.prepare("SELECT * FROM season_payouts WHERE tenant_id = ?1 AND season_id = ?2 AND done_at IS NULL").bind(tenant.id, id).all<PayoutRow>();
    for (const p of results) {
      const payers = (JSON.parse(p.payers_json) as Payer[]).map((x) => ({ ...x, paid_at: x.paid_at ?? now }));
      const wrote = await env.DB.prepare("UPDATE season_payouts SET payers_json = ?1, received_at = COALESCE(received_at, ?2), done_at = ?2 WHERE id = ?3 AND done_at IS NULL")
        .bind(JSON.stringify(payers), now, p.id)
        .run();
      if ((wrote.meta?.changes ?? 0) !== 1) continue;
      const r = await lineSettled(env, rest, tenant, { ...p, payers_json: JSON.stringify(payers), received_at: p.received_at ?? now, done_at: now }, s, officerId);
      if (p.message_id && s.thread_id) await rest.editMessage(s.thread_id, p.message_id, r.update!.content).catch(() => undefined);
      await r.after?.();
    }
  }
  await audit(env.DB, tenant.id, officerId, "season.force_close", { id }, now);
  const final = await getSeason(env, tenant.id, id);
  return `🔒 Open Season #${id} on **${escapeMd(s.guild_name)}** is now **${final?.status === "paid" ? "PAID" : final?.status === "expired" ? "ended" : (final?.status ?? "?")}**.`;
}

// ---------------------------------------------------------------- cron, commands, pack

/** Hourly, per tenant: seasons past their end date close. */
export async function seasonSweep(env: Env, rest: DiscordRest, tenant: Tenant, now: number): Promise<number> {
  const { results } = await env.DB.prepare("SELECT * FROM seasons WHERE tenant_id = ?1 AND status = 'open' AND expires_at <= ?2 LIMIT 10").bind(tenant.id, now).all<SeasonRow>();
  for (const s of results) await closeSeason(env, rest, tenant, s, now);
  return results.length;
}

/** /bl season list */
export async function listSeasons(env: Env, tenant: Tenant, now: number): Promise<string> {
  const { results } = await env.DB.prepare("SELECT * FROM seasons WHERE tenant_id = ?1 AND status = 'open' AND expires_at > ?2 ORDER BY id").bind(tenant.id, now).all<SeasonRow>();
  if (!results.length) return "No Open Season is running. In game, right-click an enemy player → **Set Bounty** and choose their guild.";
  return results
    .map((s) => `${SKULL} **#${s.id} ${escapeMd(s.guild_name)}** (${s.faction}) · ${seasonTerms(s)} · ends <t:${s.expires_at}:R>${s.thread_id ? ` · <#${s.thread_id}>` : ""}`)
    .join("\n");
}

/** /bl season end: the one who declared it, or an officer, closes it early. Kills so far are still paid. */
export async function endSeason(env: Env, rest: DiscordRest, tenant: Tenant, id: number, user: { id: string; officer: boolean }, now: number): Promise<string> {
  const s = await getSeason(env, tenant.id, id);
  if (!s) return `❌ Open Season #${id} isn't on this Bounty Board.`;
  if (s.status !== "open") return `❌ Open Season #${id} is already closed.`;
  if (!user.officer && user.id !== s.poster_discord_id) return "❌ Only the one who declared it, or an officer, can end an Open Season.";
  await closeSeason(env, rest, tenant, s, now);
  await audit(env.DB, tenant.id, user.id, "season.end", { id }, now);
  return `🔒 Open Season #${id} on **${escapeMd(s.guild_name)}** is closed. Kills so far are paid from the sheet${s.thread_id ? ` in <#${s.thread_id}>` : ""}.`;
}

/** Open seasons, for the Bounty Pack. */
export async function packSeasons(env: Env, tenant: Tenant, now: number): Promise<PackSeason[]> {
  const { results } = await env.DB.prepare("SELECT * FROM seasons WHERE tenant_id = ?1 AND status = 'open' AND expires_at > ?2 ORDER BY id").bind(tenant.id, now).all<SeasonRow>();
  return results.map((s) => ({
    seasonId: s.id,
    guildName: s.guild_name,
    guildFaction: factionId(s.faction),
    kind: s.kind,
    perKillGold: s.per_kill_gold,
    remainingGold: s.kind === SEASON_KIND.open ? 0 : s.kind === SEASON_KIND.pot ? remaining(s) : s.total_gold,
    posterName: s.poster_name ?? "",
    expiresAt: s.expires_at,
  }));
}
