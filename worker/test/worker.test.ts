import { beforeAll, describe, expect, it } from "vitest";
import { COMMANDS } from "../src/commands";
import { isAllowedGuild, Permission } from "../src/discord";
import type { Env } from "../src/env";
import worker from "../src/index";
import { VERSION } from "../src/interactions";
import { DEFAULT_CONFIG, newBoardTag } from "../src/tenants";
import { forbiddenDb, TestD1 } from "./helpers/d1";

const GUILD_A = "111111111111111111";
const GUILD_B = "222222222222222222";
const STRANGER = "999999999999999999";
const ADMIN = String(Permission.MANAGE_GUILD);
const MEMBER = "0";
const ids = { line: "300000000000000001", forum: "300000000000000002", role: "300000000000000003" };

let keys: CryptoKeyPair;
let publicKeyHex: string;
beforeAll(async () => {
  keys = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
  publicKeyHex = Buffer.from(await crypto.subtle.exportKey("raw", keys.publicKey)).toString("hex");
});

function makeEnv(db: D1Database, overrides: Partial<Env> = {}): Env {
  return {
    DB: db,
    PROOFS: {} as R2Bucket,
    ALLOWED_GUILD_IDS: `${GUILD_A}, ${GUILD_B}`,
    DISCORD_PUBLIC_KEY: publicKeyHex,
    DISCORD_APP_ID: "400000000000000000",
    DISCORD_TOKEN: "test-token",
    LOG_LEVEL: "error",
    ...overrides,
  };
}

async function signedRequest(body: unknown, opts: { tamper?: boolean; noSig?: boolean; path?: string } = {}): Promise<Request> {
  const text = JSON.stringify(body);
  const ts = String(Math.floor(Date.now() / 1000));
  const sig = Buffer.from(await crypto.subtle.sign("Ed25519", keys.privateKey, new TextEncoder().encode(ts + text))).toString("hex");
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (!opts.noSig) {
    headers["X-Signature-Ed25519"] = opts.tamper ? sig.replace(/^./, (c: string) => (c === "0" ? "1" : "0")) : sig;
    headers["X-Signature-Timestamp"] = ts;
  }
  return new Request(`https://bounty.test${opts.path ?? "/interactions"}`, { method: "POST", headers, body: text });
}

const command = (guildId: string | undefined, sub: string, options: { name: string; type: number; value: string }[] = [], permissions = ADMIN) => ({
  id: "1",
  type: 2,
  token: "t",
  ...(guildId ? { guild_id: guildId } : {}),
  member: { user: { id: "500000000000000001" }, permissions },
  data: { name: "bl", options: [{ name: sub, type: 1, options }] },
});

const setupOptions = (wowGuild = "Knights of the Long Night", displayName?: string) => [
  { name: "bounty_line", type: 7, value: ids.line },
  { name: "bounty_board", type: 7, value: ids.forum },
  { name: "officer_role", type: 8, value: ids.role },
  { name: "wow_guild", type: 3, value: wowGuild },
  ...(displayName ? [{ name: "display_name", type: 3, value: displayName }] : []),
];

async function call(env: Env, body: unknown, opts?: Parameters<typeof signedRequest>[1]) {
  const res = await worker.fetch(await signedRequest(body, opts), env);
  const text = await res.text();
  let parsed: { type?: number; data?: { content?: string; flags?: number } } = {};
  try {
    parsed = JSON.parse(text);
  } catch {
    // non-JSON error bodies
  }
  return { status: res.status, body: parsed, content: parsed.data?.content ?? "" };
}

describe("signature verification", () => {
  it("answers Discord's PING with PONG", async () => {
    const r = await call(makeEnv(TestD1.migrated().asD1()), { type: 1 });
    expect(r).toMatchObject({ status: 200, body: { type: 1 } });
  });
  it("rejects a tampered signature with 401", async () => {
    expect((await call(makeEnv(forbiddenDb()), { type: 1 }, { tamper: true })).status).toBe(401);
  });
  it("rejects a missing signature with 401", async () => {
    expect((await call(makeEnv(forbiddenDb()), { type: 1 }, { noSig: true })).status).toBe(401);
  });
  it("rejects a valid signature from a different key", async () => {
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const otherHex = Buffer.from(await crypto.subtle.exportKey("raw", other.publicKey)).toString("hex");
    expect((await call(makeEnv(forbiddenDb(), { DISCORD_PUBLIC_KEY: otherHex }), { type: 1 })).status).toBe(401);
  });
  it("rejects a command with a bad signature before touching the database", async () => {
    expect((await call(makeEnv(forbiddenDb()), command(GUILD_A, "status"), { tamper: true })).status).toBe(401);
  });
});

describe("allowlist (checked before any database work)", () => {
  it("refuses a server that isn't allowlisted without touching the database", async () => {
    const r = await call(makeEnv(forbiddenDb()), command(STRANGER, "setup", setupOptions()));
    expect(r.status).toBe(200);
    expect(r.content).toMatch(/private/);
    expect(r.body.data?.flags).toBe(64);
  });
  it("refuses DMs (no server) without touching the database", async () => {
    expect((await call(makeEnv(forbiddenDb()), command(undefined, "ping"))).content).toMatch(/private/);
  });
  it("fails closed when ALLOWED_GUILD_IDS is empty", async () => {
    expect((await call(makeEnv(forbiddenDb(), { ALLOWED_GUILD_IDS: "" }), command(GUILD_A, "ping"))).content).toMatch(/private/);
  });
  it("matches whole IDs only", () => {
    const env = { ALLOWED_GUILD_IDS: `${GUILD_A},${GUILD_B}` };
    expect(isAllowedGuild(env, GUILD_A)).toBe(true);
    expect(isAllowedGuild(env, GUILD_A.slice(1))).toBe(false);
    expect(isAllowedGuild(env, `${GUILD_A},${GUILD_B}`)).toBe(false);
    expect(isAllowedGuild(env, "")).toBe(false);
  });
});

describe("/bl ping and /bl version", () => {
  it("ping replies ephemerally without touching the database", async () => {
    const r = await call(makeEnv(forbiddenDb()), command(GUILD_A, "ping", [], MEMBER));
    expect(r.content).toContain("Pong");
    expect(r.body.data?.flags).toBe(64);
  });
  it("version shows the Worker version and code format", async () => {
    expect((await call(makeEnv(forbiddenDb()), command(GUILD_A, "version", [], MEMBER))).content).toContain(`v${VERSION}`);
    expect((await call(makeEnv(forbiddenDb()), command(GUILD_A, "version", [], MEMBER))).content).toContain("BL1");
  });
});

describe("/bl setup", () => {
  it("is admin-only", async () => {
    const db = TestD1.migrated();
    const r = await call(makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions(), MEMBER));
    expect(r.content).toMatch(/Only server admins/);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
  });

  it("stores the tenant, issues a board tag and writes an audit entry", async () => {
    const db = TestD1.migrated();
    const r = await call(makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions()));
    const row = db.sqlite.prepare("SELECT * FROM tenants WHERE id = ?").get(GUILD_A) as Record<string, string>;
    expect(row.board_tag).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(row.board_tag).not.toBe("0000");
    expect(row).toMatchObject({ bounty_line_ch: ids.line, bounty_board_forum: ids.forum, officer_role_id: ids.role, wow_guild_name: "Knights of the Long Night" });
    expect(JSON.parse(row.config_json!)).toEqual({ discord_display_name: "Knights of the Long Night" });
    expect(r.content).toContain(`Board tag: **${row.board_tag}**`);
    expect(r.content).toContain("set up");
    expect(db.sqlite.prepare("SELECT action FROM audit_log WHERE tenant_id = ?").all(GUILD_A)).toEqual([{ action: "setup.create" }]);
  });

  it("is idempotent: re-running keeps the board tag and updates settings", async () => {
    const db = TestD1.migrated();
    const env = makeEnv(db.asD1());
    await call(env, command(GUILD_A, "setup", setupOptions()));
    const tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
    const r = await call(env, command(GUILD_A, "setup", setupOptions("New Name", "Night Watch")));
    const row = db.sqlite.prepare("SELECT * FROM tenants").get() as Record<string, string>;
    expect(row.board_tag).toBe(tag);
    expect(row.wow_guild_name).toBe("New Name");
    expect(JSON.parse(row.config_json!).discord_display_name).toBe("Night Watch");
    expect(r.content).toContain("updated");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 1 });
  });

  it("gives each server its own tag and keeps their data apart", async () => {
    const db = TestD1.migrated();
    const env = makeEnv(db.asD1());
    await call(env, command(GUILD_A, "setup", setupOptions("Guild A")));
    await call(env, command(GUILD_B, "setup", setupOptions("Guild B")));
    const rows = db.sqlite.prepare("SELECT id, board_tag, wow_guild_name FROM tenants ORDER BY id").all() as { board_tag: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.board_tag).not.toBe(rows[1]!.board_tag);
    db.sqlite.prepare("INSERT INTO bounties (tenant_id, target_guid, reward_gold, status) VALUES (?, 'Player-1-00000001', 5, 'open')").run(GUILD_A);
    const a = await call(env, command(GUILD_A, "status"));
    const b = await call(env, command(GUILD_B, "status"));
    expect(a.content).toContain("Open bounties: **1**");
    expect(b.content).toContain("Open bounties: **0**");
    expect(b.content).toContain("Guild B");
  });

  it("draws a new tag when the random one is already taken", async () => {
    const db = TestD1.migrated();
    // Fill every tag but one would be slow; instead force the first draw to collide.
    db.sqlite.prepare("INSERT INTO tenants (id, board_tag, created_at) VALUES ('x', 'AAAA', 0)").run();
    const real = crypto.getRandomValues.bind(crypto);
    let first = true;
    crypto.getRandomValues = ((arr: Uint8Array) => {
      if (first && arr instanceof Uint8Array && arr.length === 4) {
        first = false;
        arr.set([10, 10, 10, 10]); // "AAAA"
        return arr;
      }
      return real(arr as never);
    }) as unknown as typeof crypto.getRandomValues;
    try {
      await call(makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions()));
    } finally {
      crypto.getRandomValues = real;
    }
    const row = db.sqlite.prepare("SELECT board_tag FROM tenants WHERE id = ?").get(GUILD_A) as { board_tag: string };
    expect(row.board_tag).not.toBe("AAAA");
  });

  it("rejects malformed options", async () => {
    const db = TestD1.migrated();
    const bad = setupOptions().map((o) => (o.name === "bounty_line" ? { ...o, value: "not-a-snowflake" } : o));
    expect((await call(makeEnv(db.asD1()), command(GUILD_A, "setup", bad))).content).toMatch(/Setup needs/);
  });
});

describe("/bl status", () => {
  it("is admin-only", async () => {
    expect((await call(makeEnv(forbiddenDb()), command(GUILD_A, "status", [], MEMBER))).content).toMatch(/Only server admins/);
  });
  it("asks for setup first", async () => {
    expect((await call(makeEnv(TestD1.migrated().asD1()), command(GUILD_A, "status"))).content).toMatch(/Run `\/bl setup`/);
  });
  it("reports budget mode and AI settings", async () => {
    const db = TestD1.migrated();
    const env = makeEnv(db.asD1(), { READ_CHAT: "false", AI_CHECK: "false" });
    await call(env, command(GUILD_A, "setup", setupOptions()));
    const r = await call(env, command(GUILD_A, "status"));
    expect(r.content).toContain("budget mode");
    expect(r.content).toContain("AI checks: off");
  });
});

describe("errors", () => {
  it("turns a database failure into a friendly reply", async () => {
    const broken = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("D1 down")) }) }) } as unknown as D1Database;
    const r = await call(makeEnv(broken), command(GUILD_A, "status"));
    expect(r.status).toBe(200);
    expect(r.content).toMatch(/Something went wrong/);
  });
  it("rejects oversized bodies", async () => {
    const res = await worker.fetch(
      new Request("https://bounty.test/interactions", { method: "POST", body: "x".repeat(70 * 1024) }),
      makeEnv(forbiddenDb()),
    );
    expect(res.status).toBe(413);
  });
  it("rejects malformed JSON", async () => {
    const res = await worker.fetch(new Request("https://bounty.test/interactions", { method: "POST", body: "{nope" }), makeEnv(forbiddenDb()));
    expect(res.status).toBe(400);
  });
  it("404s unknown paths and 405s wrong methods", async () => {
    const env = makeEnv(forbiddenDb());
    expect((await worker.fetch(new Request("https://bounty.test/nope"), env)).status).toBe(404);
    expect((await worker.fetch(new Request("https://bounty.test/interactions"), env)).status).toBe(405);
  });
});

describe("/health", () => {
  it("reports version and db ok", async () => {
    const res = await worker.fetch(new Request("https://bounty.test/health"), makeEnv(TestD1.migrated().asD1()));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: VERSION, gateway: "disabled", db: "ok" });
  });
  it("reports db error with 503", async () => {
    const broken = { prepare: () => ({ first: () => Promise.reject(new Error("down")) }) } as unknown as D1Database;
    const res = await worker.fetch(new Request("https://bounty.test/health"), makeEnv(broken));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ db: "error" });
  });
});

describe("command definitions", () => {
  it("fit Discord's limits", () => {
    const walk = (opts: readonly { name: string; description: string; options?: readonly unknown[] }[]) => {
      for (const o of opts) {
        expect(o.name).toMatch(/^[a-z0-9_-]{1,32}$/);
        expect(o.description.length).toBeGreaterThan(0);
        expect(o.description.length).toBeLessThanOrEqual(100);
        if (o.options) walk(o.options as typeof opts);
      }
    };
    walk(COMMANDS);
  });
});

describe("board tags and defaults", () => {
  it("are 4 Crockford characters and never 0000", () => {
    for (let i = 0; i < 500; i++) expect(newBoardTag()).toMatch(/^(?!0000)[0-9A-HJKMNP-TV-Z]{4}$/);
  });
  it("default rewards are 1g to 10,000g", () => {
    expect([DEFAULT_CONFIG.reward_min, DEFAULT_CONFIG.reward_max]).toEqual([1, 10000]);
  });
});
