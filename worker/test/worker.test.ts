import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { decodePack } from "../src/codec";
import { COMMANDS } from "../src/commands";
import { isAllowedGuild } from "../src/discord";
import worker from "../src/index";
import { VERSION } from "../src/interactions";
import { DEFAULT_CONFIG, FORUM_TAGS, newBoardTag } from "../src/tenants";
import { forbiddenDb, TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, GUILD_B, ids, makeEnv, MEMBER, setupOptions, STRANGER } from "./helpers/env";
import { fakeCtx, FakeDiscord, fakeGateway } from "./helpers/fakes";

let discord: FakeDiscord;
beforeEach(() => {
  discord = new FakeDiscord().install();
});
afterEach(() => {
  vi.unstubAllGlobals();
});

const DEFERRED = 5;

describe("signature verification", () => {
  it("answers Discord's PING with PONG", async () => {
    expect(await call(await makeEnv(TestD1.migrated().asD1()), { type: 1 })).toMatchObject({ status: 200, body: { type: 1 } });
  });
  it("rejects a tampered signature with 401", async () => {
    expect((await call(await makeEnv(forbiddenDb()), { type: 1 }, { tamper: true })).status).toBe(401);
  });
  it("rejects a missing signature with 401", async () => {
    expect((await call(await makeEnv(forbiddenDb()), { type: 1 }, { noSig: true })).status).toBe(401);
  });
  it("rejects a valid signature from a different key", async () => {
    const other = (await crypto.subtle.generateKey({ name: "Ed25519" }, true, ["sign", "verify"])) as CryptoKeyPair;
    const otherHex = Buffer.from(await crypto.subtle.exportKey("raw", other.publicKey)).toString("hex");
    expect((await call(await makeEnv(forbiddenDb(), { DISCORD_PUBLIC_KEY: otherHex }), { type: 1 })).status).toBe(401);
  });
  it("rejects a command with a bad signature before touching the database", async () => {
    expect((await call(await makeEnv(forbiddenDb()), command(GUILD_A, "status"), { tamper: true })).status).toBe(401);
    expect(discord.calls).toEqual([]);
  });
});

describe("allowlist (checked before any database work)", () => {
  it("refuses a server that isn't allowlisted without touching the database or Discord", async () => {
    const r = await call(await makeEnv(forbiddenDb()), command(STRANGER, "setup", setupOptions()));
    expect(r.status).toBe(200);
    expect(r.content).toMatch(/private/);
    expect(r.body.data?.flags).toBe(64);
    expect(discord.calls).toEqual([]);
  });
  it("refuses /bl submit from a server that isn't allowlisted", async () => {
    const r = await call(await makeEnv(forbiddenDb()), command(STRANGER, "submit", [{ name: "code", type: 3, value: "BL1-B-00-0000" }]));
    expect(r.content).toMatch(/private/);
  });
  it("refuses DMs (no server)", async () => {
    expect((await call(await makeEnv(forbiddenDb()), command(undefined, "ping"))).content).toMatch(/private/);
  });
  it("fails closed when ALLOWED_GUILD_IDS is empty", async () => {
    expect((await call(await makeEnv(forbiddenDb(), { ALLOWED_GUILD_IDS: "" }), command(GUILD_A, "ping"))).content).toMatch(/private/);
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
    const r = await call(await makeEnv(forbiddenDb()), command(GUILD_A, "ping", [], MEMBER));
    expect(r.content).toContain("Pong");
    expect(r.body.data?.flags).toBe(64);
  });
  it("version shows the Worker version and code format", async () => {
    const r = await call(await makeEnv(forbiddenDb()), command(GUILD_A, "version", [], MEMBER));
    expect(r.content).toContain(`v${VERSION}`);
    expect(r.content).toContain("BL1");
  });
});

describe("/bl setup", () => {
  it("is admin-only and answers immediately", async () => {
    const db = TestD1.migrated();
    const r = await call(await makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions(), MEMBER));
    expect(r.content).toMatch(/Only server admins/);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 0 });
  });

  it("defers, stores the tenant, creates forum tags, pins the how-to and reports the board tag", async () => {
    const db = TestD1.migrated();
    const r = await call(await makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions()));
    expect(r.body).toEqual({ type: DEFERRED, data: { flags: 64 } });

    const row = db.sqlite.prepare("SELECT * FROM tenants WHERE id = ?").get(GUILD_A) as Record<string, string>;
    expect(row.board_tag).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}$/);
    expect(row).toMatchObject({ bounty_line_ch: ids.line, bounty_board_forum: ids.forum, officer_role_id: ids.role });
    const config = JSON.parse(row.config_json!);
    expect(Object.keys(config.forum_tags).sort()).toEqual(Object.keys(FORUM_TAGS).sort());
    expect(discord.forumTags.map((t) => t.name)).toEqual(Object.values(FORUM_TAGS));

    const [howto, pack] = discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`));
    expect(String(howto!.body!.content)).toContain(row.board_tag!);
    expect(discord.find("PUT", /\/messages\/pins\//)).toHaveLength(2); // how-to + Bounty Pack
    expect(config.howto_message_id).toBeTruthy();
    expect(config.pack_message_ids).toHaveLength(1);

    // The first, empty Bounty Pack, for /bl import in game.
    const packText = String(pack!.body!.content);
    expect(packText).toContain("0 open bounties");
    const decoded = decodePack(packText.match(/BL1-P-[0-9A-Z-]+/)![0]);
    expect(decoded.ok && decoded.fields).toMatchObject({ boardTag: row.board_tag, bounties: [] });

    const [followup] = discord.followups();
    expect(followup).toContain(`Board tag: **${row.board_tag}**`);
    expect(followup).toContain("Players can now paste");
    expect(db.sqlite.prepare("SELECT action FROM audit_log WHERE tenant_id = ?").all(GUILD_A)).toEqual([{ action: "setup.create" }]);
  });

  it("is idempotent: same tag, no duplicate forum tags or how-to posts", async () => {
    const db = TestD1.migrated();
    const env = await makeEnv(db.asD1());
    discord.forumTags = [{ id: "777", name: "Rivals" }]; // an admin's own tag survives
    await call(env, command(GUILD_A, "setup", setupOptions()));
    const tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
    await call(env, command(GUILD_A, "setup", setupOptions("New Name", "Night Watch")));

    const row = db.sqlite.prepare("SELECT * FROM tenants").get() as Record<string, string>;
    expect(row.board_tag).toBe(tag);
    expect(row.wow_guild_name).toBe("New Name");
    expect(JSON.parse(row.config_json!).discord_display_name).toBe("Night Watch");
    expect(discord.forumTags.map((t) => t.name)).toEqual(["Rivals", ...Object.values(FORUM_TAGS)]);
    expect(discord.find("PATCH", /^\/channels\/\d+$/)).toHaveLength(1); // tags created once
    expect(discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`))).toHaveLength(2); // how-to and pack posted once...
    expect(discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`))).toHaveLength(2); // ...then edited
    expect(discord.followups()[1]).toContain("updated");
  });

  it("explains missing Manage Channels instead of failing", async () => {
    const db = TestD1.migrated();
    discord.fail.forumPatch = 403;
    await call(await makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions()));
    const [followup] = discord.followups();
    expect(followup).toContain("Manage Channels");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM tenants").get()).toEqual({ n: 1 }); // settings still saved
  });

  it("explains a missing pin permission", async () => {
    discord.fail.pin = 403;
    await call(await makeEnv(TestD1.migrated().asD1()), command(GUILD_A, "setup", setupOptions()));
    expect(discord.followups()[0]).toContain("Pin Messages");
  });

  it("gives each server its own tag and keeps their data apart", async () => {
    const db = TestD1.migrated();
    const env = await makeEnv(db.asD1());
    await call(env, command(GUILD_A, "setup", setupOptions("Guild A")));
    await call(env, command(GUILD_B, "setup", setupOptions("Guild B")));
    const rows = db.sqlite.prepare("SELECT board_tag FROM tenants ORDER BY id").all() as { board_tag: string }[];
    expect(rows).toHaveLength(2);
    expect(rows[0]!.board_tag).not.toBe(rows[1]!.board_tag);
    db.sqlite.prepare("INSERT INTO bounties (tenant_id, target_guid, reward_gold, status) VALUES (?, 'Player-1-00000001', 5, 'open')").run(GUILD_A);
    expect((await call(env, command(GUILD_A, "status"))).content).toContain("Open bounties: **1**");
    const b = await call(env, command(GUILD_B, "status"));
    expect(b.content).toContain("Open bounties: **0**");
    expect(b.content).toContain("Guild B");
  });

  it("draws a new tag when the random one is already taken", async () => {
    const db = TestD1.migrated();
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
      await call(await makeEnv(db.asD1()), command(GUILD_A, "setup", setupOptions()));
    } finally {
      crypto.getRandomValues = real;
    }
    const row = db.sqlite.prepare("SELECT board_tag FROM tenants WHERE id = ?").get(GUILD_A) as { board_tag: string };
    expect(row.board_tag).not.toBe("AAAA");
  });

  it("rejects malformed options", async () => {
    const bad = setupOptions().map((o) => (o.name === "bounty_line" ? { ...o, value: "not-a-snowflake" } : o));
    expect((await call(await makeEnv(TestD1.migrated().asD1()), command(GUILD_A, "setup", bad))).content).toMatch(/Setup needs/);
  });
});

describe("/bl status", () => {
  it("is admin-only", async () => {
    expect((await call(await makeEnv(forbiddenDb()), command(GUILD_A, "status", [], MEMBER))).content).toMatch(/Only server admins/);
  });
  it("asks for setup first", async () => {
    expect((await call(await makeEnv(TestD1.migrated().asD1()), command(GUILD_A, "status"))).content).toMatch(/Run `\/bl setup`/);
  });
  it("shows the gateway state", async () => {
    const db = TestD1.migrated();
    const env = await makeEnv(db.asD1());
    await call(env, command(GUILD_A, "setup", setupOptions()));
    expect((await call(env, command(GUILD_A, "status"))).content).toContain("Chat reading: connected");
  });
  it("reports budget mode and AI settings", async () => {
    const db = TestD1.migrated();
    const env = await makeEnv(db.asD1(), { READ_CHAT: "false", AI_CHECK: "false" });
    await call(env, command(GUILD_A, "setup", setupOptions()));
    const r = await call(env, command(GUILD_A, "status"));
    expect(r.content).toContain("budget mode");
    expect(r.content).toContain("AI checks: off");
  });
});

describe("errors", () => {
  it("turns a database failure into a friendly reply", async () => {
    const broken = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("D1 down")) }) }) } as unknown as D1Database;
    const r = await call(await makeEnv(broken), command(GUILD_A, "status"));
    expect(r.status).toBe(200);
    expect(r.content).toMatch(/Something went wrong/);
  });
  it("turns a failure in deferred work into a friendly follow-up", async () => {
    const broken = { prepare: () => ({ bind: () => ({ first: () => Promise.reject(new Error("D1 down")) }) }) } as unknown as D1Database;
    await call(await makeEnv(broken), command(GUILD_A, "setup", setupOptions()));
    expect(discord.followups()[0]).toMatch(/Something went wrong/);
  });
  it("rejects oversized bodies and malformed JSON", async () => {
    const env = await makeEnv(forbiddenDb());
    const { ctx } = fakeCtx();
    const big = new Request("https://bounty.test/interactions", { method: "POST", body: "x".repeat(70 * 1024) });
    expect((await worker.fetch(big, env, ctx)).status).toBe(413);
    const bad = new Request("https://bounty.test/interactions", { method: "POST", body: "{nope" });
    expect((await worker.fetch(bad, env, ctx)).status).toBe(400);
  });
  it("404s unknown paths and 405s wrong methods", async () => {
    const env = await makeEnv(forbiddenDb());
    const { ctx } = fakeCtx();
    expect((await worker.fetch(new Request("https://bounty.test/nope"), env, ctx)).status).toBe(404);
    expect((await worker.fetch(new Request("https://bounty.test/interactions"), env, ctx)).status).toBe(405);
  });
});

describe("/health", () => {
  it("reports version, gateway and db", async () => {
    const { ctx } = fakeCtx();
    const res = await worker.fetch(new Request("https://bounty.test/health"), await makeEnv(TestD1.migrated().asD1()), ctx);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ version: VERSION, gateway: "connected", db: "ok" });
  });
  it("reports the gateway as disabled in budget mode", async () => {
    const { ctx } = fakeCtx();
    const res = await worker.fetch(new Request("https://bounty.test/health"), await makeEnv(TestD1.migrated().asD1(), { READ_CHAT: "false" }), ctx);
    expect(await res.json()).toMatchObject({ gateway: "disabled" });
  });
  it("reports db error with 503", async () => {
    const { ctx } = fakeCtx();
    const broken = { prepare: () => ({ first: () => Promise.reject(new Error("down")) }) } as unknown as D1Database;
    const res = await worker.fetch(new Request("https://bounty.test/health"), await makeEnv(broken), ctx);
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ db: "error" });
  });
});

describe("cron", () => {
  it("keeps the gateway connected", async () => {
    const gw = fakeGateway();
    const { ctx, settle } = fakeCtx();
    await worker.scheduled({} as ScheduledController, await makeEnv(forbiddenDb(), { GATEWAY: gw.ns }), ctx);
    await settle();
    expect(gw.calls).toEqual(["/ensure"]);
  });
  it("never starts the gateway in budget mode", async () => {
    const gw = fakeGateway();
    const { ctx, settle } = fakeCtx();
    await worker.scheduled({} as ScheduledController, await makeEnv(forbiddenDb(), { GATEWAY: gw.ns, READ_CHAT: "false" }), ctx);
    await settle();
    expect(gw.calls).toEqual([]);
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
