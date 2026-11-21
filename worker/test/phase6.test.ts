import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { compareStamp, parseStamp } from "../src/ai";
import { onDispatch, type ChatDeps } from "../src/chat";
import { encode, type BountyPost, type KillClaim } from "../src/codec";
import type { Env } from "../src/env";
import { codeLimiter } from "../src/ratelimit";
import { DiscordRest } from "../src/rest";
import { expirySweep, weeklyRecap } from "../src/stats";
import { TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

const NOW = 1795200000;
const TARGET = "Player-4395-0A1B2C3D";
const HUNTER = "Player-4395-01234567";
const HUNTER_USER = "700000000000000777";
const POSTER_USER = "700000000000000001";
const OFFICER = "500000000000000009";
const SHOT = "https://cdn.discordapp.com/attachments/1/2/shot.png";

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let seq = 0;
let bountyId: number;
let threadId: string;
let shotSeq = 0;
let aiReply: unknown;
let aiCalls = 0;

const bounty = (f: Partial<BountyPost> = {}): BountyPost => ({
  schema: 1, boardTag: tag, targetGUID: TARGET, targetName: "Grimlok Ashveil", targetClassID: 1, targetRaceID: 2, targetLevel: 42,
  targetFaction: 2, posterFaction: 1, rewardGold: 500, posterGUID: "Player-4395-00FFEE11", posterName: "Slac Jaw", mapID: 1437,
  createdAt: NOW - 3600, nonce: 1, note: "", mode: 0, existingBountyId: 0, ...f,
});
const kill = (f: Partial<KillClaim> = {}) =>
  encode("K", {
    schema: 1, boardTag: tag, bountyId, victimGUID: TARGET, killerGUID: HUNTER, killerName: "Hunter McHunterface",
    killerFaction: 1, killedAt: NOW - 360, mapID: 1437, flags: 1, nonce: ++seq, ...f,
  });
/** A fresh screenshot each time (duplicate screenshots are refused). */
const shot = () => {
  const url = `${SHOT}?${++shotSeq}`;
  discord.images.set(url, new Uint8Array([0x89, 0x50, 0x4e, 0x47, shotSeq]));
  return { url, filename: "shot.png", content_type: "image/png", size: 5 };
};
const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: () => undefined });
const say = (content: string, attachments: unknown[] = [], author = `7000000000000000${String(++seq).padStart(2, "0")}`) =>
  onDispatch(deps(), "MESSAGE_CREATE", {
    id: `6000000000000000${String(++seq).padStart(2, "0")}`, channel_id: ids.line, guild_id: GUILD_A, content, attachments, author: { id: author },
  });
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content));
const lastKill = () => db.sqlite.prepare("SELECT * FROM kills ORDER BY id DESC").get() as Record<string, unknown>;
const status = (id = bountyId) => (db.sqlite.prepare("SELECT status FROM bounties WHERE id = ?").get(id) as { status: string }).status;
const setConfig = (key: string, value: unknown) =>
  db.sqlite.prepare("UPDATE tenants SET config_json = json_set(config_json, ?, json(?))").run(`$.${key}`, JSON.stringify(value));
const proofPost = () => discord.find("POST", new RegExp(`/channels/${threadId}/messages$`)).find((c) => c.files)!;
const button = (customId: string, user: string, roles: string[] = []) => ({
  type: 3, id: "1", token: "tok", guild_id: GUILD_A, application_id: "400000000000000000",
  member: { user: { id: user }, permissions: "0", roles }, data: { custom_id: customId, component_type: 2 },
});
/** The AI "reads" whatever the current claim's code is. */
const stampMatches = (code: string) => {
  aiReply = { response: `Here you go: {"found": true, "code": "${code}", "target": "Grimlok Ashveil", "bountyId": ${bountyId}}` };
};

beforeEach(async () => {
  codeLimiter.clear();
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  aiCalls = 0;
  aiReply = { response: '{"found": false}' };
  env = await makeEnv(db.asD1(), {
    AI: { run: async () => (aiCalls++, aiReply) } as unknown as Ai,
    AI_DAILY_CAP: "50",
  });
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
  await say(encode("B", bounty()), [], POSTER_USER);
  const row = db.sqlite.prepare("SELECT id, thread_id FROM bounties").get() as { id: number; thread_id: string };
  bountyId = row.id;
  threadId = row.thread_id;
  discord.calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("reading the stamp", () => {
  it("parses the model's JSON even with chatter around it", () => {
    expect(parseStamp('Sure! {"found": true, "code": "BL1-K-AB", "target": "Grim", "bountyId": "7"} hope that helps')).toEqual({
      found: true, code: "BL1-K-AB", target: "Grim", bountyId: 7,
    });
    expect(parseStamp("no json here")).toBeNull();
  });
  it("matches the exact code (normalised), or the same bounty number and target", () => {
    expect(compareStamp({ found: true, code: "bl1-k-abcd-0000" }, "BL1-K-ABCD-0000", 7, "Grim")).toBe("match");
    expect(compareStamp({ found: true, code: "BL1-K-ABXD-0000", bountyId: 7, target: "grim" }, "BL1-K-ABCD-0000", 7, "Grim")).toBe("match");
    expect(compareStamp({ found: true, code: "BL1-K-ZZZZ-0000", bountyId: 8, target: "Grim" }, "BL1-K-ABCD-0000", 7, "Grim")).toBe("mismatch");
    expect(compareStamp({ found: false }, "BL1-K-ABCD-0000", 7, "Grim")).toBe("unreadable");
  });
});

describe("verdicts", () => {
  it("a new hunter's clean claim still goes to officers (trusted_only)", async () => {
    const code = kill();
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("pending");
    expect(JSON.parse(String(lastKill().checks_json))).toMatchObject({ ai: "match", trusted: false });
    expect(JSON.stringify(proofPost().body)).toContain("AI read the stamp: matches the code");
    expect(status()).toBe("review");
  });

  it("a trusted hunter's clean claim is approved automatically, with a Deny button for officers", async () => {
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?, ?, 5, 5, 'trusted')").run(GUILD_A, HUNTER_USER);
    const code = kill();
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("auto");
    expect(status()).toBe("awaiting_payment");
    const body = proofPost().body as { embeds: { description: string }[]; components: { components: { custom_id: string }[] }[] };
    expect(body.embeds[0]!.description).toContain("AUTO-APPROVED");
    expect(body.components[0]!.components.map((c) => c.custom_id)).toEqual([`kill:deny:${lastKill().id}`]);
    const prompts = discord.find("POST", new RegExp(`/channels/${threadId}/messages$`)).filter((c) => String(c.body!.content ?? "").includes("Payment for bounty"));
    expect(prompts).toHaveLength(1);
    expect(replies().at(-1)).toContain("auto-approved");
  });

  it("all_clean approves any clean claim; a stamp mismatch never auto-approves", async () => {
    setConfig("auto_approve", "all_clean");
    const code = kill();
    aiReply = { response: '{"found": true, "code": "BL1-K-NOPE-0000", "target": "Someone Else", "bountyId": 99}' };
    await say(code, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("pending");
    expect(JSON.stringify(proofPost().body)).toContain("Doesn't match");

    db.sqlite.prepare("UPDATE bounties SET status = 'open'").run();
    db.sqlite.prepare("DELETE FROM kills").run();
    discord.calls = [];
    const code2 = kill();
    stampMatches(code2);
    await say(code2, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("auto");
  });

  it("auto_approve off: always officers", async () => {
    setConfig("auto_approve", "off");
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, trust) VALUES (?, ?, 'trusted')").run(GUILD_A, HUNTER_USER);
    const code = kill();
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("pending");
  });

  it("an officer can overturn an auto-approval until it's paid", async () => {
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?, ?, 5, 5, 'trusted')").run(GUILD_A, HUNTER_USER);
    const code = kill();
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    await call(env, button(`kill:deny:${lastKill().id}`, OFFICER, [ids.role]));
    expect(lastKill().verdict).toBe("denied");
    expect(status()).toBe("open");
    expect(db.sqlite.prepare("SELECT trust, streak FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ trust: "new", streak: 0 });
  });

  it("stops calling the AI at the daily cap, and the claim still works", async () => {
    env.AI_DAILY_CAP = "0";
    await say(kill(), [shot()], HUNTER_USER);
    expect(aiCalls).toBe(0);
    expect(lastKill().verdict).toBe("pending");
    expect(JSON.stringify(proofPost().body)).toContain("daily limit");
  });

  it("AI_CHECK=false skips it entirely", async () => {
    env.AI_CHECK = "false";
    await say(kill(), [shot()], HUNTER_USER);
    expect(aiCalls).toBe(0);
    expect(JSON.parse(String(lastKill().checks_json)).ai).toBe("skipped");
  });
});

describe("trust", () => {
  it("five approvals in a row make a hunter trusted; a denial resets it", async () => {
    for (let i = 0; i < 5; i++) {
      codeLimiter.clear(); // more than 5 pastes a minute otherwise
      db.sqlite.prepare("UPDATE bounties SET status = 'open'").run();
      await say(kill(), [shot()], HUNTER_USER);
      await call(env, button(`kill:approve:${lastKill().id}`, OFFICER, [ids.role]));
    }
    expect(db.sqlite.prepare("SELECT approved, streak, trust FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({
      approved: 5, streak: 5, trust: "trusted",
    });
    codeLimiter.clear();
    db.sqlite.prepare("UPDATE bounties SET status = 'open'").run();
    await say(kill(), [shot()], HUNTER_USER);
    await call(env, button(`kill:deny:${lastKill().id}`, OFFICER, [ids.role]));
    expect(db.sqlite.prepare("SELECT streak, trust FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ streak: 0, trust: "new" });
  });
});

describe("/bl leaderboard, /bl me, /bl cancel", () => {
  it("leaderboard: public, never pings, lists hunters, most wanted and payers", async () => {
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, gold_earned) VALUES (?, ?, 3, 1500)").run(GUILD_A, HUNTER_USER);
    const r = await call(env, command(GUILD_A, "leaderboard", [], "0"));
    expect(r.body.data?.flags).toBeUndefined();
    expect(r.content).toContain(`<@${HUNTER_USER}> · 1,500g earned · 3 kills`);
    expect(r.content).toContain("**Grimlok Ashveil** · 500g");
  });

  it("me: stats, trust progress and open bounties", async () => {
    await call(env, { ...command(GUILD_A, "me", [], "0"), member: { user: { id: POSTER_USER }, permissions: "0" } });
    const text = discord.followups().at(-1)!;
    expect(text).toContain("0/5 approved kills in a row");
    expect(text).toContain(`#${bountyId} Grimlok Ashveil · 500g`);
  });

  it("cancel: the poster or an officer only, and only while open", async () => {
    const as = (user: string, roles: string[] = []) => ({
      ...command(GUILD_A, "cancel", [{ name: "id", type: 4, value: String(bountyId) }], "0"),
      member: { user: { id: user }, permissions: "0", roles },
    });
    await call(env, as("700000000000000999"));
    expect(discord.followups().at(-1)).toContain("Only the poster or an officer");
    expect(status()).toBe("open");
    await call(env, as(POSTER_USER));
    expect(status()).toBe("cancelled");
    expect(discord.followups().at(-1)).toContain("is cancelled");
    await call(env, as(OFFICER, [ids.role]));
    expect(discord.followups().at(-1)).toContain("can't be cancelled now");
  });
});

describe("crons", () => {
  it("hourly: expired bounties move to Expired", async () => {
    db.sqlite.prepare("UPDATE bounties SET expires_at = ?").run(NOW - 1);
    expect(await expirySweep(env, new DiscordRest("t"), NOW)).toBe(1);
    expect(status()).toBe("expired");
    expect(await expirySweep(env, new DiscordRest("t"), NOW)).toBe(0);
  });

  it("weekly: recap with most wanted, top hunters and unpaid nudges", async () => {
    db.sqlite.prepare("INSERT INTO bounties (tenant_id, target_guid, target_name, reward_gold, poster_discord_id, expires_at, status) VALUES (?, 'g', 'Vexa', 200, ?, ?, 'awaiting_payment')")
      .run(GUILD_A, POSTER_USER, NOW + 9999);
    const unpaidId = (db.sqlite.prepare("SELECT MAX(id) AS id FROM bounties").get() as { id: number }).id;
    db.sqlite.prepare("INSERT INTO kills (tenant_id, bounty_id, killer_discord_id, verdict, claimed_at) VALUES (?, ?, ?, 'approved', ?)")
      .run(GUILD_A, unpaidId, HUNTER_USER, NOW - 3 * 86400);
    expect(await weeklyRecap(env, new DiscordRest("t"), NOW)).toBe(1);
    const text = replies().at(-1)!;
    expect(text).toContain("This week on the Bounty Board");
    expect(text).toContain("**Grimlok Ashveil** · 500g");
    expect(text).toContain(`<@${HUNTER_USER}> · 200g · 1 kills`);
    expect(text).toContain(`#${unpaidId} Vexa: <@${POSTER_USER}> → <@${HUNTER_USER}> 200g`);
  });

  it("weekly recap can be turned off", async () => {
    setConfig("weekly_recap", false);
    expect(await weeklyRecap(env, new DiscordRest("t"), NOW)).toBe(0);
  });
});
