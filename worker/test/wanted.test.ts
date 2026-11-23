/** Bounties set by name from Discord (spec 5.12): /bl wanted, the pack, claims and the lock. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { onDispatch, type ChatDeps } from "../src/chat";
import { decodePack, encode, type BountyPost, type KillClaim } from "../src/codec";
import type { Env } from "../src/env";
import { codeLimiter } from "../src/ratelimit";
import { DiscordRest } from "../src/rest";
import { checkName, nameKey, parseGold } from "../src/wanted";
import { TestD1 } from "./helpers/d1";
import { call, command, GUILD_A, ids, makeEnv, setupOptions } from "./helpers/env";
import { FakeDiscord } from "./helpers/fakes";

const NOW = 1795200000;
const VICTIM = "Player-4395-0A1B2C3D";
const HUNTER = "Player-4395-01234567";
const HUNTER_USER = "700000000000000777";
const POSTER_USER = "700000000000000001";
const OFFICER = "500000000000000009";

let discord: FakeDiscord;
let db: TestD1;
let env: Env;
let tag: string;
let seq = 0;

const wanted = (name: string, gold: number, faction = "Alliance", user = POSTER_USER) => ({
  ...command(GUILD_A, "wanted", [
    { name: "name", type: 3, value: name },
    { name: "faction", type: 3, value: faction },
    { name: "gold", type: 4, value: String(gold) },
  ], "0"),
  member: { user: { id: user, username: "buddy", global_name: "Buddy" }, permissions: "0", roles: [] },
});
const deps = (): ChatDeps => ({ env, rest: new DiscordRest("t"), now: () => NOW, later: () => undefined });
const say = (content: string, attachments: unknown[] = [], author = HUNTER_USER) =>
  onDispatch(deps(), "MESSAGE_CREATE", {
    id: `6000000000000000${String(++seq).padStart(2, "0")}`, channel_id: ids.line, guild_id: GUILD_A, content, attachments, author: { id: author },
  });
const replies = () => discord.find("POST", new RegExp(`/channels/${ids.line}/messages$`)).map((c) => String(c.body!.content));
const row = () => db.sqlite.prepare("SELECT * FROM bounties ORDER BY id DESC").get() as Record<string, unknown>;
const lastKill = () => db.sqlite.prepare("SELECT * FROM kills ORDER BY id DESC").get() as Record<string, unknown>;
const setConfig = (key: string, value: unknown) =>
  db.sqlite.prepare("UPDATE tenants SET config_json = json_set(config_json, ?, json(?))").run(`$.${key}`, JSON.stringify(value));
const shot = () => {
  const url = `https://cdn.discordapp.com/attachments/1/2/shot.png?${++seq}`;
  discord.images.set(url, new Uint8Array([0x89, 0x50, 0x4e, 0x47, seq]));
  return { url, filename: "shot.png", content_type: "image/png", size: 5 };
};
const kill = (bountyId: number, f: Partial<KillClaim> = {}) =>
  encode("K", {
    schema: 3, boardTag: tag, bountyId, victimGUID: VICTIM, killerGUID: HUNTER, killerName: "Hunter McHunterface",
    killerFaction: 2, killedAt: NOW - 360, mapID: 1437, flags: 1, nonce: ++seq,
    seasonId: 0, victimName: "Grimlok Ashveil", guildName: "", guildSeen: 0, killerClassID: 4, killerLevel: 38, victimLevel: 41, facts: 1, ...f,
  } as KillClaim);
const bounty = (f: Partial<BountyPost> = {}): BountyPost => ({
  schema: 1, boardTag: tag, targetGUID: VICTIM, targetName: "Grimlok Ashveil", targetClassID: 1, targetRaceID: 1, targetLevel: 42,
  targetFaction: 1, posterFaction: 2, rewardGold: 500, posterGUID: "Player-4395-00FFEE11", posterName: "Slac Jaw", mapID: 1437,
  createdAt: NOW - 60, nonce: ++seq, note: "", mode: 0, existingBountyId: 0, ...f,
});
const approve = (killId: number) =>
  call(env, {
    type: 3, id: "1", token: "tok", guild_id: GUILD_A, application_id: "400000000000000000",
    member: { user: { id: OFFICER }, permissions: "0", roles: [ids.role] }, data: { custom_id: `kill:approve:${killId}`, component_type: 2 },
  });
/** The newest pack text the bot posted or edited in #bounty-line. */
const latestPack = () => {
  const texts = discord.calls
    .filter((c) => c.path.startsWith(`/channels/${ids.line}/messages`) && String(c.body?.content ?? "").includes("Bounty Pack"))
    .map((c) => String(c.body!.content));
  const r = decodePack((texts.at(-1)!.match(/BL1-P-[0-9A-Z-]+/g) ?? []).join("\n"));
  if (!r.ok) throw new Error(r.message);
  return r.fields;
};

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(NOW * 1000 - 3600 * 1000); // the bounty is set an hour before the kills
  codeLimiter.clear();
  discord = new FakeDiscord().install();
  db = TestD1.migrated();
  env = await makeEnv(db.asD1());
  await call(env, command(GUILD_A, "setup", setupOptions()));
  tag = (db.sqlite.prepare("SELECT board_tag FROM tenants").get() as { board_tag: string }).board_tag;
  discord.calls = [];
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("names", () => {
  it("takes a full name as the game shows it, tidied; refuses anything else", () => {
    expect(checkName("  Grimlok   Ashveil ")).toBe("Grimlok Ashveil");
    expect(checkName("Zoë")).toBe("Zoë");
    expect(checkName("Mal'ganis Dark-Song")).toBe("Mal'ganis Dark-Song");
    expect(checkName("G")).toBeNull();
    expect(checkName("Grim1ok")).toBeNull();
    expect(checkName("one two three four")).toBeNull();
    expect(checkName("x".repeat(41))).toBeNull();
    expect(nameKey(" Grimlok  ASHVEIL")).toBe("name:grimlok ashveil");
  });
});

describe("/bl wanted", () => {
  it("posts a wanted poster by name and puts it in the pack (schema 4), not in the GUID list", async () => {
    await call(env, wanted("grimlok  Ashveil", 75));
    expect(discord.followups().at(-1)).toContain("Bounty #1 on **grimlok Ashveil** for **75g** is up");
    const b = row();
    expect(b).toMatchObject({ target_guid: "name:grimlok ashveil", target_name: "grimlok Ashveil", faction: "Alliance", reward_gold: 75, status: "open", poster_name: "Buddy", poster_discord_id: POSTER_USER });
    const post = discord.find("POST", new RegExp(`/channels/${ids.forum}/threads$`))[0]!;
    expect(JSON.stringify(post.body)).toContain("set by name in Discord, not seen in game yet");
    const pack = latestPack();
    expect(pack.schema).toBe(4);
    expect(pack.bounties).toEqual([]);
    expect(pack.wanted).toEqual([{ bountyId: 1, targetName: "grimlok Ashveil", targetFaction: 1, rewardGold: 75, posterName: "Buddy", expiresAt: Number(b.expires_at) }]);
    // Payment works as for any bounty: the poster is the one contributor.
    expect(db.sqlite.prepare("SELECT poster_discord_id, reward_gold FROM contributions").all()).toEqual([{ poster_discord_id: POSTER_USER, reward_gold: 75 }]);
  });

  it("uses the poster's linked character name when they have one", async () => {
    db.sqlite.prepare("INSERT INTO characters (tenant_id, guid, name, discord_user_id) VALUES (?, ?, ?, ?)").run(GUILD_A, "Player-1-1", "Slac Jaw", POSTER_USER);
    await call(env, wanted("Grimlok Ashveil", 75));
    expect(row().poster_name).toBe("Slac Jaw");
  });

  it("refuses a bad name, a reward outside the limits, and a second bounty on the same player", async () => {
    await call(env, wanted("Grim1ok", 75));
    expect(discord.followups().at(-1)).toContain("full name as the game shows it");
    await call(env, wanted("Grimlok Ashveil", 20000));
    expect(discord.followups().at(-1)).toContain("Reward must be between 1g and 10,000g");
    await call(env, wanted("Grimlok Ashveil", 75));
    await call(env, wanted("GRIMLOK ashveil", 90));
    expect(discord.followups().at(-1)).toContain("There's already a bounty on **GRIMLOK ashveil** (#1)");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bounties").get()).toEqual({ n: 1 });
  });

  it("refuses a name that already has a bounty set in game", async () => {
    await say(encode("B", bounty()), [], POSTER_USER);
    await call(env, wanted("Grimlok Ashveil", 75));
    expect(discord.followups().at(-1)).toContain("There's already a bounty on **Grimlok Ashveil** (#1)");
  });

  it("an in-game bounty on the same name is refused, and gold can't be added to it", async () => {
    await call(env, wanted("Grimlok Ashveil", 75));
    await say(encode("B", bounty()), [], "700000000000000002");
    expect(replies().at(-1)).toContain("There's already a bounty on Grimlok Ashveil (#1)");
    setConfig("allow_stacking", true);
    await say(encode("B", bounty({ mode: 1, existingBountyId: 1 })), [], "700000000000000002");
    expect(replies().at(-1)).toContain("was set by name in Discord, so gold can't be added");
  });
});

describe("the /bl wanted form", () => {
  const bare = (options: { name: string; type: number; value: string }[] = []) => ({
    ...command(GUILD_A, "wanted", options, "0"),
    member: { user: { id: POSTER_USER, username: "buddy" }, nick: "Bud", permissions: "0", roles: [] },
  });
  type Form = { custom_id: string; components: { label: string; component: { custom_id: string; value?: string; options?: { value: string; default?: boolean }[] } }[] };
  const submit = (values: { first: string; last: string; faction: string; gold: string }) =>
    call(env, {
      type: 5, id: "1", token: "tok", guild_id: GUILD_A, application_id: "400000000000000000",
      member: { user: { id: POSTER_USER, username: "buddy" }, nick: "Bud", permissions: "0", roles: [] },
      data: {
        custom_id: "wanted",
        components: [
          { type: 18, component: { type: 4, custom_id: "first", value: values.first } },
          { type: 18, component: { type: 4, custom_id: "last", value: values.last } },
          { type: 18, component: { type: 3, custom_id: "faction", values: [values.faction] } },
          { type: 18, component: { type: 4, custom_id: "gold", value: values.gold } },
        ],
      },
    });

  it("/bl wanted on its own opens the form: first name, last name, faction, gold", async () => {
    const r = await call(env, bare());
    expect(r.body.type).toBe(9);
    const form = r.body.data as unknown as Form;
    expect(form.custom_id).toBe("wanted");
    expect(form.components.map((c) => c.label)).toEqual(["First name", "Last name", "Faction", "Gold"]);
    expect(form.components[2]!.component.options!.map((o) => o.value)).toEqual(["Alliance", "Horde"]);
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM bounties").get()).toEqual({ n: 0 });
  });

  it("fills in whatever was typed in the command", async () => {
    const r = await call(env, bare([{ name: "name", type: 3, value: "Grimlok Ashveil" }, { name: "faction", type: 3, value: "Horde" }]));
    const form = r.body.data as unknown as Form;
    expect(form.components[0]!.component.value).toBe("Grimlok");
    expect(form.components[1]!.component.value).toBe("Ashveil");
    expect(form.components[2]!.component.options!.find((o) => o.default)?.value).toBe("Horde");
  });

  it("submitting the form posts the bounty", async () => {
    await submit({ first: " Grimlok ", last: "Ashveil", faction: "Alliance", gold: "1,000" });
    expect(discord.followups().at(-1)).toContain("Bounty #1 on **Grimlok Ashveil** for **1,000g** is up");
    expect(row()).toMatchObject({ target_guid: "name:grimlok ashveil", faction: "Alliance", reward_gold: 1000, poster_name: "Bud" });
  });

  it("a character with no last name, and gold that isn't a number", async () => {
    await submit({ first: "Zoë", last: "", faction: "Horde", gold: "lots" });
    expect(discord.followups().at(-1)).toContain("Type the gold as a whole number");
    await submit({ first: "Zoë", last: "", faction: "Horde", gold: "2.5k" });
    expect(row()).toMatchObject({ target_name: "Zoë", faction: "Horde", reward_gold: 2500 });
  });

  it("reads gold the way players type it", () => {
    expect([parseGold("50"), parseGold("1,000"), parseGold("75g"), parseGold("2.5k"), parseGold("1K")]).toEqual([50, 1000, 75, 2500, 1000]);
    expect([parseGold(""), parseGold("1.5"), parseGold("-5"), parseGold("ten")].every(Number.isNaN)).toBe(true);
  });
});

describe("kills on a bounty set by name", () => {
  beforeEach(async () => {
    await call(env, wanted("Grimlok Ashveil", 75));
    discord.calls = [];
  });

  it("always go to the officers, even for a trusted hunter with auto-approve on", async () => {
    setConfig("auto_approve", "all_clean");
    db.sqlite.prepare("INSERT INTO hunters (tenant_id, discord_user_id, approved, streak, trust) VALUES (?, ?, 5, 5, 'trusted')").run(GUILD_A, HUNTER_USER);
    await say(kill(1), [shot()]);
    expect(lastKill().verdict).toBe("pending");
    expect(row().status).toBe("review");
    const proof = discord.find("POST", new RegExp(`/channels/${row().thread_id}/messages$`)).find((c) => c.files)!;
    expect(JSON.stringify(proof.body)).toContain("Bounty set by name in Discord");
  });

  it("approving locks the bounty to the victim: GUID and level, and the pack lists it by GUID", async () => {
    await say(kill(1), [shot()]);
    await approve(Number(lastKill().id));
    expect(row()).toMatchObject({ target_guid: VICTIM, level: 41, status: "awaiting_payment" });
    const pack = latestPack();
    expect(pack.wanted ?? []).toEqual([]);
  });

  it("a denied claim leaves it by name", async () => {
    await say(kill(1), [shot()]);
    await call(env, {
      type: 3, id: "1", token: "tok", guild_id: GUILD_A, application_id: "400000000000000000",
      member: { user: { id: OFFICER }, permissions: "0", roles: [ids.role] }, data: { custom_id: `kill:deny:${lastKill().id}`, component_type: 2 },
    });
    expect(row()).toMatchObject({ target_guid: "name:grimlok ashveil", status: "open" });
  });

  it("refuses a kill on someone else, and a code too old to carry the victim's name", async () => {
    await say(kill(1, { victimName: "Someone Else" }), [shot()]);
    expect(replies().at(-1)).toContain("That kill wasn't on Grimlok Ashveil (bounty #1)");
    await say(encode("K", { schema: 1, boardTag: tag, bountyId: 1, victimGUID: VICTIM, killerGUID: HUNTER, killerName: "Hunter McHunterface", killerFaction: 2, killedAt: NOW - 360, mapID: 1437, flags: 1, nonce: ++seq }), [shot()]);
    expect(replies().at(-1)).toContain("your addon is too old to say who you killed");
    expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM kills").get()).toEqual({ n: 0 });
  });

  it("the faction rule still holds", async () => {
    await say(kill(1, { killerFaction: 1 }), [shot()]);
    expect(replies().at(-1)).toContain("opposite faction");
  });
});
