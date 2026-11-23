/**
 * /bl leaderboard, /bl me and /bl cancel (spec 7.5), plus the weekly recap and the hourly
 * expiry sweep (spec 7.3 crons, 8.4 nudges).
 */
import { isAllowedGuild } from "./discord";
import type { Env } from "./env";
import { retagBounties, setBountyStatus, type BountyRow } from "./kills";
import { log } from "./log";
import type { DiscordRest } from "./rest";
import { seasonSweep } from "./seasons";
import { refreshPack } from "./pack";
import { seenSweep } from "./sightings";
import { audit, getTenant, patchConfig, type Tenant } from "./tenants";
import { escapeMd, gold } from "./wow";

const medal = (i: number) => ["🥇", "🥈", "🥉"][i] ?? `${i + 1}.`;
const DAY = 86400;

// ---------------------------------------------------------------- leaderboard

async function mostWanted(env: Env, tenant: Tenant, now: number, limit = 5): Promise<string[]> {
  const { results } = await env.DB.prepare(
    "SELECT id, target_name, reward_gold, thread_id FROM bounties WHERE tenant_id = ?1 AND status = 'open' AND expires_at > ?2 ORDER BY reward_gold DESC, id LIMIT ?3",
  )
    .bind(tenant.id, now, limit)
    .all<{ id: number; target_name: string | null; reward_gold: number; thread_id: string | null }>();
  return results.map((b, i) => `${medal(i)} **${escapeMd(b.target_name ?? "?")}** · ${gold(b.reward_gold)}${b.thread_id ? ` · <#${b.thread_id}>` : ""}`);
}

export async function leaderboard(env: Env, tenant: Tenant, now: number): Promise<string> {
  const [hunters, payers] = await env.DB.batch<{ who: string; gold: number; n: number }>([
    env.DB.prepare(
      "SELECT discord_user_id AS who, gold_earned AS gold, approved AS n FROM hunters WHERE tenant_id = ?1 AND (gold_earned > 0 OR approved > 0) ORDER BY gold_earned DESC, approved DESC LIMIT 5",
    ).bind(tenant.id),
    env.DB.prepare(
      `SELECT c.poster_discord_id AS who, SUM(c.reward_gold) AS gold, COUNT(*) AS n FROM contributions c
       JOIN bounties b ON b.id = c.bounty_id AND b.tenant_id = c.tenant_id
       WHERE c.tenant_id = ?1 AND b.status = 'paid' AND c.poster_discord_id IS NOT NULL GROUP BY c.poster_discord_id ORDER BY gold DESC LIMIT 5`,
    ).bind(tenant.id),
  ]);
  const wanted = await mostWanted(env, tenant, now);
  const none = "_Nobody yet._";
  return [
    "**☠️ Bounty Board leaderboard**",
    "",
    "**Top hunters**",
    ...(hunters!.results.length ? hunters!.results.map((h, i) => `${medal(i)} <@${h.who}> · ${gold(h.gold)} earned · ${h.n} kills`) : [none]),
    "",
    "**Most wanted**",
    ...(wanted.length ? wanted : [none]),
    "",
    "**Biggest payers**",
    ...(payers!.results.length ? payers!.results.map((p, i) => `${medal(i)} <@${p.who}> · ${gold(p.gold)} paid out · ${p.n} bounties`) : [none]),
  ].join("\n");
}

// ---------------------------------------------------------------- /bl me

export async function me(env: Env, tenant: Tenant, user: string): Promise<string> {
  const h = await env.DB.prepare("SELECT approved, denied, gold_earned, trust, streak FROM hunters WHERE tenant_id = ?1 AND discord_user_id = ?2")
    .bind(tenant.id, user)
    .first<{ approved: number; denied: number; gold_earned: number; trust: string | null; streak: number | null }>();
  const [posted, owe, owed] = await env.DB.batch<{ id: number; target_name: string | null; reward_gold: number; who?: string }>([
    env.DB.prepare("SELECT id, target_name, reward_gold FROM bounties WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND status IN ('open', 'review') ORDER BY id").bind(tenant.id, user),
    env.DB.prepare(
      `SELECT b.id, b.target_name, c.reward_gold, k.killer_discord_id AS who FROM contributions c
       JOIN bounties b ON b.id = c.bounty_id AND b.tenant_id = c.tenant_id
       JOIN kills k ON k.bounty_id = b.id AND k.tenant_id = b.tenant_id AND k.verdict IN ('approved', 'auto')
       WHERE c.tenant_id = ?1 AND c.poster_discord_id = ?2 AND c.paid_at IS NULL AND b.status = 'awaiting_payment'`,
    ).bind(tenant.id, user),
    env.DB.prepare(
      `SELECT b.id, b.target_name, b.reward_gold, b.poster_discord_id AS who FROM bounties b JOIN kills k ON k.bounty_id = b.id AND k.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?1 AND k.killer_discord_id = ?2 AND b.status = 'awaiting_payment' AND k.verdict IN ('approved', 'auto') AND k.received_at IS NULL`,
    ).bind(tenant.id, user),
  ]);
  const threshold = tenant.config.trust_threshold;
  const trust =
    h?.trust === "trusted" ? "⭐ **Trusted**: clean claims are approved automatically" : `New: ${h?.streak ?? 0}/${threshold} approved kills in a row to become trusted`;
  const list = (rows: { id: number; target_name: string | null; reward_gold: number; who?: string }[], fmt: (r: (typeof rows)[number]) => string) =>
    rows.length ? rows.map(fmt) : ["_None._"];
  return [
    "**Your Bounty Board record**",
    `Kills approved: **${h?.approved ?? 0}** · denied: ${h?.denied ?? 0} · gold earned: **${gold(h?.gold_earned ?? 0)}**`,
    trust,
    "",
    "**Your open bounties**",
    ...list(posted!.results, (b) => `#${b.id} ${escapeMd(b.target_name ?? "?")} · ${gold(b.reward_gold)}`),
    "",
    "**You owe** (click **Paid** in the thread once sent)",
    ...list(owe!.results, (b) => `#${b.id} ${escapeMd(b.target_name ?? "?")}: ${gold(b.reward_gold)} to <@${b.who}>`),
    "",
    "**Owed to you** (click **Received** when it arrives)",
    ...list(owed!.results, (b) => `#${b.id} ${escapeMd(b.target_name ?? "?")}: ${gold(b.reward_gold)} from <@${b.who}>`),
  ].join("\n");
}

// ---------------------------------------------------------------- /bl cancel

export async function cancel(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  id: number,
  user: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
): Promise<string> {
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant.id).first<BountyRow>();
  if (!b) return `❌ There's no bounty #${id} on this board.`;
  const officer = user.isAdmin || (!!tenant.officer_role_id && user.roles.includes(tenant.officer_role_id));
  if (b.poster_discord_id !== user.id && !officer) return "❌ Only the poster or an officer can cancel a bounty.";
  if (b.status !== "open") return `❌ Bounty #${id} can't be cancelled now (it's ${b.status.replace("_", " ")}).`;
  await setBountyStatus(env, rest, tenant, b, "cancelled", now);
  await audit(env.DB, tenant.id, user.id, "bounty.cancel", { bounty: id }, now);
  return `🚫 Bounty #${id} on **${escapeMd(b.target_name ?? "?")}** is cancelled.`;
}

/** Longest a bounty can run, counted from now (matches expiry_days' upper limit). */
export const MAX_RUN_DAYS = 60;

/** /bl extend: more days on an open bounty. Its poster, anyone who added gold, or an officer. */
export async function extend(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  id: number,
  days: number,
  user: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
): Promise<string> {
  const b = await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(id, tenant.id).first<BountyRow>();
  if (!b) return `❌ There's no bounty #${id} on this board.`;
  const officer = user.isAdmin || (!!tenant.officer_role_id && user.roles.includes(tenant.officer_role_id));
  const contributor = await env.DB.prepare("SELECT 1 FROM contributions WHERE tenant_id = ?1 AND bounty_id = ?2 AND poster_discord_id = ?3")
    .bind(tenant.id, id, user.id)
    .first();
  if (b.poster_discord_id !== user.id && !contributor && !officer) return "❌ Only the poster, someone who added gold, or an officer can extend a bounty.";
  if (b.status !== "open" || b.expires_at <= now) return `❌ Bounty #${id} isn't open, so it can't be extended.`;
  if (!Number.isInteger(days) || days < 1 || days > MAX_RUN_DAYS) return `❌ Extend by 1 to ${MAX_RUN_DAYS} days.`;
  const cap = now + MAX_RUN_DAYS * 86400;
  if (b.expires_at >= cap) return `❌ Bounty #${id} already runs the longest it can (${MAX_RUN_DAYS} days from now).`;
  const expires = Math.min(b.expires_at + days * 86400, cap);
  await env.DB.prepare("UPDATE bounties SET expires_at = ?1 WHERE id = ?2 AND tenant_id = ?3").bind(expires, id, tenant.id).run();
  // Same status: redraws the poster with the new date and refreshes the Bounty Pack.
  await setBountyStatus(env, rest, tenant, { ...b, expires_at: expires }, "open", now);
  await audit(env.DB, tenant.id, user.id, "bounty.extend", { bounty: id, days, expires }, now);
  const capped = expires === cap && b.expires_at + days * 86400 > cap ? ` (capped at ${MAX_RUN_DAYS} days from now)` : "";
  return `⏳ Bounty #${id} on **${escapeMd(b.target_name ?? "?")}** now runs until <t:${expires}:D>${capped}.`;
}

// ---------------------------------------------------------------- crons

async function tenantIds(env: Env): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT id FROM tenants").all<{ id: string }>();
  return results.map((r) => r.id).filter((id) => isAllowedGuild(env, id));
}

/** Hourly: open bounties past their expiry move to Expired (tag, stamp, pack). */
export async function expirySweep(env: Env, rest: DiscordRest, now: number): Promise<number> {
  let n = 0;
  for (const id of await tenantIds(env)) {
    const tenant = await getTenant(env.DB, id);
    if (!tenant) continue;
    const { results } = await env.DB.prepare("SELECT * FROM bounties WHERE tenant_id = ?1 AND status = 'open' AND expires_at <= ?2 LIMIT 25")
      .bind(id, now)
      .all<BountyRow>();
    for (const b of results) {
      await setBountyStatus(env, rest, tenant, b, "expired", now);
      n++;
    }
    n += await seasonSweep(env, rest, tenant, now); // Open Seasons past their end date: payout sheet
    await seenSweep(env, rest, tenant, now); // last-seen lines held back by the 10-minute gap
  }
  if (n) log(env, "info", "cron.expired", { count: n });
  await proofCleanup(env, now);
  return n;
}

/**
 * Proof screenshots are deleted from R2 PROOF_RETENTION_DAYS after their bounty closes
 * (Compendium 01 Section 7). Runs with the hourly sweep, a batch at a time.
 */
export async function proofCleanup(env: Env, now: number): Promise<number> {
  const days = Number(env.PROOF_RETENTION_DAYS ?? 180);
  const { results } = await env.DB.prepare(
    `SELECT k.id, k.image_r2_key FROM kills k JOIN bounties b ON b.id = k.bounty_id AND b.tenant_id = k.tenant_id
     WHERE k.image_r2_key IS NOT NULL AND b.closed_at IS NOT NULL AND b.closed_at <= ?1 LIMIT 50`,
  )
    .bind(now - days * DAY)
    .all<{ id: number; image_r2_key: string }>();
  for (const k of results) {
    await env.PROOFS.delete(k.image_r2_key);
    await env.DB.prepare("UPDATE kills SET image_r2_key = NULL WHERE id = ?1").bind(k.id).run();
  }
  // Open Season proofs, the same way.
  const { results: seasonShots } = await env.DB.prepare(
    `SELECT k.id, k.image_r2_key FROM season_kills k JOIN seasons s ON s.id = k.season_id AND s.tenant_id = k.tenant_id
     WHERE k.image_r2_key IS NOT NULL AND s.status IN ('paid', 'expired') AND s.closed_at IS NOT NULL AND s.closed_at <= ?1 LIMIT 50`,
  )
    .bind(now - days * DAY)
    .all<{ id: number; image_r2_key: string }>();
  for (const k of seasonShots) {
    await env.PROOFS.delete(k.image_r2_key);
    await env.DB.prepare("UPDATE season_kills SET image_r2_key = NULL WHERE id = ?1").bind(k.id).run();
  }
  const count = results.length + seasonShots.length;
  if (count) log(env, "info", "cron.proofs_deleted", { count });
  return count;
}

// ---------------------------------------------------------------- /bl forget-me (spec 13)

/**
 * Deletes a user's character links and hunter stats. On closed bounties their name comes off
 * the record and their kill screenshots are deleted; open bounties and pending payments stay,
 * so nobody is left unpaid.
 */
export async function forgetMe(env: Env, tenant: Tenant, user: string, now: number): Promise<string> {
  const closed = "('paid', 'expired', 'cancelled')";
  const { results: shots } = await env.DB.prepare(
    `SELECT k.id, k.image_r2_key FROM kills k JOIN bounties b ON b.id = k.bounty_id AND b.tenant_id = k.tenant_id
     WHERE k.tenant_id = ?1 AND k.killer_discord_id = ?2 AND k.image_r2_key IS NOT NULL AND b.status IN ${closed}`,
  )
    .bind(tenant.id, user)
    .all<{ id: number; image_r2_key: string }>();
  // Open Season: the same rule. Seasons still running or awaiting payment are left alone.
  const done = "(SELECT id FROM seasons WHERE tenant_id = ?1 AND status IN ('paid', 'expired'))";
  const { results: seasonShots } = await env.DB.prepare(
    `SELECT id, image_r2_key FROM season_kills WHERE tenant_id = ?1 AND killer_discord_id = ?2 AND image_r2_key IS NOT NULL AND season_id IN ${done}`,
  )
    .bind(tenant.id, user)
    .all<{ id: number; image_r2_key: string }>();
  shots.push(...seasonShots);
  const { results: lines } = await env.DB.prepare(
    `SELECT id, payers_json FROM season_payouts WHERE tenant_id = ?1 AND season_id IN ${done} AND payers_json LIKE ?2`,
  )
    .bind(tenant.id, `%"${user}"%`)
    .all<{ id: number; payers_json: string }>();
  for (const line of lines) {
    const payers = (JSON.parse(line.payers_json) as { id: string; name: string }[]).map((p) => (p.id === user ? { ...p, id: "", name: "" } : p));
    await env.DB.prepare("UPDATE season_payouts SET payers_json = ?1 WHERE id = ?2").bind(JSON.stringify(payers), line.id).run();
  }
  for (const s of shots) await env.PROOFS.delete(s.image_r2_key);
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE season_kills SET killer_discord_id = NULL, killer_name = NULL, killer_guid = NULL, image_r2_key = NULL
       WHERE tenant_id = ?1 AND killer_discord_id = ?2 AND season_id IN ${done}`,
    ).bind(tenant.id, user),
    env.DB.prepare(
      `UPDATE season_funds SET poster_discord_id = NULL, poster_name = NULL, poster_guid = NULL
       WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND season_id IN ${done}`,
    ).bind(tenant.id, user),
    env.DB.prepare(
      `UPDATE seasons SET poster_discord_id = NULL, poster_name = NULL, poster_guid = NULL WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND status IN ('paid', 'expired')`,
    ).bind(tenant.id, user),
    env.DB.prepare(`DELETE FROM season_payouts WHERE tenant_id = ?1 AND hunter_discord_id = ?2 AND season_id IN ${done}`).bind(tenant.id, user),
    env.DB.prepare("DELETE FROM characters WHERE tenant_id = ?1 AND discord_user_id = ?2").bind(tenant.id, user),
    env.DB.prepare("DELETE FROM hunters WHERE tenant_id = ?1 AND discord_user_id = ?2").bind(tenant.id, user),
    env.DB.prepare(
      `UPDATE kills SET killer_discord_id = NULL, killer_name = NULL, killer_guid = NULL, image_r2_key = NULL
       WHERE tenant_id = ?1 AND killer_discord_id = ?2 AND bounty_id IN (SELECT id FROM bounties WHERE tenant_id = ?1 AND status IN ${closed})`,
    ).bind(tenant.id, user),
    env.DB.prepare(
      `UPDATE contributions SET poster_discord_id = NULL, poster_name = NULL, poster_guid = NULL
       WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND bounty_id IN (SELECT id FROM bounties WHERE tenant_id = ?1 AND status IN ${closed})`,
    ).bind(tenant.id, user),
    env.DB.prepare(
      `UPDATE bounties SET poster_discord_id = NULL, poster_name = NULL, poster_guid = NULL
       WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND status IN ${closed}`,
    ).bind(tenant.id, user),
  ]);
  await audit(env.DB, tenant.id, "forget-me", "user.forget", { screenshots: shots.length }, now);
  return `🧹 Done. Your character links and stats are deleted, and your name is off closed bounties (${shots.length} screenshot${shots.length === 1 ? "" : "s"} deleted). Open bounties and unpaid rewards are kept so nobody loses gold.`;
}

// ---------------------------------------------------------------- /bl config (admins)

const AUTO = ["off", "trusted_only", "all_clean"] as const;

export async function configure(env: Env, rest: DiscordRest, tenant: Tenant, o: Record<string, string>, now: number): Promise<string> {
  const c = tenant.config;
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  const int = (key: string, min: number, max: number) => {
    if (o[key] === undefined) return;
    const v = Number(o[key]);
    if (!Number.isInteger(v) || v < min || v > max) errors.push(`\`${key}\` must be ${min} to ${max}.`);
    else patch[key] = v;
  };
  int("reward_min", 1, 1_000_000);
  int("reward_max", 1, 1_000_000);
  int("expiry_days", 1, 60);
  int("proof_window_hours", 1, 168);
  int("trust_threshold", 1, 50);
  int("hardcore_min_gold", 0, 1_000_000);
  int("claim_cooldown_minutes", 0, 1440);
  int("unpaid_block_days", 0, 60);
  int("max_open_per_poster", 0, 100);
  int("hunter_ping_min_gold", 0, 1_000_000);
  if (o.hunter_role !== undefined) {
    if (/^[0-9]{17,20}$/.test(o.hunter_role)) patch.hunter_role = o.hunter_role;
    else errors.push("`hunter_role` must be a role.");
  }
  if (o.auto_approve !== undefined) {
    if ((AUTO as readonly string[]).includes(o.auto_approve)) patch.auto_approve = o.auto_approve;
    else errors.push("`auto_approve` must be off, trusted_only or all_clean.");
  }
  for (const key of ["allow_stacking", "weekly_recap"]) if (o[key] !== undefined) patch[key] = o[key] === "true";
  const min = (patch.reward_min as number | undefined) ?? c.reward_min;
  const max = (patch.reward_max as number | undefined) ?? c.reward_max;
  if (min > max) errors.push("`reward_min` can't be above `reward_max`.");
  if (errors.length) return `❌ ${errors.join(" ")}`;

  if (Object.keys(patch).length) await patchConfig(env.DB, tenant.id, patch);
  if (o.hall_of_fame !== undefined) {
    await env.DB.prepare("UPDATE tenants SET hall_of_fame_ch = ?1 WHERE id = ?2").bind(o.hall_of_fame, tenant.id).run();
  }
  const fresh = (await getTenant(env.DB, tenant.id))!;
  if (patch.reward_min !== undefined || patch.reward_max !== undefined) await refreshPack(env, rest, fresh, now); // limits travel in the pack
  if (patch.hardcore_min_gold !== undefined) await retagBounties(env, rest, fresh); // add or drop Hardcore on live bounties
  if (Object.keys(patch).length || o.hall_of_fame !== undefined) await audit(env.DB, tenant.id, "admin", "config", { ...patch, hall_of_fame: o.hall_of_fame }, now);
  const f = fresh.config;
  return [
    Object.keys(patch).length || o.hall_of_fame !== undefined ? "✅ **Settings saved.**" : "**Bounty Board settings**",
    `Rewards: ${gold(f.reward_min)} to ${gold(f.reward_max)} · bounties last ${f.expiry_days} days · kill proof within ${f.proof_window_hours}h`,
    `Auto-approve: **${f.auto_approve}** · trusted after ${f.trust_threshold} approved kills in a row`,
    `Hardcore tag: ${f.hardcore_min_gold > 0 ? `bounties of ${gold(f.hardcore_min_gold)} or more` : "off"}`,
    `Hunters ping: ${f.hunter_role && f.hunter_ping_min_gold > 0 ? `<@&${f.hunter_role}> on new bounties of ${gold(f.hunter_ping_min_gold)} or more` : "off"}`,
    `Same target again: ${f.claim_cooldown_minutes > 0 ? `${f.claim_cooldown_minutes} min after a hunter's last kill on them` : "any time"} · ` +
      `unpaid block: ${f.unpaid_block_days > 0 ? `${f.unpaid_block_days} days` : "off"} · ` +
      `open bounties per poster: ${f.max_open_per_poster > 0 ? f.max_open_per_poster : "no limit"}`,
    `Stacking: ${f.allow_stacking ? "on" : "off"} · weekly recap: ${f.weekly_recap ? "on" : "off"} in ${fresh.hall_of_fame_ch ? `<#${fresh.hall_of_fame_ch}>` : `<#${fresh.bounty_line_ch}>`}`,
  ].join("\n");
}

/** Weekly (Sunday): Most Wanted, the week's top hunters, and a gentle unpaid-bounty nudge. */
export async function weeklyRecap(env: Env, rest: DiscordRest, now: number): Promise<number> {
  let posted = 0;
  for (const id of await tenantIds(env)) {
    const tenant = await getTenant(env.DB, id);
    const channel = tenant?.hall_of_fame_ch || tenant?.bounty_line_ch;
    if (!tenant || !channel || !tenant.config.weekly_recap) continue;
    const { results: week } = await env.DB.prepare(
      `SELECT k.killer_discord_id AS who, SUM(b.reward_gold) AS gold, COUNT(*) AS n FROM kills k JOIN bounties b ON b.id = k.bounty_id AND b.tenant_id = k.tenant_id
       WHERE k.tenant_id = ?1 AND k.verdict IN ('approved', 'auto') AND k.claimed_at >= ?2 AND k.killer_discord_id IS NOT NULL
       GROUP BY k.killer_discord_id ORDER BY gold DESC LIMIT 5`,
    )
      .bind(id, now - 7 * DAY)
      .all<{ who: string; gold: number; n: number }>();
    const { results: unpaid } = await env.DB.prepare(
      `SELECT b.id, b.target_name, b.reward_gold, b.poster_discord_id AS poster, k.killer_discord_id AS hunter FROM bounties b
       JOIN kills k ON k.bounty_id = b.id AND k.tenant_id = b.tenant_id AND k.verdict IN ('approved', 'auto')
       WHERE b.tenant_id = ?1 AND b.status = 'awaiting_payment' AND k.claimed_at <= ?2 ORDER BY b.id LIMIT 10`,
    )
      .bind(id, now - 2 * DAY)
      .all<{ id: number; target_name: string | null; reward_gold: number; poster: string | null; hunter: string | null }>();
    const wanted = await mostWanted(env, tenant, now);
    if (!week.length && !unpaid.length && !wanted.length) continue;
    const text = [
      "**📜 This week on the Bounty Board**",
      "",
      "**Most wanted**",
      ...(wanted.length ? wanted : ["_No open bounties. Post one!_"]),
      "",
      "**Top hunters this week**",
      ...(week.length ? week.map((h, i) => `${medal(i)} <@${h.who}> · ${gold(h.gold)} · ${h.n} kills`) : ["_No kills this week._"]),
      ...(unpaid.length
        ? ["", "**Still unpaid** (honor system: settle up in game, then click Paid / Received)", ...unpaid.map((u) => `#${u.id} ${escapeMd(u.target_name ?? "?")}: <@${u.poster}> → <@${u.hunter}> ${gold(u.reward_gold)}`)]
        : []),
    ].join("\n");
    try {
      await rest.sendMessage(channel, text);
      posted++;
    } catch (e) {
      log(env, "warn", "cron.recap_failed", { tenant_id: id, error: String(e) });
    }
  }
  return posted;
}
