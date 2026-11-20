/**
 * Bounty Board Worker entry point.
 *
 * Order on every inbound Discord event (Compendium 01 Section 3.4):
 *   allowlist check -> signature check -> rate limit -> work.
 * Nothing that touches D1, R2 or Workers AI runs before the allowlist check.
 */
import { EPHEMERAL, InteractionType, ResponseType, isAllowedGuild, json, reply, verifySignature, type Interaction } from "./discord";
import type { Env } from "./env";
import { ensureGateway, gatewayState } from "./gateway";
import { runCommand } from "./interactions";
import { log } from "./log";
import { DiscordRest } from "./rest";
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
    return new Response("Not found", { status: 404 });
  },

  /** Every minute: keep the Gateway connected (spec 7.2). Budget mode never starts it. */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      ensureGateway(env).catch((e) => {
        log(env, "error", "cron.gateway_failed", { error: String(e) });
      }),
    );
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
      const result = await runCommand(interaction, env, rest);
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
  return json(reply("That interaction isn't supported yet."));
}
