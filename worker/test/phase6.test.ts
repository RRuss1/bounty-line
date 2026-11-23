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
    expect(replies().filter((r) => r.includes("auto-approved"))).toEqual([]); // no chat reply on success
  });

  it("open world only: a kill outside the known zones goes to officers, even for a trusted hunter", async () => {
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?, ?, 5, 5, 'trusted')").run(GUILD_A, HUNTER_USER);
    const code = kill({ mapID: 1460 }); // not in the verified open-world table (a battleground on classic)
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    expect(lastKill().verdict).toBe("pending");
    expect(status()).toBe("review");
    expect(JSON.parse(String(lastKill().checks_json))).toMatchObject({ openWorld: false });
    const description = (proofPost().body as { embeds: { description: string }[] }).embeds[0]!.description;
    expect(description).toContain("Not a known open-world zone (map 1460)");
  });

  it("names the open-world zone on the proof post", async () => {
    const code = kill();
    stampMatches(code);
    await say(code, [shot()], HUNTER_USER);
    expect((proofPost().body as { embeds: { description: string }[] }).embeds[0]!.description).toContain("✅ Killed in Wetlands (open world)");
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
  /** A new bounty from poster #p on target #t, claimed by HUNTER_USER and judged by an officer. */
  const claimFrom = async (p: number, t: number, verdict: "approve" | "deny" = "approve") => {
    codeLimiter.clear(); // more than 5 pastes a minute otherwise
    const target = `Player-4395-0000AA${String(t).padStart(2, "0")}`;
    const posterUser = `7000000000000009${String(p).padStart(2, "0")}`;
    await say(encode("B", bounty({ targetGUID: target, targetName: `Target ${t}`, posterGUID: `Player-4395-0000BB${String(p).padStart(2, "0")}`, nonce: 500 + t })), [], posterUser);
    const id = (db.sqlite.prepare("SELECT MAX(id) AS id FROM bounties").get() as { id: number }).id;
    await say(kill({ bountyId: id, victimGUID: target }), [shot()], HUNTER_USER);
    await call(env, button(`kill:${verdict}:${lastKill().id}`, OFFICER, [ids.role]));
  };
  const hunterRow = () => db.sqlite.prepare("SELECT approved, streak, trust FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER);

  it("five approvals on five different posters' bounties make a hunter trusted; a denial resets it", async () => {
    for (let i = 0; i < 5; i++) await claimFrom(i, i);
    expect(hunterRow()).toEqual({ approved: 5, streak: 5, trust: "trusted" });
    await claimFrom(9, 9, "deny");
    expect(hunterRow()).toMatchObject({ streak: 0, trust: "new" });
  });

  it("kills on one poster's bounties count once toward trust (no farming off a friend's alt)", async () => {
    for (let t = 0; t < 5; t++) await claimFrom(1, t);
    expect(hunterRow()).toEqual({ approved: 5, streak: 1, trust: "new" });
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

// ---------------------------------------------------------------- Phase 6b

describe("stacking (Add to Bounty…)", () => {
  const STACKER = "700000000000000555";
  const stack = (f: Partial<BountyPost> = {}) =>
    encode("B", bounty({ mode: 1, existingBountyId: bountyId, rewardGold: 200, posterGUID: "Player-4395-0BADF00D", posterName: "Vexa Night", nonce: ++seq, ...f }));
  const contribs = () => db.sqlite.prepare("SELECT poster_discord_id, reward_gold, paid_at FROM contributions ORDER BY id").all();

  it("adds gold to the open bounty: total, contributors, renamed thread, redrawn poster", async () => {
    await say(stack(), [], STACKER);
    expect((db.sqlite.prepare("SELECT reward_gold FROM bounties WHERE id = ?").get(bountyId) as { reward_gold: number }).reward_gold).toBe(700);
    expect(contribs()).toEqual([
      { poster_discord_id: POSTER_USER, reward_gold: 500, paid_at: null },
      { poster_discord_id: STACKER, reward_gold: 200, paid_at: null },
    ]);
    expect(discord.find("PATCH", new RegExp(`^/channels/${threadId}$`)).map((c) => c.body)).toContainEqual({ name: "☠️ Grimlok Ashveil · 700g" });
    expect(JSON.stringify(discord.find("PATCH", new RegExp(`/channels/${threadId}/messages/${threadId}$`)).at(-1)!.body)).toContain("Slac Jaw +1");
    expect(replies().filter((r) => r.includes("added"))).toEqual([]); // no chat reply on success
  });

  it("a second plain bounty on the same target points at Add to Bounty", async () => {
    await say(encode("B", bounty({ nonce: ++seq })), [], STACKER);
    expect(replies().at(-1)).toContain("Add to Bounty");
  });

  it("refuses stacking when the board turns it off, a wrong target, or a closed bounty", async () => {
    setConfig("allow_stacking", false);
    await say(stack(), [], STACKER);
    expect(replies().at(-1)).toContain("doesn't allow adding gold");
    setConfig("allow_stacking", true);
    await say(stack({ targetGUID: "Player-4395-0B0B0B0B" }), [], STACKER);
    expect(replies().at(-1)).toContain("isn't for bounty #1");
    db.sqlite.prepare("UPDATE bounties SET status = 'paid'").run();
    await say(stack(), [], STACKER);
    expect(replies().at(-1)).toContain("no longer open");
    expect(contribs()).toHaveLength(1);
  });

  it("contributors can't claim it, and everyone who put gold in pays their share", async () => {
    await say(stack(), [], STACKER);
    await say(kill({ killerGUID: "Player-4395-0BADF00D" }), [shot()], STACKER);
    expect(replies().at(-1)).toContain("You can't claim your own bounty.");

    await say(kill(), [shot()], HUNTER_USER);
    const id = Number(lastKill().id);
    await call(env, button(`kill:approve:${id}`, OFFICER, [ids.role]));
    const prompt = discord.find("POST", new RegExp(`/channels/${threadId}/messages$`)).at(-1)!.body as { content: string; allowed_mentions: { users: string[] } };
    expect(prompt.content).toContain(`<@${POSTER_USER}> pays **500g**`);
    expect(prompt.content).toContain(`<@${STACKER}> pays **200g**`);
    expect(prompt.allowed_mentions.users.sort()).toEqual([HUNTER_USER, POSTER_USER, STACKER].sort());

    await call(env, button(`pay:paid:${id}`, POSTER_USER));
    await call(env, button(`pay:received:${id}`, HUNTER_USER));
    expect(status()).toBe("awaiting_payment"); // the stacker hasn't paid yet
    await call(env, button(`pay:paid:${id}`, STACKER));
    expect(status()).toBe("paid");
    expect(db.sqlite.prepare("SELECT gold_earned FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ gold_earned: 700 });
  });
});

describe("/bl hunters", () => {
  const HUNTER_ROLE = "300000000000000099";
  const member = (roles: string[]) => ({ ...command(GUILD_A, "hunters", [], "0"), member: { user: { id: "700000000000000555" }, permissions: "0", roles } });
  const roleCalls = () =>
    discord.calls.filter((c) => c.path.includes("/members/700000000000000555/roles/")).map((c) => `${c.method} ${c.path.split("/").pop()}`);
  const setRole = () =>
    db.sqlite.prepare("UPDATE tenants SET config_json = json_patch(config_json, ?)").run(JSON.stringify({ hunter_role: HUNTER_ROLE, hunter_ping_min_gold: 50 }));

  it("no hunter role set: says how to set one, touches no roles", async () => {
    await call(env, member([]));
    expect(discord.followups().at(-1)).toContain("There's no hunter role yet");
    expect(roleCalls()).toEqual([]);
  });

  it("gives the role to someone without it, and takes it from someone with it", async () => {
    setRole();
    await call(env, member([]));
    expect(roleCalls()).toEqual([`PUT ${HUNTER_ROLE}`]);
    expect(discord.followups().at(-1)).toContain("pinged on every new bounty of **50g** or more");
    discord.calls = [];
    await call(env, member([HUNTER_ROLE]));
    expect(roleCalls()).toEqual([`DELETE ${HUNTER_ROLE}`]);
    expect(discord.followups().at(-1)).toContain("no more pings");
  });

  it("without Manage Roles: says what the admin must fix", async () => {
    setRole();
    discord.fail.role = 403;
    await call(env, member([]));
    expect(discord.followups().at(-1)).toContain("Manage Roles");
  });
});

describe("/bl config", () => {
  const cfg = (options: { name: string; type: number; value: string }[], perms = String(1n << 5n)) => command(GUILD_A, "config", options, perms);

  it("admins only", async () => {
    const r = await call(env, cfg([], "0"));
    expect(r.content).toContain("Only server admins");
  });

  it("shows settings with no options, saves valid ones, and refreshes the pack when limits change", async () => {
    await call(env, cfg([]));
    expect(discord.followups().at(-1)).toContain("Rewards: 1g to 10,000g");
    discord.calls = [];
    await call(env, cfg([
      { name: "reward_max", type: 4, value: "5000" },
      { name: "auto_approve", type: 3, value: "all_clean" },
      { name: "allow_stacking", type: 5, value: "false" },
    ]));
    expect(discord.followups().at(-1)).toContain("Settings saved");
    const config = JSON.parse((db.sqlite.prepare("SELECT config_json FROM tenants").get() as { config_json: string }).config_json);
    expect(config).toMatchObject({ reward_max: 5000, auto_approve: "all_clean", allow_stacking: false });
    expect(discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).length).toBeGreaterThan(0); // pack updated
  });

  it("rejects bad values and saves nothing", async () => {
    await call(env, cfg([{ name: "reward_min", type: 4, value: "9000" }, { name: "reward_max", type: 4, value: "100" }]));
    expect(discord.followups().at(-1)).toContain("can't be above");
    expect(JSON.parse((db.sqlite.prepare("SELECT config_json FROM tenants").get() as { config_json: string }).config_json).reward_max).toBeUndefined();
  });
});

describe("/bl forget-me and proof cleanup", () => {
  it("needs confirm, then deletes links and stats, and anonymises closed bounties", async () => {
    db.sqlite.prepare("INSERT INTO characters (tenant_id, guid, name, discord_user_id) VALUES (?, ?, 'Hunter', ?)").run(GUILD_A, HUNTER, HUNTER_USER);
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved) VALUES (?, ?, 3)").run(GUILD_A, HUNTER_USER);
    await say(kill(), [shot()], HUNTER_USER);
    db.sqlite.prepare("UPDATE bounties SET status = 'paid'").run();
    const key = String(lastKill().image_r2_key);
    const r2 = (env.PROOFS as unknown as { objects: Map<string, unknown>; delete?: unknown }).objects;
    expect(r2.has(key)).toBe(true);

    const forget = (confirm: string) => ({
      ...command(GUILD_A, "forget-me", [{ name: "confirm", type: 5, value: confirm }], "0"),
      member: { user: { id: HUNTER_USER }, permissions: "0" },
    });
    expect((await call(env, forget("false"))).content).toContain("Nothing deleted");
    await call(env, forget("true"));
    expect(discord.followups().at(-1)).toContain("Your character links and stats are deleted");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM characters").get()).toEqual({ n: 0 });
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM hunters").get()).toEqual({ n: 0 });
    expect(lastKill()).toMatchObject({ killer_discord_id: null, killer_name: null, image_r2_key: null });
    expect(r2.has(key)).toBe(false);
  });

  it("deletes proof screenshots PROOF_RETENTION_DAYS after the bounty closes", async () => {
    await say(kill(), [shot()], HUNTER_USER);
    const key = String(lastKill().image_r2_key);
    const r2 = (env.PROOFS as unknown as { objects: Map<string, unknown> }).objects;
    db.sqlite.prepare("UPDATE bounties SET status = 'paid', closed_at = ?").run(NOW - 10 * 86400);
    env.PROOF_RETENTION_DAYS = "30";
    await expirySweep(env, new DiscordRest("t"), NOW);
    expect(r2.has(key)).toBe(true);
    env.PROOF_RETENTION_DAYS = "7";
    await expirySweep(env, new DiscordRest("t"), NOW);
    expect(r2.has(key)).toBe(false);
    expect(lastKill().image_r2_key).toBeNull();
  });
});
