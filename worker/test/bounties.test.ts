import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, ERROR_REPLY_TTL_MS, type ChatDeps } from "../src/chat";
import { _unsafe, decodePack, encode, type BountyPost } from "../src/codec";
import type { Env } from "../src/env";
import { DiscordRest } from "../src/rest";
import { forbiddenDb, TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions, STRANGER } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

const NOW = 1795200000;
let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let userSeq = 0;
let later: { ms: number; fn: () => Promise<unknown> }[];

const bounty = (f: Partial<BountyPost> = {}): BountyPost => ({
  schema: 1,
  boardTag: tag,
  targetGUID: "Player-4395-0A1B2C3D",
  targetName: "Grimlok Ashveil",
  targetClassID: 1,
  targetRaceID: 2,
  targetLevel: 42,
  targetFaction: 2,
  posterFaction: 1,
  rewardGold: 500,
  posterGUID: "Player-4395-00FFEE11",
  posterName: "Slac Jaw",
  mapID: 1434,
  createdAt: NOW - 60,
  nonce: 4242,
  note: "",
  mode: 0,
  existingBountyId: 0,
  ...f,
});
const code = (f: Partial<BountyPost> = {}) => encode("B", bounty(f));

const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: (fn, ms) => later.push({ fn, ms }) });

/** Simulates a gateway MESSAGE_CREATE. Each call is a new author, so the rate limiter stays out of the way. */
const say = (content: string, over: Record<string, unknown> = {}) =>
  onDispatch(deps(), "MESSAGE_CREATE", {
    id: `6000000000000000${String(++userSeq).padStart(2, "0")}`,
    channel_id: ids.line,
    guild_id: GUILD_A,
    content,
    author: { id: `7000000000000000${String(userSeq).padStart(2, "0")}` },
    ...over,
  });

const reactions = () => discord.find("PUT", /\/reactions\//).map((c) => decodeURIComponent(c.path.split("/reactions/")[1]!.split("/")[0]!));
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).slice(1).map((c) => String(c.body!.content)); // [0] is the how-to
const threads = () => discord.find("POST", /\/threads$/);
const bountyRows = () => db.sqlite.prepare("SELECT * FROM bounties").all() as Record<string, unknown>[];

beforeEach(async () => {
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  later = [];
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
  discord.calls = [];
  discord.calls.push({ method: "POST", path: `/channels/${ids.line}/messages`, body: { content: "(how-to)" } });
});
afterEach(() => {
  vi.unstubAllGlobals();
});

describe("posting a bounty from #bounty-line", () => {
  it("creates the bounty, a wanted poster with the Open tag, and reacts ✅", async () => {
    await say(`here you go ${code()}`);
    const [row] = bountyRows();
    expect(row).toMatchObject({ tenant_id: GUILD_A, target_name: "Grimlok Ashveil", reward_gold: 500, status: "open", faction: "Horde" });
    expect(row!.expires_at).toBe(NOW + 14 * 86400);

    const [thread] = threads();
    expect(thread!.path).toBe(`/channels/${ids.forum}/threads`);
    const openTag = JSON.parse((db.sqlite.prepare("SELECT config_json FROM tenants").get() as { config_json: string }).config_json).forum_tags.open;
    expect(thread!.body).toMatchObject({ name: "☠️ Grimlok Ashveil · 500g", applied_tags: [openTag] });
    const message = thread!.body!.message as { content: string; embeds: { title: string; description: string }[] };
    const embed = message.embeds[0]!;
    expect(embed.title).toBe("☠️ WANTED: GRIMLOK ASHVEIL");
    // Forum cards only preview the text, so the key facts must be in it.
    expect(message.content).toContain("**Reward: 500g** · Orc Warrior 42 · Horde");
    expect(message.content).toContain(`Bounty #${row!.id}`);
    expect(embed.description).toContain("Orc Warrior · Level 42 · Horde");
    expect(embed.description).toContain("Reward: 500g");
    expect(row!.thread_id).toBeTruthy();

    expect(reactions()).toEqual(["✅"]);
    expect(replies()).toEqual([]); // success is the reaction alone: no reply in the channel
    expect(later).toEqual([]);
  });

  it("attaches the parchment poster as a plain attachment, so it becomes the forum card's cover", async () => {
    env = { ...env, POSTER_IMAGE: "true" };
    await say(code());
    const [thread] = threads();
    expect(thread!.files).toHaveLength(1);
    const file = thread!.files![0]!;
    expect(file).toMatchObject({ name: "wanted-poster.png", type: "image/png" });
    expect(Array.from(file.bytes.slice(0, 4))).toEqual([0x89, 0x50, 0x4e, 0x47]);
    const message = thread!.body!.message as { attachments: unknown[]; embeds: { image?: unknown }[] };
    expect(message.attachments).toEqual([{ id: 0, filename: "wanted-poster.png", description: "Wanted poster" }]);
    expect(message.embeds[0]!.image).toBeUndefined(); // inside an embed it wouldn't be the cover
    expect(reactions()).toEqual(["✅"]);
  });

  it("posts without a picture when POSTER_IMAGE=false (Free plan)", async () => {
    await say(code());
    expect(threads()[0]!.files).toBeUndefined();
    expect(threads()[0]!.body!.message).not.toHaveProperty("attachments");
    expect(reactions()).toEqual(["✅"]);
  });

  it("shows ?? for a target too far above the marker to see their level", async () => {
    await say(code({ targetLevel: 0 }));
    const message = threads()[0]!.body!.message as { content: string; embeds: { description: string }[] };
    expect(message.content).toContain("Orc Warrior ?? · Horde");
    expect(message.embeds[0]!.description).toContain("Orc Warrior · Level ?? · Horde");
  });

  it("names verified zones and leaves unknown ones off", async () => {
    await say(code({ mapID: 1437 }));
    await say(code({ mapID: 9999, targetGUID: "Player-4395-0A1B2C3E", nonce: 1 }));
    const [known, unknown] = threads().map((t) => (t.body!.message as { embeds: { description: string }[] }).embeds[0]!.description);
    expect(known).toContain("Marked in: Wetlands ·");
    expect(unknown).toContain("Marked: <t:");
    expect(unknown).not.toContain("9999");
  });

  it("accepts the 1g minimum and codes made before a board was linked (tag 0000)", async () => {
    await say(code({ rewardGold: 1, boardTag: "0000" }));
    expect(bountyRows()).toHaveLength(1);
    expect(reactions()).toEqual(["✅"]);
  });

  it.each([
    ["0g", { rewardGold: 0 }],
    ["10,001g", { rewardGold: 10001 }],
  ])("rejects a %s reward with the LIMITS message", async (_, f) => {
    await say(code(f));
    expect(bountyRows()).toHaveLength(0);
    expect(reactions()).toEqual(["❌"]);
    expect(replies()[0]).toBe("❌ Reward must be between 1g and 10,000g.");
  });

  it("rejects a same-faction code with the FACTION message", async () => {
    await say(_unsafe.wrapBytes("B", _unsafe.payload("B", bounty({ posterFaction: 2 }))));
    expect(bountyRows()).toHaveLength(0);
    expect(replies()[0]).toBe("❌ Bounties must be on the opposite faction.");
  });

  it("rejects another board's code", async () => {
    await say(code({ boardTag: tag === "ZZZZ" ? "YYYY" : "ZZZZ" }));
    expect(replies()[0]).toBe("❌ That code belongs to a different Bounty Board.");
  });

  it("rejects a cut-off code", async () => {
    await say(code().slice(0, -8) + code().slice(-5));
    expect(replies()[0]).toContain("cut off or changed");
  });

  it("tells outdated addons to update", async () => {
    await say(code().replace(/^BL1/, "BL2"));
    expect(replies()[0]).toContain("addon up to date");
  });

  it("rejects the same code twice", async () => {
    const c = code();
    await say(c);
    await say(c);
    expect(bountyRows()).toHaveLength(1);
    expect(replies()[0]).toBe("❌ That code was already used.");
  });

  it("refuses a second bounty on the same target for now", async () => {
    await say(code());
    await say(code({ nonce: 1, rewardGold: 50 }));
    expect(bountyRows()).toHaveLength(1);
    expect(replies()[0]).toContain("already a bounty on Grimlok Ashveil");
  });

  it("rolls back the bounty if the poster can't be created", async () => {
    discord.fail.threads = 403;
    await say(code());
    expect(bountyRows()).toHaveLength(0);
    expect(replies()[0]).toContain("couldn't create the wanted poster");
  });

  it("deletes error replies after 60 seconds", async () => {
    await say(code({ rewardGold: 0 }));
    expect(later.map((l) => l.ms)).toEqual([ERROR_REPLY_TTL_MS]);
    await later[0]!.fn();
    expect(discord.find("DELETE", /\/messages\/\d+$/)).toHaveLength(1);
  });

  it("handles several codes in one message", async () => {
    await say(`${code()} and ${code({ targetGUID: "Player-4395-0B0B0B0B", targetName: "Vexa Nightwhisper", nonce: 2 })}`);
    expect(bountyRows()).toHaveLength(2);
    expect(reactions()).toEqual(["✅"]);
  });

  it("escapes markdown in names and notes", async () => {
    await say(code({ note: "[click](https://evil.example) @everyone" }));
    const embed = (threads()[0]!.body!.message as { embeds: { fields: { value: string }[] }[] }).embeds[0]!;
    expect(embed.fields[0]!.value).not.toContain("[click](");
    expect(embed.fields[0]!.value).toContain("@​everyone");
  });
});

describe("what the bot ignores (no database work)", () => {
  it("normal chat", async () => {
    env.DB = forbiddenDb();
    await say("anyone up for BGs tonight?");
    expect(discord.calls).toHaveLength(1); // just the how-to placeholder
  });
  it("other servers, even with a valid code", async () => {
    env.DB = forbiddenDb();
    await say(code(), { guild_id: STRANGER });
    expect(threads()).toHaveLength(0);
  });
  it("bots and webhooks", async () => {
    env.DB = forbiddenDb();
    await say(code(), { author: { id: "1", bot: true } });
    await say(code(), { webhook_id: "123" });
    expect(threads()).toHaveLength(0);
  });
  it("codes in other channels", async () => {
    await say(code(), { channel_id: "300000000000000099" });
    expect(bountyRows()).toHaveLength(0);
    expect(reactions()).toEqual([]);
  });
  it("Bounty Packs pasted in chat", async () => {
    await say("BL1-P-00-0000");
    expect(reactions()).toEqual(["❌"]); // a broken pack still gets a cut-off reply
  });
});

describe("rate limiting", () => {
  it("stops one user pasting more than 5 codes a minute", async () => {
    const author = { id: "700000000000009999" };
    for (let i = 0; i < 6; i++) await say(code({ targetGUID: `Player-4395-0000000${i}`, nonce: i }), { author });
    expect(bountyRows()).toHaveLength(5);
    expect(replies().at(-1)).toContain("Slow down");
  });
});

describe("servers that aren't allowlisted", () => {
  it("are left as soon as the bot joins", async () => {
    env.DB = forbiddenDb();
    await onDispatch(deps(), "GUILD_CREATE", { id: STRANGER });
    expect(discord.find("DELETE", new RegExp(`/users/@me/guilds/${STRANGER}$`))).toHaveLength(1);
  });
  it("allowlisted servers are kept", async () => {
    await onDispatch(deps(), "GUILD_CREATE", { id: GUILD_A });
    expect(discord.find("DELETE", /\/users\/@me\/guilds\//)).toHaveLength(0);
  });
});

describe("the addon's copy line (code in a spoiler)", () => {
  const line = () => `WANTED: **Grimlok Ashveil** · 500g ||${code()}||`;
  it("works pasted in chat", async () => {
    await say(line());
    expect(bountyRows()).toHaveLength(1);
    expect(reactions()).toEqual(["✅"]);
  });
  it("works in /bl submit", async () => {
    await call(env, command(GUILD_A, "submit", [{ name: "code", type: 3, value: line() }], "0"));
    expect(bountyRows()).toHaveLength(1);
  });
  it("/bl submit without a code says so", async () => {
    await call(env, command(GUILD_A, "submit", [{ name: "code", type: 3, value: "hello" }], "0"));
    expect(discord.followups().at(-1)).toContain("don't see a Bounty Line code");
  });
});

describe("/bl submit", () => {
  it("runs the same pipeline", async () => {
    await call(env, command(GUILD_A, "submit", [{ name: "code", type: 3, value: code() }], "0"));
    expect(bountyRows()).toHaveLength(1);
    expect(discord.followups().at(-1)).toContain("Bounty #");
  });
  it("returns the same errors", async () => {
    await call(env, command(GUILD_A, "submit", [{ name: "code", type: 3, value: code({ rewardGold: 0 }) }], "0"));
    expect(discord.followups().at(-1)).toBe("❌ Reward must be between 1g and 10,000g.");
  });
  it("asks for setup on a server that isn't set up", async () => {
    db.sqlite.exec("DELETE FROM tenants");
    await call(env, command(GUILD_A, "submit", [{ name: "code", type: 3, value: code() }], "0"));
    expect(discord.followups().at(-1)).toContain("/bl setup");
  });
});

describe("the Bounty Pack", () => {
  const packEdits = () =>
    discord.find("PATCH", new RegExp(`/channels/${ids.line}/messages/\\d+$`)).map((c) => String(c.body!.content));
  /** Players copy the code block; pull the codes out of the message the way /bl import does. */
  const packFrom = (text: string) => {
    const r = decodePack((text.match(/BL1-P-[0-9A-Z-]+/g) ?? []).join("\n"));
    if (!r.ok) throw new Error(r.message);
    return r.fields;
  };

  it("is updated in place with every new bounty", async () => {
    await say(code());
    const [text] = packEdits();
    expect(text).toContain("1 open bounty");
    const pack = packFrom(text!);
    expect(pack.boardTag).toBe(tag);
    expect(pack.bounties).toEqual([
      expect.objectContaining({ targetGUID: "Player-4395-0A1B2C3D", targetName: "Grimlok Ashveil", targetClassID: 1, targetFaction: 2, rewardGold: 500, posterName: "Slac Jaw" }),
    ]);
    expect(pack.bounties[0]!.bountyId).toBe(bountyRows()[0]!.id);
    expect(pack.bounties[0]!.expiresAt).toBe(NOW + 14 * 86400);
  });

  it("leaves out bounties that aren't open", async () => {
    await say(code());
    await say(code({ targetGUID: "Player-4395-0A1B2C3E", nonce: 2 }));
    db.sqlite.prepare("UPDATE bounties SET status = 'paid' WHERE target_guid = 'Player-4395-0A1B2C3D'").run();
    const { buildPack } = await import("../src/pack");
    const { getTenant } = await import("../src/tenants");
    const { codes, count } = await buildPack(env, (await getTenant(env.DB, GUILD_A))!, NOW);
    expect(count).toBe(1);
    expect(packFrom(codes.join("\n")).bounties.map((b) => b.targetGUID)).toEqual(["Player-4395-0A1B2C3E"]);
  });

  it("splits into parts that each fit one Discord message, and posts the extra parts", async () => {
    const insert = db.sqlite.prepare(
      `INSERT INTO bounties (tenant_id, target_guid, target_name, class, faction, reward_gold, poster_name, expires_at, status)
       VALUES (?, ?, ?, '1', 'Horde', 500, 'Slac Jaw', ?, 'open')`,
    );
    // Random names and GUIDs, so the pack doesn't compress away.
    const hex = () => Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => b.toString(16).padStart(2, "0")).join("").toUpperCase();
    for (let i = 0; i < 80; i++) insert.run(GUILD_A, `Player-4395-${hex()}`, `${hex()} ${hex()}`, NOW + 86400);
    await call(env, command(GUILD_A, "pack", [], "0"));
    const posts = [...packEdits(), ...discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).slice(1).map((c) => String(c.body!.content))];
    expect(posts.length).toBeGreaterThan(1);
    for (const p of posts) expect(p.length).toBeLessThanOrEqual(2000);
    expect(posts[0]).toContain("part 1 of");
    expect(packFrom(posts.join("\n")).bounties).toHaveLength(80);
    expect(discord.followups().at(-1)).toContain("Bounty Pack is up to date");
  });
});
