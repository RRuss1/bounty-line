/**
 * Paying a bounty (spec 7.6): after a kill is approved, the bounty's thread gets a payment
 * post. Every contributor (the poster, plus anyone who stacked gold on it) clicks **Paid**
 * once they've sent their share in game; the hunter clicks **Received**. All of them -> the
 * bounty is PAID: tag, poster stamp, hunter's gold total, and the thread is closed. Officers
 * can **Force close** if someone goes quiet.
 */
import type { Env } from "./env";
import { log } from "./log";
import { type BountyRow, type ReviewResult, setBountyStatus } from "./kills";
import type { DiscordRest } from "./rest";
import { audit, type Tenant } from "./tenants";
import { gold } from "./wow";

interface KillRow {
  id: number;
  bounty_id: number;
  killer_discord_id: string | null;
  killer_name: string | null;
  verdict: string;
  paid_at: number | null;
  received_at: number | null;
}

export interface Contribution {
  poster_discord_id: string | null;
  poster_name: string | null;
  reward_gold: number;
  paid_at: number | null;
}

export async function contributions(env: Env, tenantId: string, bountyId: number): Promise<Contribution[]> {
  const { results } = await env.DB.prepare(
    "SELECT poster_discord_id, poster_name, reward_gold, paid_at FROM contributions WHERE tenant_id = ?1 AND bounty_id = ?2 ORDER BY id",
  )
    .bind(tenantId, bountyId)
    .all<Contribution>();
  return results;
}

const mark = (done: boolean) => (done ? "✅" : "⬜");
const allPaid = (cs: Contribution[]) => cs.every((c) => c.paid_at);

function paymentText(b: BountyRow, k: KillRow, cs: Contribution[], closedBy?: string): string {
  const head = `💰 **Payment for bounty #${b.id}:** <@${k.killer_discord_id ?? ""}> collects **${gold(b.reward_gold)}** in game (honor system).`;
  if (closedBy) return `${head}\n🔒 **Closed by <@${closedBy}>.** Marked as paid.`;
  if (allPaid(cs) && k.received_at) return `${head}\n✅ **PAID IN FULL.** Thanks for hunting!`;
  return [
    head,
    ...cs.map((c) => `${mark(!!c.paid_at)} <@${c.poster_discord_id ?? ""}> pays **${gold(c.reward_gold)}**`),
    `${mark(!!k.received_at)} Received (hunter)`,
    "Posters: click **Paid** once you've sent your share. Hunter: click **Received** once it all arrives.",
  ].join("\n");
}

function paymentButtons(killId: number) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 1, label: "Paid", custom_id: `pay:paid:${killId}` },
        { type: 2, style: 3, label: "Received", custom_id: `pay:received:${killId}` },
        { type: 2, style: 2, label: "Force close (officers)", custom_id: `pay:close:${killId}` },
      ],
    },
  ];
}

/** Posted in the bounty thread when a kill is approved. Pings every contributor and the hunter. */
export async function postPaymentPrompt(env: Env, rest: DiscordRest, b: BountyRow, killId: number, hunterId: string | null): Promise<void> {
  if (!b.thread_id) return;
  const cs = await contributions(env, b.tenant_id, b.id);
  const k: KillRow = { id: killId, bounty_id: b.id, killer_discord_id: hunterId, killer_name: null, verdict: "approved", paid_at: null, received_at: null };
  const users = [...new Set([...cs.map((c) => c.poster_discord_id), hunterId].filter((u): u is string => !!u))];
  await rest.send(b.thread_id, { content: paymentText(b, k, cs), components: paymentButtons(killId), allowed_mentions: { users } });
}

export async function handlePayment(
  env: Env,
  rest: DiscordRest,
  tenant: Tenant,
  action: "paid" | "received" | "close",
  killId: number,
  user: { id: string; roles: string[]; isAdmin: boolean },
  now: number,
): Promise<ReviewResult> {
  const k = await env.DB.prepare(
    "SELECT id, bounty_id, killer_discord_id, killer_name, verdict, paid_at, received_at FROM kills WHERE id = ?1 AND tenant_id = ?2",
  )
    .bind(killId, tenant.id)
    .first<KillRow>();
  const b = k && (await env.DB.prepare("SELECT * FROM bounties WHERE id = ?1 AND tenant_id = ?2").bind(k.bounty_id, tenant.id).first<BountyRow>());
  if (!k || !b) return { ephemeral: "I can't find that bounty any more." };
  if (b.status === "paid") return { ephemeral: `Bounty #${b.id} is already paid.` };
  if (k.verdict !== "approved" && k.verdict !== "auto") return { ephemeral: "That claim isn't approved." };

  const officer = user.isAdmin || (!!tenant.officer_role_id && user.roles.includes(tenant.officer_role_id));
  let cs = await contributions(env, tenant.id, b.id);
  if (action === "paid") {
    if (!cs.some((c) => c.poster_discord_id === user.id)) {
      return { ephemeral: `Only the bounty's posters (${cs.map((c) => `<@${c.poster_discord_id}>`).join(", ")}) can mark their share paid.` };
    }
    await env.DB.prepare("UPDATE contributions SET paid_at = ?1 WHERE tenant_id = ?2 AND bounty_id = ?3 AND poster_discord_id = ?4 AND paid_at IS NULL")
      .bind(now, tenant.id, b.id, user.id)
      .run();
    cs = await contributions(env, tenant.id, b.id);
    if (allPaid(cs)) await env.DB.prepare("UPDATE kills SET paid_at = COALESCE(paid_at, ?1) WHERE id = ?2").bind(now, k.id).run();
  } else if (action === "received") {
    if (user.id !== k.killer_discord_id) return { ephemeral: `Only the hunter (<@${k.killer_discord_id}>) can mark this received.` };
    if (!k.received_at) await env.DB.prepare("UPDATE kills SET received_at = ?1 WHERE id = ?2").bind(now, k.id).run();
    k.received_at = k.received_at ?? now;
  } else if (!officer) {
    return { ephemeral: `Only <@&${tenant.officer_role_id}> can force-close a bounty.` };
  }
  await audit(env.DB, tenant.id, user.id, `bounty.${action}`, { bounty: b.id, kill: k.id }, now);

  const done = action === "close" || (allPaid(cs) && !!k.received_at);
  if (!done) return { update: { content: paymentText(b, k, cs), components: paymentButtons(k.id) } };

  // Paid in full (or force-closed): stamp it, credit the hunter, then close the thread.
  await env.DB.prepare("UPDATE kills SET paid_at = COALESCE(paid_at, ?1), received_at = COALESCE(received_at, ?1) WHERE id = ?2").bind(now, k.id).run();
  await env.DB.prepare("UPDATE contributions SET paid_at = COALESCE(paid_at, ?1) WHERE tenant_id = ?2 AND bounty_id = ?3").bind(now, tenant.id, b.id).run();
  if (k.killer_discord_id) {
    await env.DB.prepare(
      `INSERT INTO hunters (tenant_id, discord_user_id, gold_earned) VALUES (?1, ?2, ?3)
       ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET gold_earned = gold_earned + ?3`,
    )
      .bind(tenant.id, k.killer_discord_id, b.reward_gold)
      .run();
  }
  await setBountyStatus(env, rest, tenant, b, "paid", now);
  log(env, "info", "bounty.paid", { tenant_id: tenant.id, bounty_id: b.id, outcome: action === "close" ? "force_closed" : "paid" });
  const threadId = b.thread_id;
  return {
    update: { content: paymentText(b, k, cs, action === "close" ? user.id : undefined), components: [] },
    // After the message is updated: archived threads can't be edited.
    after: threadId
      ? () => rest.closeThread(threadId).catch((e) => log(env, "warn", "bounty.archive_failed", { tenant_id: tenant.id, error: String(e) }))
      : undefined,
  };
}
