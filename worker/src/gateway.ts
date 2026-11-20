/**
 * GatewayDO: the Durable Object holding the bot's Discord Gateway connection
 * (spec 7.2). One instance ("gateway") serves the whole deployment. The
 * per-minute cron calls /ensure, which reconnects if the socket dropped.
 */
import { onDispatch } from "./chat";
import type { Env } from "./env";
import { GatewayClient, type SocketLike } from "./gateway-client";
import { json } from "./discord";
import { log } from "./log";
import { DiscordRest } from "./rest";

export const GATEWAY_NAME = "gateway";

async function connectWebSocket(url: string): Promise<SocketLike> {
  // Workers open outbound WebSockets with an Upgrade request over https.
  const res = await fetch(url.replace(/^wss:/, "https:"), { headers: { Upgrade: "websocket" } });
  const ws = res.webSocket;
  if (!ws) throw new Error(`gateway upgrade failed: HTTP ${res.status}`);
  ws.accept();
  return ws as unknown as SocketLike;
}

export class GatewayDO {
  private readonly client: GatewayClient;

  constructor(
    private readonly ctx: DurableObjectState,
    private readonly env: Env,
  ) {
    const rest = new DiscordRest(env.DISCORD_TOKEN);
    const now = () => Math.floor(Date.now() / 1000);
    this.client = new GatewayClient({
      token: env.DISCORD_TOKEN,
      connect: connectWebSocket,
      storage: ctx.storage,
      now: () => Date.now(),
      random: Math.random,
      setTimer: (fn, ms) => setTimeout(fn, ms),
      clearTimer: (h) => clearTimeout(h as number),
      log: (level, event, fields) => log(env, level, event, fields),
      onDispatch: (type, data) =>
        onDispatch(
          {
            env,
            rest,
            now,
            later: (fn, ms) => {
              setTimeout(() => void fn().catch(() => undefined), ms);
            },
          },
          type,
          data,
        ),
    });
  }

  async fetch(request: Request): Promise<Response> {
    const { pathname } = new URL(request.url);
    if (pathname === "/ensure") {
      if (this.env.READ_CHAT === "false") return json({ state: "disabled" });
      await this.client.ensure();
      return json(this.client.status());
    }
    if (pathname === "/status") return json(this.env.READ_CHAT === "false" ? { state: "disabled" } : this.client.status());
    return new Response("Not found", { status: 404 });
  }
}

/** Gateway state for /health and /bl status, without starting a connection. */
export async function gatewayState(env: Env): Promise<string> {
  if (env.READ_CHAT === "false") return "disabled";
  try {
    const stub = env.GATEWAY.get(env.GATEWAY.idFromName(GATEWAY_NAME));
    const s = (await (await stub.fetch("https://gateway/status")).json()) as { state: string };
    return s.state === "connected" ? "connected" : s.state === "fatal" ? "error" : "reconnecting";
  } catch {
    return "unknown";
  }
}

export async function ensureGateway(env: Env): Promise<void> {
  if (env.READ_CHAT === "false") return;
  const stub = env.GATEWAY.get(env.GATEWAY.idFromName(GATEWAY_NAME));
  await stub.fetch("https://gateway/ensure");
}
