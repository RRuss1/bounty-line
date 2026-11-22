/**
 * The relay (spec 5.10): a small program on an officer's PC that carries data between the game
 * and the Bounty Board without anyone pasting.
 *   GET  /relay/pack  the current Bounty Pack, for the relay to hand to the addon
 *   POST /relay/code  a bounty code a guildie's addon sent over guild sync
 *
 * Auth: "Authorization: Bearer <guildId>.<secret>", made by /bl relay. The guild id is in the
 * token so the ALLOWED_GUILD_IDS check runs before any D1 work (Compendium 01 Section 3.4).
 */
import { processCode } from "./bounties";
import { decode } from "./codec";
import { isAllowedGuild, json } from "./discord";
import type { Env } from "./env";
import { log } from "./log";
import { buildPack } from "./pack";
import { RateLimiter } from "./ratelimit";
import { DiscordRest } from "./rest";
import { audit, getTenant, type Tenant } from "./tenants";
import { escapeMd } from "./wow";

const MAX_BODY_BYTES = 8 * 1024;
/** Every request for a guild, before the token is looked up: bounds what a stranger can cost. */
export const relayGuildLimiter = new RateLimiter(120, 60_000);
/** Codes per relay per minute. */
export const relayCodeLimiter = new RateLimiter(20, 60_000);
/** "Link your character" notices in the channel: one per character per hour. */
export const relayNoticeLimiter = new RateLimiter(1, 3_600_000);

async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}

const error = (status: number, code: string, message: string) => json({ ok: false, code, message }, status);

// ---------------------------------------------------------------- tokens (/bl relay)

/** Makes (or replaces) the user's relay token. The token itself is never stored, only its hash. */
export async function issueRelayToken(env: Env, tenant: Tenant, userId: string, now: number): Promise<string> {
  const secret = btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  const token = `${tenant.id}.${secret}`;
  await env.DB.prepare(
    `INSERT INTO relay_tokens (tenant_id, discord_user_id, token_hash, created_at, revoked_at) VALUES (?1, ?2, ?3, ?4, NULL)
     ON CONFLICT(tenant_id, discord_user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, revoked_at = NULL`,
  )
    .bind(tenant.id, userId, await sha256Hex(token), now)
    .run();
  await audit(env.DB, tenant.id, userId, "relay.enable", {}, now);
  return token;
}

/** Returns true if the user had a live token. */
export async function revokeRelayToken(env: Env, tenant: Tenant, userId: string, now: number): Promise<boolean> {
  const r = await env.DB.prepare("UPDATE relay_tokens SET revoked_at = ?3 WHERE tenant_id = ?1 AND discord_user_id = ?2 AND revoked_at IS NULL")
    .bind(tenant.id, userId, now)
    .run();
  const changed = (r.meta?.changes ?? 0) > 0;
  if (changed) await audit(env.DB, tenant.id, userId, "relay.revoke", {}, now);
  return changed;
}

export async function relayUsers(env: Env, tenant: Tenant): Promise<string[]> {
  const { results } = await env.DB.prepare("SELECT discord_user_id FROM relay_tokens WHERE tenant_id = ?1 AND revoked_at IS NULL ORDER BY created_at")
    .bind(tenant.id)
    .all<{ discord_user_id: string }>();
  return results.map((r) => r.discord_user_id);
}

// ---------------------------------------------------------------- HTTP

export async function relay(request: Request, env: Env, now = Math.floor(Date.now() / 1000)): Promise<Response> {
  const { pathname } = new URL(request.url);
  const wantsPack = pathname === "/relay/pack";
  const wantsCode = pathname === "/relay/code";
  if (!wantsPack && !wantsCode) return new Response("Not found", { status: 404 });
  if (request.method !== (wantsPack ? "GET" : "POST")) return new Response("Method not allowed", { status: 405 });

  // 1. Allowlist first, from the guild id in the token. No database work before this.
  const token = (request.headers.get("Authorization") ?? "").match(/^Bearer ([0-9]{17,20})\.([A-Za-z0-9_-]{20,80})$/);
  if (!token) return error(401, "TOKEN", "Missing or malformed relay token. Run /bl relay in Discord to get one.");
  const guildId = token[1]!;
  if (!isAllowedGuild(env, guildId)) return error(403, "PRIVATE", "This Bounty Board is private to its own Discord server.");
  if (!relayGuildLimiter.allow(guildId)) return error(429, "RATE", "Too many requests. Try again in a minute.");

  // 2. The token.
  const row = await env.DB.prepare("SELECT discord_user_id FROM relay_tokens WHERE tenant_id = ?1 AND token_hash = ?2 AND revoked_at IS NULL")
    .bind(guildId, await sha256Hex(`${guildId}.${token[2]}`))
    .first<{ discord_user_id: string }>();
  if (!row) return error(401, "TOKEN", "That relay token isn't valid any more. Run /bl relay in Discord to get a new one.");
  const tenant = await getTenant(env.DB, guildId);
  if (!tenant) return error(409, "SETUP", "This server isn't set up yet.");

  try {
    return wantsPack ? await pack(request, env, tenant, now) : await code(request, env, tenant, row.discord_user_id, now);
  } catch (e) {
    log(env, "error", "relay.failed", { tenant_id: guildId, error: String(e) });
    return error(500, "INTERNAL", "Something went wrong on the Bounty Board. Try again in a minute.");
  }
}

/** The pack, with an ETag that only changes when the bounties do (a pack's own version is its build time). */
async function pack(request: Request, env: Env, tenant: Tenant, now: number): Promise<Response> {
  const { codes, count } = await buildPack(env, tenant, now);
  const stable = await buildPack(env, tenant, now, 0);
  const etag = `"${(await sha256Hex(stable.codes.join("\n"))).slice(0, 24)}"`;
  // Cloudflare may hand the client a weak ETag (W/"...") when it compresses the reply, so
  // compare without that prefix. The same value is in the body, for clients to compare directly.
  const theirs = (request.headers.get("If-None-Match") ?? "").replace(/^W\//, "");
  if (theirs === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(JSON.stringify({ ok: true, version: now, count, codes, etag }), {
    headers: { "Content-Type": "application/json", ETag: etag, "Cache-Control": "no-store" },
  });
}

/**
 * A bounty code relayed from the game. The bounty belongs to whoever the poster's character
 * is linked to (/bl link): the relay's owner only carried it. Two checks stop a guildie
 * forging a bounty in someone else's name: the relay's addon only forwards codes whose poster
 * name is the sender's (the game vouches for the sender), and here the name in the code must
 * be the linked character's name.
 */
async function code(request: Request, env: Env, tenant: Tenant, relayUser: string, now: number): Promise<Response> {
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return error(413, "PAYLOAD", "That request is too large.");
  let raw: unknown;
  try {
    raw = (JSON.parse(body) as { code?: unknown }).code;
  } catch {
    raw = undefined;
  }
  if (typeof raw !== "string") return error(400, "PAYLOAD", 'Send JSON like {"code":"BL1-B-..."}.');
  if (!relayCodeLimiter.allow(`${tenant.id}:${relayUser}`)) return error(429, "RATE", "Too many codes. Try again in a minute.");

  const r = decode(raw);
  if (!r.ok || r.type !== "B") return error(400, "TYPE", "The relay only carries bounty codes. Kill claims need the hunter's screenshot.");
  const linked = await env.DB.prepare("SELECT name, discord_user_id FROM characters WHERE tenant_id = ?1 AND guid = ?2")
    .bind(tenant.id, r.fields.posterGUID)
    .first<{ name: string | null; discord_user_id: string }>();
  if (!linked || (linked.name ?? "") !== r.fields.posterName) {
    // The poster can't see why nothing appeared (the relay can't talk to the game), so say it
    // where they will look next. Names only: there is no Discord user to mention yet.
    if (tenant.bounty_line_ch && relayNoticeLimiter.allow(`${tenant.id}:${r.fields.posterGUID}`)) {
      await new DiscordRest(env.DISCORD_TOKEN)
        .sendMessage(
          tenant.bounty_line_ch,
          `🔗 **${escapeMd(r.fields.posterName || "A guildie")}**: your bounty on **${escapeMd(r.fields.targetName)}** reached the relay, but your character isn't linked to your Discord yet. In game, type \`/bl link\` and paste that code here once; then paste the bounty code. After that the relay posts your bounties for you.`,
        )
        .catch(() => undefined);
    }
    return error(409, "UNLINKED", "The poster's character isn't linked to a Discord user yet. They need to run /bl link in game once and paste that code.");
  }

  const outcome = await processCode(env, new DiscordRest(env.DISCORD_TOKEN), tenant, r.code, linked.discord_user_id, now);
  if (outcome.ok === null) return error(400, "TYPE", "The relay only carries bounty codes.");
  if (outcome.ok) await audit(env.DB, tenant.id, relayUser, "relay.post", { bounty: outcome.bountyId, for: linked.discord_user_id }, now);
  log(env, "info", "relay.code", { tenant_id: tenant.id, outcome: outcome.ok ? "ok" : outcome.code });
  return outcome.ok
    ? json({ ok: true, bountyId: outcome.bountyId ?? null })
    : json({ ok: false, code: outcome.code, message: outcome.message }, outcome.code === "INTERNAL" ? 500 : 422);
}
