import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, type ChatDeps } from "../src/chat";
import { decodePack, encode, type BountyPost } from "../src/codec";
import type { Env } from "../src/env";
import worker from "../src/index";
import { codeLimiter } from "../src/ratelimit";
import { relayCodeLimiter, relayGuildLimiter, relayNoticeLimiter } from "../src/relay";
import { DiscordRest } from "../src/rest";
import { TestD1 } from "./helpers/d1";
import { ADMIN, call, command, GUILD_A, ids, makeEnv, MEMBER, setupOptions, STRANGER, USER } from "./helpers/env";
import { FakeDiscord, fakeCtx } from "./helpers/fakes";

const NOW = 1795200000;
const POSTER = "Player-4395-00FFEE11";
const POSTER_USER = "700000000000000123";

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let token: string;

const bounty = (f: Partial<BountyPost> = {}): BountyPost => ({
  schema: 1, boardTag: tag, targetGUID: "Player-4395-0A1B2C3D", targetName: "Grimlok Ashveil", targetClassID: 1, targetRaceID: 2, targetLevel: 42,
  targetFaction: 2, posterFaction: 1, rewardGold: 500, posterGUID: POSTER, posterName: "Slac Jaw", mapID: 1437,
  createdAt: NOW - 60, nonce: 1, note: "", mode: 0, existingBountyId: 0, ...f,
});
const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: () => undefined });
const say = (content: string, author: string) =>
  onDispatch(deps(), "MESSAGE_CREATE", { id: "600000000000000001", channel_id: ids.line, guild_id: GUILD_A, content, attachments: [], author: { id: author } });
const linkPoster = (name = "Slac Jaw") =>
  say(encode("L", { schema: 1, boardTag: tag, charGUID: POSTER, charName: name, faction: 1, guildName: "Grief", createdAt: NOW, nonce: 3 }), POSTER_USER);

const http = async (path: string, init: { method?: string; token?: string | null; body?: unknown; headers?: Record<string, string> } = {}) => {
  const headers: Record<string, string> = { ...init.headers };
  const t = init.token === undefined ? token : init.token;
  if (t) headers.Authorization = `Bearer ${t}`;
  const res = await worker.fetch(
    new Request(`https://bounty.test${path}`, {
      method: init.method ?? "GET",
      headers,
      body: init.body === undefined ? undefined : typeof init.body === "string" ? init.body : JSON.stringify(init.body),
    }),
    env,
    fakeCtx().ctx,
  );
  const text = await res.text();
  return { status: res.status, etag: res.headers.get("ETag"), body: text.startsWith("{") ? (JSON.parse(text) as Record<string, unknown>) : null };
};
const postCode = (code: string, t?: string | null) => http("/relay/code", { method: "POST", body: { code }, token: t });
const relayCmd = (action: string, permissions = ADMIN) => call(env, command(GUILD_A, "relay", [{ name: "action", type: 3, value: action }], permissions));
const setupFrom = (text: string) => text.match(/`(BLR1\.[A-Za-z0-9_-]+\.\d{17,20}\.[A-Za-z0-9_-]+)`/)![1]!;
const tokenFrom = (text: string) => setupFrom(text).split(".").slice(2).join(".");
const bounties = () => db.sqlite.prepare("SELECT id, poster_discord_id, reward_gold FROM bounties ORDER BY id").all() as Record<string, unknown>[];

beforeEach(async () => {
  codeLimiter.clear();
  relayCodeLimiter.clear();
  relayGuildLimiter.clear();
  relayNoticeLimiter.clear();
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
  await relayCmd("enable");
  token = tokenFrom(discord.followups().at(-1)!);
});
afterEach(() => vi.unstubAllGlobals());

describe("/bl relay", () => {
  it("hands out one setup code holding this Worker's address and the token", async () => {
    const [prefix, address] = setupFrom(discord.followups().at(-1)!).split(".");
    expect(prefix).toBe("BLR1");
    expect(Buffer.from(address!, "base64url").toString()).toBe("https://bounty.test");
  });

  it("gives an officer a token, shown once, stored only as a hash", async () => {
    expect(token.startsWith(`${GUILD_A}.`)).toBe(true);
    const row = db.sqlite.prepare("SELECT * FROM relay_tokens").get() as Record<string, unknown>;
    expect(row).toMatchObject({ tenant_id: GUILD_A, discord_user_id: USER, revoked_at: null });
    expect(String(row.token_hash)).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(row)).not.toContain(token.split(".")[1]!);
  });

  it("is for officers and admins only", async () => {
    await relayCmd("enable", MEMBER);
    expect(discord.followups().at(-1)).toContain("Only officers and server admins");
    const officer = { ...command(GUILD_A, "relay", [{ name: "action", type: 3, value: "enable" }], MEMBER) };
    (officer.member as { roles?: string[] }).roles = [ids.role];
    await call(env, officer);
    expect(discord.followups().at(-1)).toContain("Your relay setup code");
  });

  it("a new token replaces the old one; revoke turns it off", async () => {
    const old = token;
    await relayCmd("enable");
    const fresh = tokenFrom(discord.followups().at(-1)!);
    expect(fresh).not.toBe(old);
    expect((await http("/relay/pack", { token: old })).status).toBe(401);
    expect((await http("/relay/pack", { token: fresh })).status).toBe(200);
    await relayCmd("status");
    expect(discord.followups().at(-1)).toContain(`<@${USER}>`);
    await relayCmd("revoke");
    expect((await http("/relay/pack", { token: fresh })).status).toBe(401);
    await relayCmd("status");
    expect(discord.followups().at(-1)).toContain("Nobody has a relay token");
  });
});

describe("relay endpoints: who gets in", () => {
  it("checks the allowlist before touching the database", async () => {
    const reads = vi.spyOn(env.DB, "prepare");
    const res = await http("/relay/pack", { token: `${STRANGER}.${"a".repeat(43)}` });
    expect(res.status).toBe(403);
    expect(reads).not.toHaveBeenCalled();
  });

  it("refuses missing, malformed and unknown tokens", async () => {
    expect((await http("/relay/pack", { token: null })).status).toBe(401);
    expect((await http("/relay/pack", { token: "nonsense" })).status).toBe(401);
    expect((await http("/relay/pack", { token: `${GUILD_A}.${"b".repeat(43)}` })).status).toBe(401);
  });

  it("limits requests per server before looking a token up", async () => {
    const bad = `${GUILD_A}.${"c".repeat(43)}`;
    for (let i = 0; i < 120; i++) relayGuildLimiter.allow(GUILD_A);
    const reads = vi.spyOn(env.DB, "prepare");
    expect((await http("/relay/pack", { token: bad })).status).toBe(429);
    expect(reads).not.toHaveBeenCalled();
  });

  it("only answers the right methods and paths", async () => {
    expect((await http("/relay/pack", { method: "POST", body: {} })).status).toBe(405);
    expect((await http("/relay/code")).status).toBe(405);
    expect((await http("/relay/other")).status).toBe(404);
  });
});

describe("GET /relay/pack", () => {
  it("returns the pack, and 304 until the bounties change", async () => {
    await linkPoster();
    await say(encode("B", bounty()), POSTER_USER);
    const first = await http("/relay/pack");
    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({ ok: true, count: 1 });
    const decoded = decodePack((first.body!.codes as string[]).join("\n"));
    expect(decoded.ok && decoded.fields.bounties.map((b) => b.targetName)).toEqual(["Grimlok Ashveil"]);

    expect((await http("/relay/pack", { headers: { "If-None-Match": first.etag! } })).status).toBe(304);
    await say(encode("B", bounty({ targetGUID: "Player-4395-0BADF00D", targetName: "Vexa Nightfall", nonce: 2 })), POSTER_USER);
    const second = await http("/relay/pack", { headers: { "If-None-Match": first.etag! } });
    expect(second.status).toBe(200);
    expect(second.body).toMatchObject({ count: 2 });
    expect(second.etag).not.toBe(first.etag);
  });
});

describe("POST /relay/code", () => {
  it("posts a guildie's bounty in the name of the Discord user their character is linked to", async () => {
    await linkPoster();
    const res = await postCode(encode("B", bounty()));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true, bountyId: 1 });
    expect(bounties()).toEqual([{ id: 1, poster_discord_id: POSTER_USER, reward_gold: 500 }]);
    expect(discord.find("POST", new RegExp(`/channels/${ids.forum}/threads`))).toHaveLength(1);
    const log = db.sqlite.prepare("SELECT actor, detail_json FROM audit_log WHERE action = 'relay.post'").get() as { actor: string; detail_json: string };
    expect(log.actor).toBe(USER);
    expect(JSON.parse(log.detail_json)).toMatchObject({ bounty: 1, for: POSTER_USER });
  });

  it("refuses a poster who hasn't linked their character", async () => {
    const res = await postCode(encode("B", bounty()));
    expect(res.status).toBe(409);
    expect(res.body).toMatchObject({ ok: false, code: "UNLINKED" });
    expect(bounties()).toEqual([]);
    // They're told in the channel, once: the relay can't answer them in game.
    const notices = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content)).filter((t) => t.includes("reached the relay"));
    expect(notices()).toHaveLength(1);
    expect(notices()[0]).toContain("**Slac Jaw**");
    await postCode(encode("B", bounty({ nonce: 2 })));
    expect(notices()).toHaveLength(1);
  });

  it("refuses a code that names someone else's character under another name", async () => {
    await linkPoster("Slac Jaw");
    const res = await postCode(encode("B", bounty({ posterName: "Evil Twin" })));
    expect(res.body).toMatchObject({ code: "UNLINKED" });
    expect(bounties()).toEqual([]);
  });

  it("passes the board's own refusals back", async () => {
    await linkPoster();
    await postCode(encode("B", bounty()));
    const again = await postCode(encode("B", bounty()));
    expect(again.status).toBe(422);
    expect(again.body).toMatchObject({ ok: false, code: "DUPLICATE" });
  });

  it("only carries bounty codes", async () => {
    const link = encode("L", { schema: 1, boardTag: tag, charGUID: POSTER, charName: "Slac Jaw", faction: 1, guildName: "Grief", createdAt: NOW, nonce: 3 });
    expect((await postCode(link)).body).toMatchObject({ code: "TYPE" });
    expect((await postCode("hello")).body).toMatchObject({ code: "TYPE" });
    expect((await http("/relay/code", { method: "POST", body: "not json" })).status).toBe(400);
    expect((await http("/relay/code", { method: "POST", body: { code: "x".repeat(9000) } })).status).toBe(413);
  });

  it("limits codes per relay", async () => {
    await linkPoster();
    for (let i = 0; i < 20; i++) relayCodeLimiter.allow(`${GUILD_A}:${USER}`);
    expect((await postCode(encode("B", bounty()))).status).toBe(429);
  });
});
