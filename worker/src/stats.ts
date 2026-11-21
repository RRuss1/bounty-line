/**
 * /bl leaderboard, /bl me and /bl cancel (spec 7.5), plus the weekly recap and the hourly
 * expiry sweep (spec 7.3 crons, 8.4 nudges).
 */
import { isAllowedGuild } from "./discord";
import type { Env } from "./env";
import { setBountyStatus, type BountyRow } from "./kills";
import { log } from "./log";
import type { DiscordRest } from "./rest";
import { audit, getTenant, type Tenant } from "./tenants";
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
      "SELECT poster_discord_id AS who, SUM(reward_gold) AS gold, COUNT(*) AS n FROM bounties WHERE tenant_id = ?1 AND status = 'paid' AND poster_discord_id IS NOT NULL GROUP BY poster_discord_id ORDER BY gold DESC LIMIT 5",
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
      `SELECT b.id, b.target_name, b.reward_gold, k.killer_discord_id AS who FROM bounties b JOIN kills k ON k.bounty_id = b.id AND k.tenant_id = b.tenant_id
       WHERE b.tenant_id = ?1 AND b.poster_discord_id = ?2 AND b.status = 'awaiting_payment' AND k.verdict IN ('approved', 'auto') AND k.paid_at IS NULL`,
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
  }
  if (n) log(env, "info", "cron.expired", { count: n });
  return n;
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
