/**
 * Paying a bounty (spec 7.6): after an officer approves a kill, the bounty's thread gets a
 * payment post. The poster clicks **Paid** ("I sent the gold in game"), the hunter clicks
 * **Received**. Both -> the bounty is PAID: tag, poster stamp, hunter's gold total, and the
 * thread is closed. Officers can **Force close** if someone goes quiet.
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

const mark = (done: boolean) => (done ? "✅" : "⬜");

function paymentText(b: BountyRow, k: KillRow, closedBy?: string): string {
  const head = `💰 **Payment for bounty #${b.id}:** <@${b.poster_discord_id ?? ""}> pays <@${k.killer_discord_id ?? ""}> **${gold(b.reward_gold)}** in game (honor system).`;
  if (closedBy) return `${head}\n🔒 **Closed by <@${closedBy}>.** Marked as paid.`;
  if (k.paid_at && k.received_at) return `${head}\n✅ **PAID IN FULL.** Thanks for hunting!`;
  return [
    head,
    `${mark(!!k.paid_at)} Paid (poster) · ${mark(!!k.received_at)} Received (hunter)`,
    "Poster: click **Paid** once you've sent the gold. Hunter: click **Received** once it arrives.",
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

/** Posted in the bounty thread when a kill is approved. Pings the poster and the hunter. */
export async function postPaymentPrompt(rest: DiscordRest, b: BountyRow, killId: number, hunterId: string | null): Promise<void> {
  if (!b.thread_id) return;
  const k: KillRow = { id: killId, bounty_id: b.id, killer_discord_id: hunterId, killer_name: null, verdict: "approved", paid_at: null, received_at: null };
  await rest.send(b.thread_id, {
    content: paymentText(b, k),
    components: paymentButtons(killId),
    allowed_mentions: { users: [b.poster_discord_id, hunterId].filter((u): u is string => !!u) },
  });
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
  if (k.verdict !== "approved") return { ephemeral: "That claim isn't approved." };

  const officer = user.isAdmin || (!!tenant.officer_role_id && user.roles.includes(tenant.officer_role_id));
  if (action === "paid") {
    if (user.id !== b.poster_discord_id) return { ephemeral: `Only the poster (<@${b.poster_discord_id}>) can mark this paid.` };
    if (!k.paid_at) await env.DB.prepare("UPDATE kills SET paid_at = ?1 WHERE id = ?2").bind(now, k.id).run();
    k.paid_at = k.paid_at ?? now;
  } else if (action === "received") {
    if (user.id !== k.killer_discord_id) return { ephemeral: `Only the hunter (<@${k.killer_discord_id}>) can mark this received.` };
    if (!k.received_at) await env.DB.prepare("UPDATE kills SET received_at = ?1 WHERE id = ?2").bind(now, k.id).run();
    k.received_at = k.received_at ?? now;
  } else if (!officer) {
    return { ephemeral: `Only <@&${tenant.officer_role_id}> can force-close a bounty.` };
  }
  await audit(env.DB, tenant.id, user.id, `bounty.${action}`, { bounty: b.id, kill: k.id }, now);

  const done = action === "close" || (!!k.paid_at && !!k.received_at);
  if (!done) return { update: { content: paymentText(b, k), components: paymentButtons(k.id) } };

  // Paid in full (or force-closed): stamp it, credit the hunter, then close the thread.
  await env.DB.prepare("UPDATE kills SET paid_at = COALESCE(paid_at, ?1), received_at = COALESCE(received_at, ?1) WHERE id = ?2").bind(now, k.id).run();
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
    update: { content: paymentText(b, k, action === "close" ? user.id : undefined), components: [] },
    // After the message is updated: archived threads can't be edited.
    after: threadId
      ? () => rest.closeThread(threadId).catch((e) => log(env, "warn", "bounty.archive_failed", { tenant_id: tenant.id, error: String(e) }))
      : undefined,
  };
}
