/**
 * Bounty Board Worker entry point.
 *
 * Order on every inbound Discord event (Compendium 01 Section 3.4):
 *   allowlist check -> signature check -> work.
 * Nothing that touches D1, R2 or Workers AI runs before the allowlist check.
 */
import { InteractionType, ResponseType, isAllowedGuild, json, reply, verifySignature, type Interaction } from "./discord";
import type { Env } from "./env";
import { runCommand, VERSION } from "./interactions";
import { log } from "./log";

const MAX_BODY_BYTES = 64 * 1024;

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/health") {
      if (request.method !== "GET") return new Response("Method not allowed", { status: 405 });
      return health(env);
    }
    if (pathname === "/interactions") {
      if (request.method !== "POST") return new Response("Method not allowed", { status: 405 });
      return interactions(request, env);
    }
    return new Response("Not found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;

async function health(env: Env): Promise<Response> {
  let db = "ok";
  try {
    await env.DB.prepare("SELECT 1").first();
  } catch {
    db = "error";
  }
  return json({ version: VERSION, gateway: "disabled", db }, db === "ok" ? 200 : 503);
}

async function interactions(request: Request, env: Env): Promise<Response> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });
  const body = await request.text();
  if (body.length > MAX_BODY_BYTES) return new Response("Payload too large", { status: 413 });

  let interaction: Interaction;
  try {
    interaction = JSON.parse(body) as Interaction;
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
    try {
      return json(await runCommand(interaction, env));
    } catch (e) {
      log(env, "error", "command.failed", { tenant_id: interaction.guild_id, command: interaction.data.options?.[0]?.name, error: String(e) });
      return json(reply("Something went wrong on the Bounty Board. Try again in a minute."));
    }
  }
  return json(reply("That interaction isn't supported yet."));
}
