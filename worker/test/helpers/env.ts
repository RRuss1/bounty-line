/** Shared test setup: signed interaction requests, a test Env, and command payloads. */
import { Permission } from "../../src/discord";
import type { Env } from "../../src/env";
import worker from "../../src/index";
import { fakeCtx, fakeGateway } from "./fakes";

export const GUILD_A = "111111111111111111";
export const GUILD_B = "222222222222222222";
export const STRANGER = "999999999999999999";
export const ADMIN = String(Permission.MANAGE_GUILD);
export const MEMBER = "0";
export const USER = "500000000000000001";
export const ids = { line: "300000000000000001", forum: "300000000000000002", role: "300000000000000003" };

let keys: CryptoKeyPair | null = null;
let publicKeyHex = "";

async function ensureKeys(): Promise<void> {
  if (keys) return;
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKeyHex = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
}

export async function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Promise<Env> {
  await ensureKeys();
  return {
    DB: db,
    PROOFS: {} as R2Bucket,
    GATEWAY: fakeGateway().ns,
    ALLOWED_GUILD_IDS: `${GUILD_A}, ${GUILD_B}`,
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_APP_ID: "400000000000000000",
    DISCORD_TOKEN: "test-token",
    LOG_LEVEL: "error",
    // Drawing posters takes ~150 ms; the poster tests turn it on.
    POSTER_IMAGE: "false",
    ...overrides,
  };
}

export async function signedRequest(body: unknown, opts: { tamper?: boolean; noSig?: boolean } = {}): Promise<Request> {
  await ensureKeys();
  const text = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = Buffer.from(await crypto.subtle.sign("Ed25519", keys!.privateKey, new TextEncoder().encode(ts + text))).toString("hex");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.noSig) {
    headers["X-Signature-Ed25519"] = opts.tamper ? sig.replace(/^./, (c: string) => (c === "0" ? "1" : "0")) : sig;
    headers["X-Signature-Timestamp"] = ts;
  }
  return new Request("https://bounty.test/interactions", { method: "POST", headers, body: text });
}

export const command = (
  guildId: string | undefined,
  sub: string,
  options: { name: string; type: number; value: string }[] = [],
  permissions = ADMIN,
) => ({
  id: "1",
  type: 2,
  token: "interaction-token",
  application_id: "400000000000000000",
  ...(guildId ? { guild_id: guildId } : {}),
  member: { user: { id: USER }, permissions },
  data: { name: "bl", options: [{ name: sub, type: 1, options }] },
});

export const setupOptions = (wowGuild = "Knights of the Long Night", displayName?: string) => [
  { name: "bounty_line", type: 7, value: ids.line },
  { name: "bounty_board", type: 7, value: ids.forum },
  { name: "officer_role", type: 8, value: ids.role },
  { name: "wow_guild", type: 3, value: wowGuild },
  ...(displayName ? [{ name: "display_name", type: 3, value: displayName }] : []),
];

/** Sends a signed interaction and waits for any deferred work to finish. */
export async function call(env: Env, body: unknown, opts?: Parameters<typeof signedRequest>[1]) {
  const { ctx, settle } = fakeCtx();
  const res = await worker.fetch(await signedRequest(body, opts), env, ctx);
  await settle();
  const text = await res.text();
  let parsed: { type?: number; data?: { content?: string; flags?: number } } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON error bodies
  }
  return { status: res.status, body: parsed, content: parsed.data?.content ?? "" };
}
