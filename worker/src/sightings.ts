/**
 * Last seen on the wanted posters (spec 5.10). Guildies' addons share sightings over guild
 * sync; a relay officer's addon gathers them into a W code every few minutes and the relay
 * program sends it here. Each open bounty keeps its newest sighting, and its poster says
 * where the target was, redrawn at most every POSTER_EVERY seconds (text only, not the picture).
 */
import type { SightingReport } from "./codec";
import type { Env } from "./env";
import { type BountyRow, posterFor } from "./kills";
import { log } from "./log";
import type { DiscordRest } from "./rest";
import type { Tenant } from "./tenants";

/** Sightings older than this when they arrive are dropped: the poster would mislead. */
export const SEEN_MAX_AGE = 6 * 3600;
/** A poster is redrawn for a new sighting at most this often. */
export const POSTER_EVERY = 600;
const MAX_NAME = 40;

type SeenRow = BountyRow & { seen_shown_at: number | null; seen_drawn_at: number | null };

/** Stores a report's sightings. Returns how many bounties now have a newer last-seen. */
export async function recordSightings(env: Env, rest: DiscordRest, tenant: Tenant, report: SightingReport, now: number): Promise<number> {
  // One per bounty: the newest.
  const newest = new Map<number, SightingReport["sightings"][number]>();
  for (const s of report.sightings) {
    const cur = newest.get(s.bountyId);
    if (!cur || s.seenAt > cur.seenAt) newest.set(s.bountyId, s);
  }
  let updated = 0;
  for (const s of newest.values()) {
    const at = Math.min(s.seenAt, now); // a client clock ahead of ours can't date it in the future
    if (at < now - SEEN_MAX_AGE) continue;
    const by = [...s.spotterName].slice(0, MAX_NAME).join("");
    const r = await env.DB.prepare(
      `UPDATE bounties SET last_seen_at = ?3, last_seen_map = ?4, last_seen_by = ?5
       WHERE tenant_id = ?1 AND id = ?2 AND status IN ('open', 'review') AND (last_seen_at IS NULL OR last_seen_at < ?3)`,
    )
      .bind(tenant.id, s.bountyId, at, s.mapID, by)
      .run();
    if ((r.meta?.changes ?? 0) === 0) continue; // not ours, closed, or we already have a newer one
    updated++;
    const b = await env.DB.prepare("SELECT * FROM bounties WHERE tenant_id = ?1 AND id = ?2").bind(tenant.id, s.bountyId).first<SeenRow>();
    if (b) await redrawSeen(env, rest, tenant, b, now);
  }
  return updated;
}

/** Shows the bounty's newest sighting on its poster, unless the poster was redrawn for one too recently. */
export async function redrawSeen(env: Env, rest: DiscordRest, tenant: Tenant, b: SeenRow, now: number): Promise<boolean> {
  if (!b.thread_id || !b.last_seen_at) return false;
  if ((b.seen_shown_at ?? 0) >= b.last_seen_at) return false; // already showing it
  if (now - (b.seen_drawn_at ?? 0) < POSTER_EVERY) return false; // the hourly sweep catches it up
  // Claim the redraw first, so two reports arriving together don't both edit the post.
  const claimed = await env.DB.prepare(
    "UPDATE bounties SET seen_shown_at = ?3, seen_drawn_at = ?4 WHERE tenant_id = ?1 AND id = ?2 AND COALESCE(seen_drawn_at, 0) = ?5",
  )
    .bind(tenant.id, b.id, b.last_seen_at, now, b.seen_drawn_at ?? 0)
    .run();
  if ((claimed.meta?.changes ?? 0) === 0) return false;
  try {
    const { poster } = await posterFor(env, tenant, b, b.status === "review" ? "review" : "open");
    // No image: the parchment picture stays as it is (Discord keeps attachments not mentioned).
    await rest.editPost(b.thread_id, b.thread_id, { content: poster.content, embed: poster.embed });
    return true;
  } catch (e) {
    log(env, "warn", "bounty.seen_update_failed", { tenant_id: tenant.id, bounty_id: b.id, error: String(e) });
    return false;
  }
}

/** Hourly: posters whose newest sighting arrived inside the 10-minute gap get it now. */
export async function seenSweep(env: Env, rest: DiscordRest, tenant: Tenant, now: number): Promise<number> {
  const { results } = await env.DB.prepare(
    `SELECT * FROM bounties WHERE tenant_id = ?1 AND status IN ('open', 'review') AND thread_id IS NOT NULL
       AND last_seen_at > COALESCE(seen_shown_at, 0) LIMIT 25`,
  )
    .bind(tenant.id)
    .all<SeenRow>();
  let n = 0;
  for (const b of results) if (await redrawSeen(env, rest, tenant, b, now)) n++;
  return n;
}
