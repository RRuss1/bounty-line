import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, type ChatDeps } from "../src/chat";
import { decodePack, encode, FACT, TERM, type BountyPost, type BountyTerm, type KillClaim } from "../src/codec";
import type { Env } from "../src/env";
import { posterChecks } from "../src/limits";
import { buildPack } from "../src/pack";
import { codeLimiter, imageLimiter } from "../src/ratelimit";
import { DiscordRest } from "../src/rest";
import { getTenant } from "../src/tenants";
import { killShare } from "../src/terms";
import { TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

vi.mock("../src/qr", () => ({ readQr: async () => null }));

const NOW = 1795200000;
const TARGET = "Player-4395-0A1B2C3D";
const POSTER = "Player-4395-00FFEE11";
const POSTER_USER = "700000000000000001";
const OFFICER = "500000000000000009";
const SHOT = "https://cdn.discordapp.com/attachments/1/2/WoWScrnShot_112126_211407.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const hunters = [
  { guid: "Player-4395-01234567", user: "700000000000000777", name: "Hunter One" },
  { guid: "Player-4395-01234568", user: "700000000000000778", name: "Hunter Two" },
  { guid: "Player-4395-01234569", user: "700000000000000779", name: "Hunter Three" },
];

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let seq = 0;
let shots = 0;

const term = (kind: number, value: number, gold: number): BountyTerm => ({ kind, value, gold });
const bounty = (f: Partial<BountyPost> = {}): BountyPost => ({
  schema: 2, boardTag: tag, targetGUID: TARGET, targetName: "Grimlok Ashveil", targetClassID: 1, targetRaceID: 2, targetLevel: 42,
  targetFaction: 2, posterFaction: 1, rewardGold: 900, posterGUID: POSTER, posterName: "Slac Jaw", mapID: 1437,
  createdAt: NOW - 2 * 86400, nonce: 1, note: "", mode: 0, existingBountyId: 0, kills: 3, payout: 0, days: 7, terms: [], ...f,
});
/** A kill code; schema 3 (with facts) unless facts is null. */
const kill = (bountyId: number, h: (typeof hunters)[number], f: Partial<KillClaim> & { factsOf?: number | null } = {}) => {
  const { factsOf: facts = FACT.solo, ...rest } = f;
  const base: KillClaim = {
    schema: 1, boardTag: tag, bountyId, victimGUID: TARGET, killerGUID: h.guid, killerName: h.name,
    killerFaction: 1, killedAt: NOW - 360, mapID: 1437, flags: 1, nonce: ++seq,
  };
  const k3 = facts === null ? base : { ...base, schema: 3, seasonId: 0, victimName: "", guildName: "", guildSeen: 0, killerClassID: 4, killerLevel: 38, victimLevel: 42, facts };
  return encode("K", { ...k3, ...rest });
};

const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: () => undefined });
const say = (content: string, attachments: unknown[] = [], author = `7000000000000000${String(++seq).padStart(2, "0")}`) =>
  onDispatch(deps(), "MESSAGE_CREATE", { id: `6000000000000${String(++seq).padStart(5, "0")}`, channel_id: ids.line, guild_id: GUILD_A, content, attachments, author: { id: author } });
const shot = () => {
  const url = `${SHOT}?n${++shots}`;
  discord.images.set(url, new Uint8Array([...PNG, shots]));
  return { url, filename: "WoWScrnShot.png", content_type: "image/png", size: PNG.length + 1 };
};
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content));
const bountyRow = (id: number) => db.sqlite.prepare("SELECT * FROM bounties WHERE id = ?").get(id) as Record<string, unknown>;
const killRows = () => db.sqlite.prepare("SELECT * FROM kills ORDER BY id").all() as Record<string, unknown>[];
const button = (customId: string, user: string, roles: string[] = []) => ({
  type: 3, id: "1", token: "button-token", guild_id: GUILD_A, application_id: "400000000000000000",
  member: { user: { id: user }, permissions: "0", roles }, data: { custom_id: customId, component_type: 2 },
});
const approve = (killId: unknown) => call(env, button(`kill:approve:${killId}`, OFFICER, [ids.role]));
const post = async (f: Partial<BountyPost> = {}) => {
  await say(encode("B", bounty(f)), [], POSTER_USER);
  return (db.sqlite.prepare("SELECT MAX(id) AS id FROM bounties").get() as { id: number }).id;
};
const threadPosts = (id: number) => discord.find("POST", new RegExp(`/channels/${bountyRow(id).thread_id}/messages$`)).map((c) => String(c.body!.content));

beforeEach(async () => {
  codeLimiter.clear();
  imageLimiter.clear();
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
});
afterEach(() => vi.unstubAllGlobals());

describe("posting a bounty with terms", () => {
  it("stores the terms, takes the chosen length and shows the terms on the poster and in the pack", async () => {
    const id = await post({ terms: [term(TERM.soloBonus, 0, 50), term(TERM.zoneOnly, 1437, 0)] });
    const row = bountyRow(id);
    expect(row).toMatchObject({ kills_wanted: 3, payout_mode: 0, expires_at: NOW + 7 * 86400 });
    expect(JSON.parse(String(row.terms_json))).toEqual([term(TERM.soloBonus, 0, 50), term(TERM.zoneOnly, 1437, 0)]);
    const [thread] = discord.find("POST", new RegExp(`/channels/${ids.forum}/threads$`));
    const msg = thread!.body!.message as { content: string; embeds: { description: string; fields: { name: string; value: string }[] }[] };
    expect(msg.content).toContain("**Reward: 900g for 3 kills (300g each)**");
    expect(msg.content).toContain("+50g if the hunter isn't in a group · Only in Wetlands");
    const terms = msg.embeds[0]!.fields.find((f) => f.name === "🎯 Terms")!.value;
    expect(terms).toContain("Kills: **0 of 3** done");
    const pack = decodePack((await buildPack(env, (await getTenant(env.DB, GUILD_A))!, NOW)).codes.join(" "));
    expect(pack.ok && pack.fields.schema).toBe(3);
    expect(pack.ok && pack.fields.bountyTerms).toEqual([{ bountyId: id, kills: 3, killsLeft: 3, payout: 0, terms: [term(TERM.soloBonus, 0, 50), term(TERM.zoneOnly, 1437, 0)] }]);
  });

  it("counts the bonuses toward the reward limit and needs 1g per kill", async () => {
    await say(encode("B", bounty({ rewardGold: 9990, terms: [term(TERM.soloBonus, 0, 50)] })), [], POSTER_USER);
    expect(replies().at(-1)).toContain("can't be over 10,000g");
    await say(encode("B", bounty({ rewardGold: 2, nonce: 2 })), [], POSTER_USER);
    expect(replies().at(-1)).toContain("can't be split over 3 kills");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bounties").get()).toEqual({ n: 0 });
  });

  it("takes no Add to Bounty gold", async () => {
    const id = await post();
    await say(encode("B", { ...bounty({ schema: 1, nonce: 5, rewardGold: 100 }), mode: 1, existingBountyId: id, posterGUID: "Player-4395-00FFEE12", posterName: "Other Guy" }), [], "700000000000000055");
    expect(replies().at(-1)).toContain("has its own terms");
    expect(bountyRow(id).reward_gold).toBe(900);
  });

  it("a plain schema 2 bounty (one kill, no terms) still stacks", async () => {
    const id = await post({ kills: 1, days: 0 });
    expect(bountyRow(id).expires_at).toBe(NOW + 14 * 86400);
    await say(encode("B", { ...bounty({ schema: 1, nonce: 5, rewardGold: 100 }), mode: 1, existingBountyId: id, posterGUID: "Player-4395-00FFEE12", posterName: "Other Guy" }), [], "700000000000000055");
    expect(bountyRow(id).reward_gold).toBe(1000);
  });
});

describe("restrictions", () => {
  it("a kill that breaks one doesn't count", async () => {
    const id = await post({ terms: [term(TERM.zoneOnly, 1429, 0)] });
    await say(kill(id, hunters[0]!), [shot()], hunters[0]!.user);
    expect(replies().at(-1)).toContain("doesn't meet bounty #1's terms: Only in Elwynn Forest");
    expect(killRows()).toEqual([]);
  });

  it("class and solo: checked from the kill code's facts", async () => {
    const id = await post({ terms: [term(TERM.classOnly, 4, 0), term(TERM.soloOnly, 0, 0)] });
    await say(kill(id, hunters[0]!, { killerClassID: 8 }), [shot()], hunters[0]!.user);
    expect(replies().at(-1)).toContain("Rogues only");
    await say(kill(id, hunters[0]!, { factsOf: 0 }), [shot()], hunters[0]!.user);
    expect(replies().at(-1)).toContain("Solo only");
    await say(kill(id, hunters[0]!), [shot()], hunters[0]!.user);
    expect(killRows()).toHaveLength(1);
  });

  it("an older addon (no facts) goes to the officers, never auto-approved", async () => {
    db.sqlite.prepare("UPDATE tenants SET config_json = json_patch(config_json, ?)").run(JSON.stringify({ auto_approve: "all_clean" }));
    const id = await post({ terms: [term(TERM.soloOnly, 0, 0)] });
    await say(kill(id, hunters[0]!, { factsOf: null }), [shot()], hunters[0]!.user);
    expect(killRows()[0]).toMatchObject({ verdict: "pending" });
    const proof = discord.find("POST", new RegExp(`/channels/${bountyRow(id).thread_id}/messages$`)).at(-1)!;
    expect(JSON.stringify(proof.body)).toContain("addon is too old to show it");
  });
});

describe("each kill pays its share", () => {
  it("three hunters, three payments; each bonus once; the bounty is paid when the last one is", async () => {
    const id = await post({ terms: [term(TERM.soloBonus, 0, 50), term(TERM.classBonus, 4, 25)] });
    for (const h of hunters) await say(kill(id, h), [shot()], h.user);
    expect(killRows().map((k) => k.verdict)).toEqual(["pending", "pending", "pending"]);
    expect(bountyRow(id).status).toBe("open"); // several kills: still open while officers look

    const [a, b, c] = killRows();
    await approve(a!.id);
    await approve(b!.id);
    expect(bountyRow(id).status).toBe("open");
    await approve(c!.id);
    expect(bountyRow(id).status).toBe("awaiting_payment");
    // 300g each; the solo and Rogue bonuses go to the first kill that earned them.
    expect(killRows().map((k) => k.amount_gold)).toEqual([375, 300, 300]);
    const payments = threadPosts(id).filter((t) => t.startsWith("💰"));
    expect(payments[0]).toContain("kill 1 of 3:** <@700000000000000777> collects **375g**");
    expect(payments[0]).toContain("🎯 +50g if the hunter isn't in a group");

    // A fourth claim: all the kills are taken.
    await say(kill(id, { guid: "Player-4395-0123456A", user: "700000000000000780", name: "Late" }), [shot()], "700000000000000780");
    expect(replies().at(-1)).toContain("no longer open");

    for (const [i, k] of [a, b, c].entries()) {
      await call(env, button(`pay:paid:${k!.id}`, POSTER_USER));
      await call(env, button(`pay:received:${k!.id}`, hunters[i]!.user));
      expect(bountyRow(id).status).toBe(i < 2 ? "awaiting_payment" : "paid");
    }
    const earned = db.sqlite.prepare("SELECT discord_user_id, gold_earned FROM hunters ORDER BY discord_user_id").all();
    expect(earned).toEqual(hunters.map((h, i) => ({ discord_user_id: h.user, gold_earned: i === 0 ? 375 : 300 })));
  });

  it("only the poster marks a kill paid; an unpaid kill blocks new bounties after the grace days", async () => {
    const id = await post();
    await say(kill(id, hunters[0]!), [shot()], hunters[0]!.user);
    await approve(killRows()[0]!.id);
    await call(env, button(`pay:paid:${killRows()[0]!.id}`, hunters[1]!.user));
    expect(killRows()[0]!.paid_at).toBeNull();
    const ephemeral = discord.find("POST", /\/webhooks\/\d+\/button-token$/).at(-1)!;
    expect(String(ephemeral.body!.content)).toContain("Only the poster");
    const tenant = (await getTenant(env.DB, GUILD_A))!;
    expect(await posterChecks(env, tenant, POSTER_USER, NOW + 3600, { newBounty: true })).toBeNull();
    expect(await posterChecks(env, tenant, POSTER_USER, NOW + 4 * 86400, { newBounty: true })).toMatchObject({ code: "OWING" });
  });

  it("splits unevenly with the rounding on the last kill", () => {
    expect([1, 2, 3].map((i) => killShare(1000, 3, i))).toEqual([333, 333, 334]);
  });

  it("denying an auto-approved kill frees its share and bonus", async () => {
    const id = await post({ terms: [term(TERM.soloBonus, 0, 50)] });
    await say(kill(id, hunters[0]!), [shot()], hunters[0]!.user);
    const first = killRows()[0]!;
    await approve(first.id);
    expect(killRows()[0]!.amount_gold).toBe(350);
    // As if it had been auto-approved (the stamp reader isn't part of this test).
    db.sqlite.prepare("UPDATE kills SET verdict = 'auto' WHERE id = ?").run(Number(first.id));
    await call(env, button(`kill:deny:${first.id}`, OFFICER, [ids.role]));
    expect(killRows()[0]).toMatchObject({ amount_gold: null, bonus_json: null });
    await say(kill(id, hunters[1]!), [shot()], hunters[1]!.user);
    await approve(killRows()[1]!.id);
    expect(killRows()[1]!.amount_gold).toBe(350); // kill 1 of 3 again, with the solo bonus
  });
});

describe("all or nothing", () => {
  it("pays nothing until one hunter has every kill, then the whole reward plus their bonuses", async () => {
    const id = await post({ kills: 2, payout: 1, rewardGold: 1000, terms: [term(TERM.rushBonus, 72, 100), term(TERM.insultBonus, 0, 40)] });
    const h = hunters[0]!;
    await say(kill(id, h, { killedAt: NOW - 7200 }), [shot()], h.user);
    await approve(killRows()[0]!.id);
    expect(killRows()[0]!.amount_gold).toBeNull();
    expect(bountyRow(id).status).toBe("open");
    expect(threadPosts(id).at(-1)).toContain("Kill **1 of 2**");

    // Another hunter's kill doesn't add to this one's count.
    await say(kill(id, hunters[1]!), [shot()], hunters[1]!.user);
    await approve(killRows()[1]!.id);
    expect(bountyRow(id).status).toBe("open");

    await say(kill(id, h, { killedAt: NOW - 60, factsOf: FACT.solo | FACT.insult }), [shot()], h.user);
    await approve(killRows()[2]!.id);
    expect(bountyRow(id).status).toBe("awaiting_payment");
    expect(killRows()[2]!.amount_gold).toBe(1140); // 1000 + rush (within 72h) + /lol
    expect(threadPosts(id).filter((t) => t.startsWith("💰")).at(-1)).toContain("all 2 kills");
  });
});
