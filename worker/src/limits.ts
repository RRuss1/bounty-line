/** Per-poster limits shared by bounties and Open Seasons. */
import type { Env } from "./env";
import type { Tenant } from "./tenants";

/**
 * Teeth for the honor system (spec 10). Nobody posts or adds gold while they owe on a bounty
 * approved unpaid_block_days ago or more; and a new bounty needs the poster under
 * max_open_per_poster open ones. Open Seasons use the owing check too.
 */
export async function posterChecks(
  env: Env,
  tenant: Tenant,
  authorId: string,
  now: number,
  opts: { newBounty: boolean },
): Promise<{ code: string; message: string } | null> {
  const days = tenant.config.unpaid_block_days;
  if (days > 0) {
    const owed = await env.DB.prepare(
      `SELECT b.id FROM contributions c
         JOIN bounties b ON b.id = c.bounty_id AND b.tenant_id = c.tenant_id
         JOIN kills k ON k.bounty_id = b.id AND k.tenant_id = b.tenant_id AND k.verdict IN ('approved', 'auto')
       WHERE c.tenant_id = ?1 AND c.poster_discord_id = ?2 AND c.paid_at IS NULL AND b.status = 'awaiting_payment'
         AND COALESCE(k.approved_at, k.claimed_at) <= ?3
       ORDER BY b.id LIMIT 1`,
    )
      .bind(tenant.id, authorId, now - days * 86400)
      .first<{ id: number }>();
    if (owed) {
      return {
        code: "OWING",
        message: `You still owe the reward on bounty #${owed.id}. Pay the hunter in game and click **Paid** in its thread, then post again.`,
      };
    }
  }
  const max = tenant.config.max_open_per_poster;
  if (opts.newBounty && max > 0) {
    const open = await env.DB.prepare("SELECT COUNT(*) AS n FROM bounties WHERE tenant_id = ?1 AND poster_discord_id = ?2 AND status IN ('open', 'review')")
      .bind(tenant.id, authorId)
      .first<{ n: number }>();
    if ((open?.n ?? 0) >= max) {
      return {
        code: "CAP",
        message: `You have ${open!.n} open bounties, the most this Bounty Board allows. Wait for one to be claimed or to expire, or cancel one with \`/bl cancel\`.`,
      };
    }
  }
  return null;
}
