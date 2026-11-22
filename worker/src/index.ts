/**
 * Bounty Board Worker entry point.
 *
 * Order on every inbound Discord event (Compendium 01 Section 3.4):
 *   allowlist check -> signature check -> rate limit -> work.
 * Nothing that touches D1, R2 or Workers AI runs before the allowlist check.
 */
import { EPHEMERAL, InteractionType, ResponseType, hasAdmin, isAllowedGuild, json, reply, verifySignature, type Interaction } from "./discord";
import { reviewKill } from "./kills";
import { handlePayment } from "./payments";
import { handleSeasonPayout, reviewSeasonKill } from "./seasons";
import { relay } from "./relay";
import { getTenant } from "./tenants";
import type { Env } from "./env";
import { ensureGateway, gatewayState } from "./gateway";
import { runCommand } from "./interactions";
import { log } from "./log";
import { DiscordRest } from "./rest";
import { expirySweep, weeklyRecap } from "./stats";
import { VERSION } from "./version";

export { GatewayDO } from "./gateway";

const MAX_BODY_BYTES = 64 * 1024;
const DEFERRED_CHANNEL_MESSAGE = 5;

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return health(env);
    }
    if (pathname === "/interactions") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return interactions(request, env, ctx);
    }
    // The officers' relay program (spec 5.10). Allowlist and token checks are inside.
    if (pathname.startsWith("/relay/")) return relay(request, env);
    return new Response("Not found", { status: 404 });
  },

  /** Every minute: keep the Gateway connected (spec 7.2). Budget mode never starts it. */
  /**
   * Every minute: keep the Gateway connected (spec 7.2; budget mode never starts it).
   * Hourly: expire old bounties. Sundays 17:00 UTC: the weekly recap.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = Math.floor(controller.scheduledTime / 1000);
    const failed = (job: string) => (e: unknown) => log(env, "error", `cron.${job}_failed`, { error: String(e) });
    if (controller.cron === "0 * * * *") {
      ctx.waitUntil(expirySweep(env, new DiscordRest(env.DISCORD_TOKEN), now).catch(failed("expiry")));
    } else if (controller.cron === "0 17 * * SUN") {
      ctx.waitUntil(weeklyRecap(env, new DiscordRest(env.DISCORD_TOKEN), now).catch(failed("recap")));
    } else {
      ctx.waitUntil(ensureGateway(env).catch(failed("gateway")));
    }
  },
} satisfies ExportedHandler<Env>;

async function health(env: Env): Promise<Response> {
  let db = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  return json({ version: VERSION, gateway: await gatewayState(env), db }, db === "ok" ? 200 : 503);
}

async function interactions(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  let interaction: Interaction & { application_id?: string };
  try {
    interaction = JSON.parse(body);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  const verified = () =>
    verifySignature(env.DISCORD_PUBLIC_KEY, request.headers.get("X-Signature-Ed25519"), request.headers.get("X-Signature-Timestamp"), body);

  // 1. Allowlist first. Discord's PING has no server, so it goes straight to the signature check.
  if (interaction.type !== InteractionType.PING && !isAllowedGuild(env, interaction.guild_id)) {
    if (!(await verified())) return new Response("Invalid request signature", { status: 401 });
    log(env, "warn", "interaction.rejected", { tenant_id: interaction.guild_id ?? null, outcome: "not_allowlisted" });
    return json(reply("This Bounty Board is private to its own Discord server."));
  }

  // 2. Signature. Discord requires 401 for bad signatures.
  if (!(await verified())) return new Response("Invalid request signature", { status: 401 });

  if (interaction.type === InteractionType.PING) return json({ type: ResponseType.PONG });

  if (interaction.type === InteractionType.APPLICATION_COMMAND && interaction.data?.name === "bl") {
    const rest = new DiscordRest(env.DISCORD_TOKEN);
    const command = interaction.data.options?.[0]?.name;
    const failed = (e: unknown) => {
      log(env, "error", "command.failed", { tenant_id: interaction.guild_id, command, error: String(e) });
      return "Something went wrong on the Bounty Board. Try again in a minute.";
    };
    try {
      const result = await runCommand(interaction, env, rest, undefined, new URL(request.url).origin);
      if ("reply" in result) return json(result.reply);
      // Slow work: answer "thinking..." now (Discord allows 3s), then fill in the reply.
      const appId = interaction.application_id ?? env.DISCORD_APP_ID;
      ctx.waitUntil(
        result
          .defer()
          .catch(failed)
          .then((text) => rest.editInteractionReply(appId, interaction.token, text))
          .catch((e) => log(env, "error", "command.followup_failed", { tenant_id: interaction.guild_id, command, error: String(e) })),
      );
      return json({ type: DEFERRED_CHANNEL_MESSAGE, data: { flags: EPHEMERAL } });
    } catch (e) {
      return json(reply(failed(e)));
    }
  }
  if (interaction.type === InteractionType.MESSAGE_COMPONENT) return buttons(interaction, env, ctx);
  return json(reply("That interaction isn't supported yet."));
}

/** Approve / Deny on a kill claim's proof post. The work runs after a "deferred update". */
async function buttons(interaction: Interaction & { application_id?: string }, env: Env, ctx: ExecutionContext): Promise<Response> {
  const m = /^(kill|pay|skill|spay):(approve|deny|paid|received|close):(\d+)$/.exec(interaction.data?.custom_id ?? "");
  if (!m) return json(reply("That button isn't supported."));
  const tenant = await getTenant(env.DB, interaction.guild_id!);
  if (!tenant) return json(reply("This server isn't set up yet. An admin needs to run `/bl setup`."));
  const rest = new DiscordRest(env.DISCORD_TOKEN);
  const appId = interaction.application_id ?? env.DISCORD_APP_ID;
  const user = { id: interaction.member?.user?.id ?? "unknown", roles: interaction.member?.roles ?? [], isAdmin: hasAdmin(interaction) };
  const now = Math.floor(Date.now() / 1000);
  const review = m[2] === "approve" || m[2] === "deny";
  if (review !== (m[1] === "kill" || m[1] === "skill")) return json(reply("That button isn't supported."));
  const id = Number(m[3]);
  const work =
    m[1] === "kill"
      ? reviewKill(env, rest, tenant, m[2] as "approve" | "deny", id, user, now)
      : m[1] === "skill"
        ? reviewSeasonKill(env, rest, tenant, m[2] as "approve" | "deny", id, user, now)
        : m[1] === "spay"
          ? handleSeasonPayout(env, rest, tenant, m[2] as "paid" | "received" | "close", id, user, now)
          : handlePayment(env, rest, tenant, m[2] as "paid" | "received" | "close", id, user, now);
  ctx.waitUntil(
    work
      .then(async (r) => {
        if (r.ephemeral) return rest.followup(appId, interaction.token, r.ephemeral);
        await rest.editInteractionReply(appId, interaction.token, r.update!.content, { components: r.update!.components });
        await r.after?.();
      })
      .catch((e) => log(env, "error", "kill.review_failed", { tenant_id: interaction.guild_id, error: String(e) })),
  );
  return json({ type: ResponseType.DEFERRED_UPDATE_MESSAGE });
}
