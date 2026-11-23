import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, type ChatDeps } from "../src/chat";
import { decodePack, encode, type BountyPost, type KillClaim, type SeasonPost } from "../src/codec";
import type { Env } from "../src/env";
import { codeLimiter, imageLimiter } from "../src/ratelimit";
import { DiscordRest } from "../src/rest";
import { expirySweep } from "../src/stats";
import { TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

vi.mock("../src/qr", () => ({ readQr: async () => null }));

const NOW = 1795200000;
const DAY = 86400;
const POSTER = "Player-4395-00FFEE11";
const POSTER_USER = "700000000000000001";
const FUNDER2 = "Player-4395-00FFEE22";
const FUNDER2_USER = "700000000000000002";
const HUNTER = "Player-4395-01234567";
const HUNTER_USER = "700000000000000777";
const HUNTER2 = "Player-4395-01234568";
const HUNTER2_USER = "700000000000000778";
const OFFICER = "500000000000000009";
const GUILD = "Honor and Valor";

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let seq = 0;
let now = NOW;

const season = (f: Partial<SeasonPost> = {}): SeasonPost => ({
  schema: 1, boardTag: tag, guildName: GUILD, guildFaction: 1, posterFaction: 2, kind: 1, perKillGold: 25, totalGold: 100, days: 7,
  posterGUID: POSTER, posterName: "Slac Jaw", createdAt: NOW - 3600, nonce: ++seq, mode: 0, existingSeasonId: 0, ...f,
});
const kill = (f: Partial<KillClaim> = {}) =>
  encode("K", {
    schema: 2, boardTag: tag, bountyId: 0, victimGUID: "Player-4395-0A1B2C3D", killerGUID: HUNTER, killerName: "Hunter McHunterface",
    killerFaction: 2, killedAt: now - 360, mapID: 1437, flags: 1, nonce: ++seq, seasonId: 1, victimName: "Gaulli Gorestride", guildName: GUILD, guildSeen: 1, ...f,
  });
/** A fresh screenshot each time: the bot refuses a picture it has seen. */
const shot = () => {
  const url = `https://cdn.discordapp.com/attachments/1/2/shot${++seq}.png`;
  discord.images.set(url, new Uint8Array([0x89, 0x50, 0x4e, 0x47, seq % 256, Math.floor(seq / 256)]));
  return { url, filename: "shot.png", content_type: "image/png", size: 6 };
};

const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => now, later: () => undefined });
const say = (content: string, attachments: unknown[] = [], author = POSTER_USER) =>
  onDispatch(deps(), "MESSAGE_CREATE", {
    id: `6000000000000000${String(++seq).padStart(3, "0")}`, channel_id: ids.line, guild_id: GUILD_A, content, attachments, author: { id: author },
  });
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content));
const row = <T = Record<string, unknown>>(sql: string, ...p: (string | number)[]) => db.sqlite.prepare(sql).get(...p) as T;
const rows = (sql: string) => db.sqlite.prepare(sql).all() as Record<string, unknown>[];
const seasonRow = (id = 1) => row<Record<string, unknown>>("SELECT * FROM seasons WHERE id = ?", id);
const button = (customId: string, user: string, roles: string[] = []) => ({
  type: 3, id: "1", token: "button-token", guild_id: GUILD_A, application_id: "400000000000000000",
  member: { user: { id: user }, permissions: "0", roles }, data: { custom_id: customId, component_type: 2 },
});
/** /bl season, run by a plain member. */
const seasonCmd = (user: string, options: { name: string; type: number; value: string | number }[] = []) => ({
  ...command(GUILD_A, "season", [], "0"),
  member: { user: { id: user }, permissions: "0", roles: [] },
  data: { name: "bl", options: [{ name: "season", type: 1, options }] },
});
const END = [{ name: "action", type: 3, value: "end" }, { name: "id", type: 4, value: 1 }];
const lastEdit = () => String(discord.find("PATCH", /\/webhooks\/.+\/button-token\/messages\/@original$/).at(-1)!.body!.content);
const threadPosts = () => discord.find("POST", new RegExp(`/channels/${seasonRow().thread_id}/messages$`)).map((c) => String(c.body!.content ?? ""));

/** Claims a kill and has an officer approve it. Returns the claim id. */
const approvedKill = async (f: Partial<KillClaim> = {}, user = HUNTER_USER) => {
  await say(kill(f), [shot()], user);
  const id = Number(row<{ id: number }>("SELECT MAX(id) AS id FROM season_kills").id);
  await call(env, button(`skill:approve:${id}`, OFFICER, [ids.role]));
  return id;
};

beforeEach(async () => {
  codeLimiter.clear();
  imageLimiter.clear();
  now = NOW;
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = row<{ board_tag: string }>("SELECT board_tag FROM tenants").board_tag;
});
afterEach(() => vi.unstubAllGlobals());

describe("declaring an Open Season", () => {
  it("per head + pot: forum post, fund row, and the season rides in a schema 2 pack", async () => {
    await say(encode("S", season()));
    expect(seasonRow()).toMatchObject({ guild_name: GUILD, guild_key: "honor and valor", faction: "Alliance", kind: 1, per_kill_gold: 25, total_gold: 100, status: "open", expires_at: NOW + 7 * DAY });
    expect(rows("SELECT * FROM season_funds")).toEqual([expect.objectContaining({ season_id: 1, poster_discord_id: POSTER_USER, gold: 100 })]);
    const post = discord.find("POST", new RegExp(`/channels/${ids.forum}/threads$`)).at(-1)!.body as { name: string; message: { embeds: { description: string }[] } };
    expect(post.name).toContain("OPEN SEASON · Honor and Valor · 25g a head");
    expect(post.message.embeds[0]!.description).toContain("pot **100g** (**100g** left)");
    expect(post.message.embeds[0]!.description).toContain("once a day per hunter");

    const pack = discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).at(-1)!.body!.content as string;
    expect(pack).toContain("1 Open Season");
    const decoded = decodePack(/BL1-P-[0-9A-Z-]+/.exec(pack)![0]);
    expect(decoded.ok && decoded.fields).toMatchObject({ schema: 2, seasons: [{ seasonId: 1, guildName: GUILD, guildFaction: 1, kind: 1, perKillGold: 25, remainingGold: 100 }] });
  });

  it("a pack with no season stays schema 1", async () => {
    const b: BountyPost = {
      schema: 1, boardTag: tag, targetGUID: "Player-4395-0A1B2C3D", targetName: "Grimlok", targetClassID: 1, targetRaceID: 2, targetLevel: 42, targetFaction: 1,
      posterFaction: 2, rewardGold: 500, posterGUID: POSTER, posterName: "Slac Jaw", mapID: 1, createdAt: NOW - 60, nonce: 1, note: "", mode: 0, existingBountyId: 0,
    };
    await say(encode("B", b));
    const pack = discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).at(-1)!.body!.content as string;
    const decoded = decodePack(/BL1-P-[0-9A-Z-]+/.exec(pack)![0]);
    expect(decoded.ok && decoded.fields.schema).toBe(1);
  });

  it.each([
    ["a price per head over the limit", { perKillGold: 20000, totalGold: 20000 }, "must be between"],
    ["a pot over the limit", { totalGold: 10001 }, "must be between"],
    ["another board's code", { boardTag: "ZZZZ" }, "different Bounty Board"],
    ["a stale code", { createdAt: NOW - 8 * DAY }, "too old"],
  ])("refuses %s", async (_, f, message) => {
    await say(encode("S", season(f)));
    expect(rows("SELECT * FROM seasons")).toHaveLength(0);
    expect(replies().at(-1)).toContain(message);
  });

  it("one season per guild (name matched without case); the same code twice is a duplicate", async () => {
    const code = encode("S", season());
    await say(code);
    await say(code);
    expect(replies().at(-1)).toContain("already used");
    await say(encode("S", season({ guildName: "HONOR AND VALOR", kind: 3, perKillGold: 10, totalGold: 0 })));
    expect(replies().at(-1)).toContain("already an Open Season on HONOR AND VALOR");
    expect(rows("SELECT * FROM seasons")).toHaveLength(1);
  });

  it("adding gold grows the pot; a no-ceiling season has no pot to add to", async () => {
    await say(encode("S", season()));
    await say(encode("S", season({ kind: 0, perKillGold: 0, days: 0, totalGold: 50, mode: 1, existingSeasonId: 1, posterGUID: FUNDER2, posterName: "Second" })), [], FUNDER2_USER);
    expect(seasonRow()).toMatchObject({ total_gold: 150 });
    expect(rows("SELECT gold FROM season_funds ORDER BY id")).toEqual([{ gold: 100 }, { gold: 50 }]);

    await say(encode("S", season({ guildName: "Dawnbreakers", kind: 3, perKillGold: 10, totalGold: 0 })));
    await say(encode("S", season({ guildName: "Dawnbreakers", kind: 0, perKillGold: 0, days: 0, totalGold: 50, mode: 1, existingSeasonId: 2 })), [], FUNDER2_USER);
    expect(replies().at(-1)).toContain("no pot to add to");
  });
});

describe("claiming Open Season kills", () => {
  beforeEach(async () => {
    await say(encode("S", season()));
    discord.calls = [];
  });

  it("a kill goes to the season's thread for review; approval credits the price and updates the tally", async () => {
    await say(kill(), [shot()], HUNTER_USER);
    expect(rows("SELECT * FROM season_kills")).toEqual([expect.objectContaining({ season_id: 1, verdict: "pending", gold: 0, victim_name: "Gaulli Gorestride", day: Math.floor((NOW - 360) / DAY) })]);
    const proof = discord.find("POST", new RegExp(`/channels/${seasonRow().thread_id}/messages$`))[0]!;
    const body = proof.body as { embeds: { title: string; description: string }[]; components: { components: { custom_id: string }[] }[] };
    expect(body.embeds[0]!.title).toContain("OPEN SEASON KILL by Hunter McHunterface");
    expect(body.embeds[0]!.description).toContain("The addon saw them in **Honor and Valor**");
    expect(body.components[0]!.components.map((c) => c.custom_id)).toEqual(["skill:approve:1", "skill:deny:1"]);
    expect(seasonRow().status).toBe("open"); // a season stays open while a claim is reviewed

    await call(env, button("skill:approve:1", OFFICER, [ids.role]));
    expect(lastEdit()).toContain("**25g** added to their tally");
    expect(rows("SELECT verdict, gold FROM season_kills")).toEqual([{ verdict: "approved", gold: 25 }]);
    expect(seasonRow()).toMatchObject({ spent_gold: 25, status: "open" });
    expect(row("SELECT approved FROM hunters WHERE discord_user_id = ?", HUNTER_USER)).toEqual({ approved: 1 });
    const post = discord.find("PATCH", new RegExp(`/channels/${seasonRow().thread_id}/messages/${seasonRow().thread_id}$`)).at(-1)!;
    expect(JSON.stringify(post.body)).toContain("(**75g** left)");
    expect(JSON.stringify(post.body)).toContain(`<@${HUNTER_USER}> · 1 kill · 25g`);
  });

  it("only officers can approve", async () => {
    await say(kill(), [shot()], HUNTER_USER);
    await call(env, button("skill:approve:1", HUNTER_USER));
    expect(rows("SELECT verdict FROM season_kills")).toEqual([{ verdict: "pending" }]);
  });

  it("the same victim counts once per day per hunter: refused today, fine tomorrow, fine for another hunter", async () => {
    await approvedKill();
    await say(kill(), [shot()], HUNTER_USER);
    expect(replies().at(-1)).toContain("once a day per hunter");
    await say(kill({ killerGUID: HUNTER2 }), [shot()], HUNTER2_USER);
    now = NOW + DAY;
    await say(kill(), [shot()], HUNTER_USER);
    expect(rows("SELECT killer_discord_id, day FROM season_kills ORDER BY id")).toEqual([
      { killer_discord_id: HUNTER_USER, day: Math.floor((NOW - 360) / DAY) },
      { killer_discord_id: HUNTER2_USER, day: Math.floor((NOW - 360) / DAY) },
      { killer_discord_id: HUNTER_USER, day: Math.floor((NOW + DAY - 360) / DAY) },
    ]);
  });

  it("a denied claim doesn't use up the day", async () => {
    await say(kill(), [shot()], HUNTER_USER);
    await call(env, button("skill:deny:1", OFFICER, [ids.role]));
    await say(kill(), [shot()], HUNTER_USER);
    expect(rows("SELECT verdict FROM season_kills ORDER BY id")).toEqual([{ verdict: "denied" }, { verdict: "pending" }]);
  });

  it.each([
    ["someone who funded the season", () => say(kill({ killerGUID: POSTER }), [shot()], HUNTER_USER), "put gold into"],
    ["the funder on another character", () => say(kill(), [shot()], POSTER_USER), "put gold into"],
    ["a killer of the guild's own faction", () => say(kill({ killerFaction: 1 }), [shot()], HUNTER_USER), "opposite faction"],
    ["a guild with no season", () => say(kill({ guildName: "Nobody Here" }), [shot()], HUNTER_USER), "no Open Season on Nobody Here"],
    ["a kill from before the season", () => say(kill({ killedAt: NOW - 2 * 3600 }), [shot()], HUNTER_USER), "before Open Season #1"],
    ["no screenshot", () => say(kill(), [], HUNTER_USER), "need your screenshot"],
  ])("refuses %s", async (_, act, message) => {
    await act();
    expect(rows("SELECT * FROM season_kills")).toHaveLength(0);
    expect(replies().at(-1)).toContain(message);
  });

  it("guild not seen by the addon: filed under the open season, flagged for the officers", async () => {
    await say(kill({ seasonId: 0, guildName: "", guildSeen: 0 }), [shot()], HUNTER_USER);
    expect(rows("SELECT season_id, guild_seen, verdict FROM season_kills")).toEqual([{ season_id: 1, guild_seen: 0, verdict: "pending" }]);
    const proof = discord.find("POST", new RegExp(`/channels/${seasonRow().thread_id}/messages$`))[0]!;
    expect(JSON.stringify(proof.body)).toContain("never saw their guild");
  });

  it("open world only: a season kill outside the known zones is flagged and never auto-approved", async () => {
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?, ?, 5, 5, 'trusted')").run(GUILD_A, HUNTER_USER);
    await say(kill({ mapID: 1460 }), [shot()], HUNTER_USER);
    expect(rows("SELECT verdict FROM season_kills")).toEqual([{ verdict: "pending" }]);
    expect(JSON.parse(String((rows("SELECT checks_json FROM season_kills")[0] as { checks_json: string }).checks_json))).toMatchObject({ openWorld: false });
    const proof = discord.find("POST", new RegExp(`/channels/${seasonRow().thread_id}/messages$`))[0]!;
    expect(JSON.stringify(proof.body)).toContain("Not a known open-world zone (map 1460)");
  });

  it("a season a guildie just declared (no number in the code yet) is found by the guild", async () => {
    await say(kill({ seasonId: 0 }), [shot()], HUNTER_USER);
    expect(rows("SELECT season_id, guild_seen FROM season_kills")).toEqual([{ season_id: 1, guild_seen: 1 }]);
  });

  it("an old season number still lands on the season now running on that guild", async () => {
    await say(kill({ seasonId: 99 }), [shot()], HUNTER_USER);
    expect(rows("SELECT season_id FROM season_kills")).toEqual([{ season_id: 1 }]);
  });

  it("a double-clicked Approve credits the kill once", async () => {
    await say(kill(), [shot()], HUNTER_USER);
    await call(env, button("skill:approve:1", OFFICER, [ids.role]));
    await call(env, button("skill:approve:1", OFFICER, [ids.role]));
    expect(seasonRow()).toMatchObject({ spent_gold: 25 });
    expect(row("SELECT approved FROM hunters WHERE discord_user_id = ?", HUNTER_USER)).toEqual({ approved: 1 });
  });

  it("guild not seen with two seasons running: one Approve per guild, and approving moves it", async () => {
    await say(encode("S", season({ guildName: "Dawnbreakers", kind: 3, perKillGold: 10, totalGold: 0 })));
    await say(kill({ seasonId: 0, guildName: "", guildSeen: 0 }), [shot()], HUNTER_USER);
    const filed = row<{ season_id: number }>("SELECT season_id FROM season_kills").season_id;
    expect(filed).toBe(2); // newest first
    const proof = discord.find("POST", new RegExp(`/channels/${seasonRow(2).thread_id}/messages$`)).at(-1)!;
    const ids_ = (proof.body as { components: { components: { custom_id: string; label: string }[] }[] }).components[0]!.components;
    expect(ids_.map((c) => c.custom_id)).toEqual(["skill:approve:1:2", "skill:approve:1:1", "skill:deny:1"]);
    expect(ids_[1]!.label).toBe("Approve: Honor and Valor");
    await call(env, button("skill:approve:1:1", OFFICER, [ids.role]));
    expect(rows("SELECT season_id, verdict, gold FROM season_kills")).toEqual([{ season_id: 1, verdict: "approved", gold: 25 }]);
    expect(seasonRow(1)).toMatchObject({ spent_gold: 25 });
    expect(seasonRow(2)).toMatchObject({ spent_gold: 0 });
  });

  it("a guild member with a personal bounty: one code claims both", async () => {
    const b: BountyPost = {
      schema: 1, boardTag: tag, targetGUID: "Player-4395-0A1B2C3D", targetName: "Gaulli Gorestride", targetClassID: 1, targetRaceID: 1, targetLevel: 42, targetFaction: 1,
      posterFaction: 2, rewardGold: 500, posterGUID: POSTER, posterName: "Slac Jaw", mapID: 1, createdAt: NOW - 60, nonce: 9, note: "", mode: 0, existingBountyId: 0,
    };
    await say(encode("B", b));
    await say(kill(), [shot()], HUNTER_USER);
    expect(rows("SELECT verdict FROM season_kills")).toEqual([{ verdict: "pending" }]);
    expect(rows("SELECT verdict FROM kills")).toEqual([{ verdict: "pending" }]);
  });
});

describe("closing and paying", () => {
  const victims = ["Player-4395-0000000A", "Player-4395-0000000B", "Player-4395-0000000C", "Player-4395-0000000D", "Player-4395-0000000E"];

  it("per head + pot: the last kill takes what's left, the pot closes the season, one sheet line per hunter", async () => {
    await say(encode("S", season({ perKillGold: 40, totalGold: 100 })));
    await approvedKill({ victimGUID: victims[0]! });
    await approvedKill({ victimGUID: victims[1]!, killerGUID: HUNTER2 }, HUNTER2_USER);
    expect(seasonRow().status).toBe("open");
    await approvedKill({ victimGUID: victims[2]! }); // only 20g left
    expect(rows("SELECT gold FROM season_kills ORDER BY id")).toEqual([{ gold: 40 }, { gold: 40 }, { gold: 20 }]);
    expect(seasonRow()).toMatchObject({ status: "awaiting_payment", spent_gold: 100 });
    expect(rows("SELECT hunter_discord_id, kills, gold FROM season_payouts ORDER BY gold DESC")).toEqual([
      { hunter_discord_id: HUNTER_USER, kills: 2, gold: 60 },
      { hunter_discord_id: HUNTER2_USER, kills: 1, gold: 40 },
    ]);
    const posts = threadPosts();
    expect(posts.some((p) => p.includes("payout sheet") && p.includes("3 kills") && p.includes("**100g** to pay"))).toBe(true);
    expect(posts.some((p) => p.includes(`<@${HUNTER_USER}> collects **60g** for 2 kills`) && p.includes(`⬜ <@${POSTER_USER}> pays **60g**`))).toBe(true);

    // No more claims once it's closed, and it's out of the pack.
    await say(kill({ victimGUID: victims[3]! }), [shot()], HUNTER_USER);
    expect(replies().at(-1)).toContain("no longer open");
    const pack = discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).at(-1)!.body!.content as string;
    expect(pack).not.toContain("Open Season");
  });

  it("Paid and Received on every line: PAID, hunters' gold credited, thread closed", async () => {
    await say(encode("S", season({ perKillGold: 50, totalGold: 100 })));
    await approvedKill({ victimGUID: victims[0]! });
    await approvedKill({ victimGUID: victims[1]!, killerGUID: HUNTER2 }, HUNTER2_USER);
    const [a, b] = rows("SELECT id, hunter_discord_id FROM season_payouts ORDER BY id") as { id: number; hunter_discord_id: string }[];

    await call(env, button(`spay:paid:${a!.id}`, HUNTER_USER)); // not a payer
    expect(row("SELECT done_at FROM season_payouts WHERE id = ?", a!.id)).toEqual({ done_at: null });
    await call(env, button(`spay:paid:${a!.id}`, POSTER_USER));
    expect(lastEdit()).toContain(`✅ <@${POSTER_USER}> pays **50g**`);
    await call(env, button(`spay:received:${a!.id}`, a!.hunter_discord_id));
    expect(lastEdit()).toContain("PAID IN FULL");
    expect(seasonRow().status).toBe("awaiting_payment");

    await call(env, button(`spay:close:${b!.id}`, HUNTER_USER)); // not an officer
    expect(seasonRow().status).toBe("awaiting_payment");
    await call(env, button(`spay:close:${b!.id}`, OFFICER, [ids.role]));
    expect(lastEdit()).toContain(`Closed by <@${OFFICER}>`);
    expect(seasonRow().status).toBe("paid");
    expect(rows("SELECT discord_user_id, gold_earned FROM hunters ORDER BY discord_user_id")).toEqual([
      { discord_user_id: HUNTER_USER, gold_earned: 50 },
      { discord_user_id: HUNTER2_USER, gold_earned: 50 },
    ]);
    expect(discord.find("PATCH", new RegExp(`^/channels/${seasonRow().thread_id}$`)).some((c) => c.body!.archived === true)).toBe(true);
  });

  it("prize pool: shared by kill count at expiry, rounded down; two funders pay in order", async () => {
    await say(encode("S", season({ kind: 2, perKillGold: 0, totalGold: 100 })));
    await say(encode("S", season({ kind: 0, perKillGold: 0, days: 0, totalGold: 100, mode: 1, existingSeasonId: 1, posterGUID: FUNDER2, posterName: "Second" })), [], FUNDER2_USER);
    await approvedKill({ victimGUID: victims[0]! });
    await approvedKill({ victimGUID: victims[1]! });
    await approvedKill({ victimGUID: victims[2]!, killerGUID: HUNTER2 }, HUNTER2_USER);
    expect(rows("SELECT gold FROM season_kills")).toEqual([{ gold: 0 }, { gold: 0 }, { gold: 0 }]);

    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    expect(seasonRow().status).toBe("awaiting_payment");
    const payouts = rows("SELECT hunter_discord_id, kills, gold, payers_json FROM season_payouts ORDER BY gold DESC");
    expect(payouts.map((p) => [p.hunter_discord_id, p.kills, p.gold])).toEqual([[HUNTER_USER, 2, 133], [HUNTER2_USER, 1, 66]]);
    expect(JSON.parse(String(payouts[0]!.payers_json)).map((p: { id: string; gold: number }) => [p.id, p.gold])).toEqual([[POSTER_USER, 100], [FUNDER2_USER, 33]]);
    expect(JSON.parse(String(payouts[1]!.payers_json)).map((p: { id: string; gold: number }) => [p.id, p.gold])).toEqual([[FUNDER2_USER, 66]]);
  });

  it("prize pool with a minimum: short of it, nobody is paid; reached, it pays as usual", async () => {
    await say(encode("S", season({ schema: 2, kind: 2, perKillGold: 0, totalGold: 100, minKills: 3 })));
    expect(seasonRow()).toMatchObject({ min_kills: 3 });
    const post = discord.find("POST", new RegExp(`/channels/${ids.forum}/threads$`)).at(-1)!;
    expect(JSON.stringify(post.body)).toContain("paid only if it reaches **3 kills**");
    await approvedKill({ victimGUID: victims[0]! });
    await approvedKill({ victimGUID: victims[1]! });
    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    expect(seasonRow().status).toBe("expired");
    expect(rows("SELECT * FROM season_payouts")).toHaveLength(0);
    expect(threadPosts().at(-1)).toContain("needed **3 kills** to pay out and got **2**");
  });

  it("prize pool that reaches its minimum pays out", async () => {
    await say(encode("S", season({ schema: 2, kind: 2, perKillGold: 0, totalGold: 90, minKills: 3 })));
    for (const v of victims.slice(0, 3)) await approvedKill({ victimGUID: v });
    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    expect(rows("SELECT hunter_discord_id, kills, gold FROM season_payouts")).toEqual([{ hunter_discord_id: HUNTER_USER, kills: 3, gold: 90 }]);
  });

  it("per head, no ceiling: every kill pays, the bill is whatever it reaches at the end", async () => {
    await say(encode("S", season({ kind: 3, perKillGold: 30, totalGold: 0, days: 14 })));
    for (const v of victims) await approvedKill({ victimGUID: v });
    expect(seasonRow()).toMatchObject({ status: "open", spent_gold: 150, expires_at: NOW + 14 * DAY });
    await call(env, seasonCmd(POSTER_USER, END));
    expect(seasonRow().status).toBe("awaiting_payment");
    expect(rows("SELECT hunter_discord_id, kills, gold FROM season_payouts")).toEqual([{ hunter_discord_id: HUNTER_USER, kills: 5, gold: 150 }]);
  });

  it("closing twice (the hourly sweep and /bl season end) posts one sheet", async () => {
    await say(encode("S", season()));
    await approvedKill({ victimGUID: victims[0]! });
    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    await expirySweep(env, new DiscordRest("t"), now);
    await call(env, seasonCmd(POSTER_USER, END));
    expect(rows("SELECT * FROM season_payouts")).toHaveLength(1);
  });

  it("officers can force-close a stuck season: waiting claims denied, open lines marked paid", async () => {
    await say(encode("S", season()));
    await approvedKill({ victimGUID: victims[0]! });
    await say(kill({ victimGUID: victims[1]!, killerGUID: HUNTER2 }), [shot()], HUNTER2_USER); // never reviewed
    const close = [{ name: "action", type: 3, value: "close" }, { name: "id", type: 4, value: 1 }];
    await call(env, seasonCmd(HUNTER_USER, close));
    expect(discord.followups().at(-1)).toContain("Only officers");
    await call(env, { ...seasonCmd(OFFICER, close), member: { user: { id: OFFICER }, permissions: "0", roles: [ids.role] } });
    expect(discord.followups().at(-1)).toContain("is now **PAID**");
    expect(rows("SELECT verdict FROM season_kills ORDER BY id")).toEqual([{ verdict: "approved" }, { verdict: "denied" }]);
    expect(rows("SELECT hunter_discord_id, gold FROM season_payouts WHERE done_at IS NOT NULL")).toEqual([{ hunter_discord_id: HUNTER_USER, gold: 25 }]);
  });

  it("expiry with no kills: ended, nothing to pay, thread closed", async () => {
    await say(encode("S", season()));
    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    expect(seasonRow().status).toBe("expired");
    expect(rows("SELECT * FROM season_payouts")).toHaveLength(0);
    expect(threadPosts().at(-1)).toContain("Nobody collected");
  });

  it("claims still waiting at the close hold the sheet until the officers finish", async () => {
    await say(encode("S", season()));
    await approvedKill({ victimGUID: victims[0]! });
    await say(kill({ victimGUID: victims[1]!, killerGUID: HUNTER2 }), [shot()], HUNTER2_USER);
    now = NOW + 7 * DAY + 60;
    await expirySweep(env, new DiscordRest("t"), now);
    expect(seasonRow().status).toBe("settling");
    expect(rows("SELECT * FROM season_payouts")).toHaveLength(0);
    expect(threadPosts().at(-1)).toContain("1 claim is still waiting");

    await call(env, button("skill:approve:2", OFFICER, [ids.role]));
    expect(seasonRow().status).toBe("awaiting_payment");
    expect(rows("SELECT hunter_discord_id, gold FROM season_payouts ORDER BY id")).toEqual([
      { hunter_discord_id: HUNTER_USER, gold: 25 },
      { hunter_discord_id: HUNTER2_USER, gold: 25 },
    ]);
  });

  it("denying an auto or approved claim before the sheet gives the gold back to the pot", async () => {
    await say(encode("S", season()));
    const id = await approvedKill({ victimGUID: victims[0]! });
    db.sqlite.prepare("UPDATE season_kills SET verdict = 'auto' WHERE id = ?").run(id);
    await call(env, button(`skill:deny:${id}`, OFFICER, [ids.role]));
    expect(rows("SELECT verdict, gold FROM season_kills")).toEqual([{ verdict: "denied", gold: 0 }]);
    expect(seasonRow()).toMatchObject({ spent_gold: 0, status: "open" });
  });

  it("/bl season lists what's running; only the declarer or an officer can end one", async () => {
    await say(encode("S", season()));
    await call(env, seasonCmd(HUNTER_USER));
    expect(discord.followups().at(-1)).toContain("#1 Honor and Valor");
    await call(env, seasonCmd(HUNTER_USER, END));
    expect(discord.followups().at(-1)).toContain("Only the one who declared it");
    expect(seasonRow().status).toBe("open");
  });
});
