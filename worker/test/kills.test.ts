import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, type ChatDeps } from "../src/chat";
import { encode, type BountyPost, type KillClaim } from "../src/codec";
import type { Env } from "../src/env";
import { codeLimiter } from "../src/ratelimit";
import { DiscordRest } from "../src/rest";
import { TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

const NOW = 1795200000;
const TARGET = "Player-4395-0A1B2C3D";
const POSTER = "Player-4395-00FFEE11";
const HUNTER = "Player-4395-01234567";
const HUNTER_USER = "700000000000000777";
const SHOT = "https://cdn.discordapp.com/attachments/1/2/WoWScrnShot_112126_211407.png";
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let seq = 0;
let bountyId: number;
let threadId: string;

const bounty = (): BountyPost => ({
  schema: 1, boardTag: tag, targetGUID: TARGET, targetName: "Grimlok Ashveil", targetClassID: 1, targetRaceID: 2, targetLevel: 42,
  targetFaction: 2, posterFaction: 1, rewardGold: 500, posterGUID: POSTER, posterName: "Slac Jaw", mapID: 1437,
  createdAt: NOW - 3600, nonce: 1, note: "", mode: 0, existingBountyId: 0,
});
const kill = (f: Partial<KillClaim> = {}) =>
  encode("K", {
    schema: 1, boardTag: tag, bountyId, victimGUID: TARGET, killerGUID: HUNTER, killerName: "Hunter McHunterface",
    killerFaction: 1, killedAt: NOW - 360, mapID: 1437, flags: 1, nonce: 7, ...f,
  });
const image = { url: SHOT, filename: "WoWScrnShot_112126_211407.png", content_type: "image/png", size: PNG.length };

const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: () => undefined });
const say = (content: string, attachments: unknown[] = [], author = `7000000000000000${String(++seq).padStart(2, "0")}`) =>
  onDispatch(deps(), "MESSAGE_CREATE", {
    id: `6000000000000000${String(++seq).padStart(2, "0")}`, channel_id: ids.line, guild_id: GUILD_A, content, attachments, author: { id: author },
  });
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content));
const kills = () => db.sqlite.prepare("SELECT * FROM kills").all() as Record<string, unknown>[];
const bountyStatus = () => (db.sqlite.prepare("SELECT status FROM bounties WHERE id = ?").get(bountyId) as { status: string }).status;
const tagId = (key: string) => JSON.parse((db.sqlite.prepare("SELECT config_json FROM tenants").get() as { config_json: string }).config_json).forum_tags[key];

const button = (customId: string, user: string, roles: string[] = [], permissions = "0") => ({
  type: 3, id: "1", token: "button-token", guild_id: GUILD_A, application_id: "400000000000000000",
  member: { user: { id: user }, permissions, roles }, data: { custom_id: customId, component_type: 2 },
});

beforeEach(async () => {
  codeLimiter.clear();
  discord = new FakeDiscord().install();
  discord.images.set(SHOT, PNG);
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
  await say(encode("B", bounty()), [], "700000000000000001");
  const row = db.sqlite.prepare("SELECT id, thread_id FROM bounties").get() as { id: number; thread_id: string };
  bountyId = row.id;
  threadId = row.thread_id;
  discord.calls = [];
});
afterEach(() => vi.unstubAllGlobals());

describe("kill claims", () => {
  it("stores the screenshot, posts the proof with Approve/Deny, and puts the bounty under review", async () => {
    await say(`got him ${kill()}`, [image], HUNTER_USER);

    const [k] = kills();
    expect(k).toMatchObject({ bounty_id: bountyId, killer_guid: HUNTER, killer_discord_id: HUNTER_USER, verdict: "pending", claimed_at: NOW });
    const checks = JSON.parse(String(k!.checks_json));
    expect(checks).toMatchObject({ guid: true, window: true, ageMinutes: 6, honor: true, linked: null });

    // Screenshot saved to R2 under the tenant and bounty.
    const r2 = (env.PROOFS as unknown as { objects: Map<string, { bytes: Uint8Array; contentType: string }> }).objects;
    expect([...r2.keys()]).toEqual([String(k!.image_r2_key)]);
    expect(String(k!.image_r2_key)).toMatch(new RegExp(`^proofs/${GUILD_A}/${bountyId}/[0-9a-f]{24}\\.png$`));
    expect(r2.get(String(k!.image_r2_key))).toMatchObject({ bytes: PNG, contentType: "image/png" });

    // Proof post in the bounty thread, with the screenshot and officer buttons.
    const [proof] = discord.find("POST", new RegExp(`/channels/${threadId}/messages$`));
    expect(proof!.files).toEqual([expect.objectContaining({ name: "proof.png", bytes: PNG })]);
    const body = proof!.body as { embeds: { title: string; description: string; image: { url: string } }[]; components: { components: { custom_id: string }[] }[] };
    expect(body.embeds[0]!.title).toContain("BOUNTY CLAIMED by Hunter McHunterface");
    expect(body.embeds[0]!.description).toContain("NEEDS OFFICER REVIEW");
    expect(body.embeds[0]!.image.url).toBe("attachment://proof.png");
    expect(body.components[0]!.components.map((c) => c.custom_id)).toEqual([`kill:approve:${k!.id}`, `kill:deny:${k!.id}`]);
    expect(k!.proof_message_id).toBeTruthy();

    // Bounty: under review, tag switched, poster updated, gone from the pack.
    expect(bountyStatus()).toBe("review");
    expect(discord.find("PATCH", new RegExp(`^/channels/${threadId}$`))[0]!.body).toEqual({ applied_tags: [tagId("review")] });
    const poster = discord.find("PATCH", new RegExp(`/channels/${threadId}/messages/${threadId}$`))[0]!;
    expect(JSON.stringify(poster.body)).toContain("CLAIMED: officer review");
    expect(replies().at(-1)).toContain("Kill claim on **Grimlok Ashveil** received");
  });

  it.each([
    ["no screenshot", () => say(kill(), [], HUNTER_USER), "Kill codes need your screenshot"],
    ["a non-image attachment", () => say(kill(), [{ ...image, content_type: "text/plain" }], HUNTER_USER), "Kill codes need your screenshot"],
    ["the wrong victim", () => say(kill({ victimGUID: "Player-4395-99999999" }), [image], HUNTER_USER), "wasn't on Grimlok Ashveil"],
    ["the poster claiming", () => say(kill({ killerGUID: POSTER }), [image], HUNTER_USER), "You can't claim your own bounty."],
    ["a same-faction killer", () => say(kill({ killerFaction: 2 }), [image], HUNTER_USER), "opposite faction"],
    ["an unknown bounty", () => say(kill({ bountyId: 999 }), [image], HUNTER_USER), "isn't on this Bounty Board"],
    ["another board's code", () => say(kill({ boardTag: tag === "AAAA" ? "BBBB" : "AAAA" }), [image], HUNTER_USER), "different Bounty Board"],
  ])("rejects %s and stores nothing", async (_, act, message) => {
    await act();
    expect(kills()).toHaveLength(0);
    expect(bountyStatus()).toBe("open");
    expect(replies().at(-1)).toContain(message);
  });

  it("rejects the same code twice, and the same screenshot on a second code", async () => {
    const code = kill();
    await say(code, [image], HUNTER_USER);
    db.sqlite.prepare("UPDATE bounties SET status = 'open'").run(); // pretend it was denied
    await say(code, [image], HUNTER_USER);
    expect(replies().at(-1)).toContain("That code was already used.");
    await say(kill({ nonce: 99 }), [image], HUNTER_USER);
    expect(replies().at(-1)).toContain("That screenshot was already used");
    expect(kills()).toHaveLength(1);
  });

  it("refuses a second claim while one is under review", async () => {
    await say(kill(), [image], HUNTER_USER);
    await say(kill({ nonce: 2 }), [{ ...image, url: SHOT + "?2" }], "700000000000000888");
    expect(replies().at(-1)).toContain("already has a kill claim waiting");
  });

  it("flags a late post for the officers instead of refusing it", async () => {
    await say(kill({ killedAt: NOW - 30 * 3600 }), [image], HUNTER_USER);
    const checks = JSON.parse(String(kills()[0]!.checks_json));
    expect(checks.window).toBe(false);
    const proof = discord.find("POST", new RegExp(`/channels/${threadId}/messages$`))[0]!;
    expect(JSON.stringify(proof.body)).toContain("limit 24h");
  });

  it("works through /bl submit with an attached image", async () => {
    const body = command(GUILD_A, "submit", [{ name: "code", type: 3, value: kill() }, { name: "image", type: 11, value: "att1" }], "0") as {
      data: { resolved?: unknown };
    };
    body.data.resolved = { attachments: { att1: image } };
    await call(env, body);
    expect(kills()).toHaveLength(1);
    expect(discord.followups().at(-1)).toContain("Kill claim");
  });
});

describe("officer review", () => {
  const claim = async () => {
    await say(kill(), [image], HUNTER_USER);
    discord.calls = [];
    return Number(kills()[0]!.id);
  };

  it("approve: awaiting payment, hunter credited, buttons removed", async () => {
    const id = await claim();
    const r = await call(env, button(`kill:approve:${id}`, "500000000000000009", [ids.role]));
    expect(r.body).toEqual({ type: 6 });
    expect(kills()[0]).toMatchObject({ verdict: "approved", reviewed_by: "500000000000000009" });
    expect(bountyStatus()).toBe("awaiting_payment");
    expect(db.sqlite.prepare("SELECT approved, denied FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ approved: 1, denied: 0 });
    const edit = discord.find("PATCH", /\/webhooks\/.+\/button-token\/messages\/@original$/)[0]!;
    expect(edit.body).toMatchObject({ components: [] });
    expect(String(edit.body!.content)).toContain("Approved");
    expect(discord.find("PATCH", new RegExp(`^/channels/${threadId}$`))[0]!.body).toEqual({ applied_tags: [tagId("awaiting_payment")] });
  });

  it("deny: the bounty opens again, back in the pack, and trust resets", async () => {
    const id = await claim();
    await call(env, button(`kill:deny:${id}`, "500000000000000009", [ids.role]));
    expect(kills()[0]!.verdict).toBe("denied");
    expect(bountyStatus()).toBe("open");
    expect(db.sqlite.prepare("SELECT denied, trust FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ denied: 1, trust: "new" });
    expect(discord.find("PATCH", new RegExp(`^/channels/${threadId}$`))[0]!.body).toEqual({ applied_tags: [tagId("open")] });
    const pack = discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).at(-1)!;
    expect(String(pack.body!.content)).toContain("1 open bounty");
  });

  it("only officers (or admins) can review", async () => {
    const id = await claim();
    await call(env, button(`kill:approve:${id}`, "500000000000000010", []));
    expect(kills()[0]!.verdict).toBe("pending");
    expect(discord.find("POST", /\/webhooks\/\d+\/button-token$/)).toHaveLength(1);
    // Server admins can, without the role.
    await call(env, button(`kill:approve:${id}`, "500000000000000011", [], String(1n << 5n)));
    expect(kills()[0]!.verdict).toBe("approved");
  });

  it("a claim can only be reviewed once", async () => {
    const id = await claim();
    await call(env, button(`kill:approve:${id}`, "500000000000000009", [ids.role]));
    await call(env, button(`kill:deny:${id}`, "500000000000000009", [ids.role]));
    expect(kills()[0]!.verdict).toBe("approved");
    expect(bountyStatus()).toBe("awaiting_payment");
  });
});

describe("payment", () => {
  const POSTER_USER = "700000000000000001"; // posted the bounty in beforeEach
  const OFFICER = "500000000000000009";
  const approved = async () => {
    await say(kill(), [image], HUNTER_USER);
    const id = Number(kills()[0]!.id);
    await call(env, button(`kill:approve:${id}`, OFFICER, [ids.role]));
    discord.calls = [];
    return id;
  };
  const lastEdit = () => discord.find("PATCH", /\/webhooks\/.+\/button-token\/messages\/@original$/).at(-1)!.body!;
  const closed = () => discord.find("PATCH", new RegExp(`^/channels/${threadId}$`)).some((c) => c.body!.archived === true);

  it("approval posts Paid / Received / Force close in the thread, pinging poster and hunter", async () => {
    await say(kill(), [image], HUNTER_USER);
    const id = Number(kills()[0]!.id);
    await call(env, button(`kill:approve:${id}`, OFFICER, [ids.role]));
    const prompt = discord.find("POST", new RegExp(`/channels/${threadId}/messages$`)).at(-1)!.body as {
      content: string; components: { components: { custom_id: string }[] }[]; allowed_mentions: { users: string[] };
    };
    expect(prompt.content).toContain(`<@${HUNTER_USER}> collects **500g**`);
    expect(prompt.content).toContain(`⬜ <@${POSTER_USER}> pays **500g**`);
    expect(prompt.components[0]!.components.map((c) => c.custom_id)).toEqual([`pay:paid:${id}`, `pay:received:${id}`, `pay:close:${id}`]);
    expect(prompt.allowed_mentions.users.sort()).toEqual([HUNTER_USER, POSTER_USER].sort());
  });

  it("Paid then Received: PAID in full, tag and stamp, hunter credited, thread closed", async () => {
    const id = await approved();
    await call(env, button(`pay:paid:${id}`, POSTER_USER));
    expect(String(lastEdit().content)).toContain(`✅ <@${POSTER_USER}> pays **500g**`);
    expect(String(lastEdit().content)).toContain("⬜ Received (hunter)");
    expect(bountyStatus()).toBe("awaiting_payment");

    await call(env, button(`pay:received:${id}`, HUNTER_USER));
    expect(String(lastEdit().content)).toContain("PAID IN FULL");
    expect(lastEdit().components).toEqual([]);
    expect(bountyStatus()).toBe("paid");
    expect(kills()[0]!.paid_at).toBeTruthy();
    expect(kills()[0]!.received_at).toBeTruthy();
    expect(db.sqlite.prepare("SELECT gold_earned FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ gold_earned: 500 });
    expect(discord.find("PATCH", new RegExp(`^/channels/${threadId}$`)).map((c) => c.body)).toContainEqual({ applied_tags: [tagId("paid")] });
    expect(JSON.stringify(discord.find("PATCH", new RegExp(`/channels/${threadId}/messages/${threadId}$`)).at(-1)!.body)).toContain("**PAID**");
    expect(closed()).toBe(true);
  });

  it("works in either order", async () => {
    const id = await approved();
    await call(env, button(`pay:received:${id}`, HUNTER_USER));
    await call(env, button(`pay:paid:${id}`, POSTER_USER));
    expect(bountyStatus()).toBe("paid");
  });

  it("only the poster can click Paid, only the hunter Received", async () => {
    const id = await approved();
    await call(env, button(`pay:paid:${id}`, HUNTER_USER));
    await call(env, button(`pay:received:${id}`, POSTER_USER));
    expect(kills()[0]).toMatchObject({ paid_at: null, received_at: null });
    expect(discord.find("POST", /\/webhooks\/\d+\/button-token$/)).toHaveLength(2);
  });

  it("officers can force-close; others can't", async () => {
    const id = await approved();
    await call(env, button(`pay:close:${id}`, POSTER_USER));
    expect(bountyStatus()).toBe("awaiting_payment");
    await call(env, button(`pay:close:${id}`, OFFICER, [ids.role]));
    expect(bountyStatus()).toBe("paid");
    expect(String(lastEdit().content)).toContain(`Closed by <@${OFFICER}>`);
    expect(closed()).toBe(true);
  });

  it("a paid bounty can't be paid again", async () => {
    const id = await approved();
    await call(env, button(`pay:close:${id}`, OFFICER, [ids.role]));
    await call(env, button(`pay:paid:${id}`, POSTER_USER));
    expect(db.sqlite.prepare("SELECT gold_earned FROM hunters WHERE discord_user_id = ?").get(HUNTER_USER)).toEqual({ gold_earned: 500 });
  });
});

describe("character links", () => {
  const link = () =>
    encode("L", { schema: 1, boardTag: tag, charGUID: HUNTER, charName: "Hunter McHunterface", faction: 1, guildName: "Grief", createdAt: NOW, nonce: 3 });

  it("links a character to the Discord user who pasted it", async () => {
    await say(link(), [], HUNTER_USER);
    expect(db.sqlite.prepare("SELECT name, discord_user_id FROM characters WHERE guid = ?").get(HUNTER)).toEqual({
      name: "Hunter McHunterface", discord_user_id: HUNTER_USER,
    });
    expect(replies().at(-1)).toContain("Linked **Hunter McHunterface**");
  });

  it("then shows the link on kill claims, and flags a mismatch", async () => {
    await say(link(), [], HUNTER_USER);
    await say(kill(), [image], HUNTER_USER);
    expect(JSON.parse(String(kills()[0]!.checks_json)).linked).toBe(true);
    db.sqlite.prepare("DELETE FROM kills").run();
    db.sqlite.prepare("UPDATE bounties SET status = 'open'").run();
    discord.images.set(SHOT + "?b", new Uint8Array([...PNG, 9])); // a different screenshot
    await say(kill({ nonce: 50 }), [{ ...image, url: SHOT + "?b" }], "700000000000000999");
    expect(JSON.parse(String(kills()[0]!.checks_json)).linked).toBe(false);
  });
});
