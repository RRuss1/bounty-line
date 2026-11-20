/**
 * Generates shared/test-vectors.json from the reference codec.
 *
 *   npm run vectors      (from worker/)
 *
 * Vectors are FROZEN once committed (Compendium 02 Section 7): codes that
 * players already have must keep decoding. Only add vectors; never change one.
 * The script refuses to overwrite an existing vector with a different value.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  _unsafe,
  adler32,
  ALPHABET,
  base32Decode,
  base32Encode,
  crc16,
  decode,
  decodePack,
  encode,
  encodePack,
  normalize,
  wrapPayload,
  type BountyPack,
  type BountyPost,
  type CharacterLink,
  type CodeType,
  type KillClaim,
} from "../src/codec";

const OUT = fileURLToPath(new URL("../../shared/test-vectors.json", import.meta.url));
const assert = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};

// ---------------------------------------------------------------- valid fields

const bBasic: BountyPost = {
  schema: 1,
  boardTag: "K7QF",
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
  createdAt: 1795200000,
  nonce: 4242,
  note: "",
  mode: 0,
  existingBountyId: 0,
};

const bStack: BountyPost = {
  ...bBasic,
  boardTag: "0000",
  targetGUID: "Player-4395-1B2C3D4E",
  targetName: "Zoë Brightblade",
  targetClassID: 8,
  targetRaceID: 7,
  targetLevel: 60,
  targetFaction: 1,
  posterFaction: 2,
  rewardGold: 1,
  posterGUID: "Player-4395-0F0F0F0F",
  posterName: "Ælfric Stormcrow",
  mapID: 1440,
  createdAt: 1795276800,
  nonce: 0,
  note: "Camped me at the flight master ☠ twice",
  mode: 1,
  existingBountyId: 12,
};

const bMax: BountyPost = {
  ...bBasic,
  boardTag: "ZZZZ",
  targetName: "",
  targetClassID: 255,
  targetRaceID: 255,
  targetLevel: 255,
  rewardGold: 4294967295,
  mapID: 65535,
  createdAt: 4294967295,
  nonce: 65535,
  mode: 1,
  existingBountyId: 4294967295,
};

// Writers truncate on a UTF-8 boundary: 254 ASCII + "é" (2 bytes) = 256 bytes -> cut to 254.
const bTruncate: BountyPost = { ...bBasic, targetName: "x".repeat(254) + "é", note: "y".repeat(79) + "☠☠" };
const bTruncateDecoded = { ...bTruncate, targetName: "x".repeat(254), note: "y".repeat(79) };

const kBasic: KillClaim = {
  schema: 1,
  boardTag: "K7QF",
  bountyId: 12,
  victimGUID: "Player-4395-0A1B2C3D",
  killerGUID: "Player-4395-01234567",
  killerName: "Hunter McHunterface",
  killerFaction: 1,
  killedAt: 1795295647,
  mapID: 1434,
  flags: 1,
  nonce: 513,
};

const kPet: KillClaim = {
  ...kBasic,
  boardTag: "0000",
  bountyId: 300,
  killerName: "Ånund Ironside",
  killerFaction: 2,
  victimGUID: "Player-77-89ABCDEF",
  flags: 2,
  nonce: 65535,
};

// GUIDs that can't take the compact form fall back to raw text.
const kRawGuids: KillClaim = {
  ...kBasic,
  victimGUID: "Player-0000-0A1B2C3D", // zero-padded server id
  killerGUID: "Player-70000-0a1b2c3d", // server id over 16 bits, lowercase hex
};

const lBasic: CharacterLink = {
  schema: 1,
  boardTag: "K7QF",
  charGUID: "Player-4395-01234567",
  charName: "Hunter McHunterface",
  faction: 1,
  guildName: "Knights of the Long Night",
  createdAt: 1795190400,
  nonce: 77,
};

const packEmpty: BountyPack = {
  schema: 1,
  boardTag: "K7QF",
  packVersion: 1795190400,
  minAddonVersion: 1000,
  discordDisplayName: "WoW Forever",
  rewardMin: 1,
  rewardMax: 10000,
  bounties: [],
};

const packThree: BountyPack = {
  ...packEmpty,
  packVersion: 1795300123,
  minAddonVersion: 1002,
  discordDisplayName: "Les Chasseurs de Primes ⚔",
  bounties: [
    { bountyId: 12, targetGUID: "Player-4395-0A1B2C3D", targetName: "Grimlok Ashveil", targetClassID: 1, targetFaction: 2, rewardGold: 500, posterName: "Slac Jaw", expiresAt: 1796400000 },
    { bountyId: 13, targetGUID: "Player-4395-1B2C3D4E", targetName: "Mograth Skullsplitter", targetClassID: 9, targetFaction: 2, rewardGold: 10000, posterName: "Hunter McHunterface", expiresAt: 1796486400 },
    { bountyId: 1000, targetGUID: "Player-11-2C3D4E5F", targetName: "Zoë Brightblade", targetClassID: 8, targetFaction: 1, rewardGold: 2500, posterName: "Ælfric Stormcrow", expiresAt: 1796572800 },
  ],
};

// Big enough that Adler-32's running sums wrap past 65521.
let seed = 12345;
const rand = (n: number) => (seed = (seed * 48271) % 2147483647) % n; // MINSTD, exact in doubles
const NAMES = ["Grim", "Zoë", "Mog", "Thal", "Vex", "Ælf", "Kor", "Ny", "Brann", "Sylv"];
const packMany: BountyPack = {
  ...packEmpty,
  packVersion: 1795400000,
  bounties: Array.from({ length: 25 }, (_, i) => ({
    bountyId: 100 + i,
    targetGUID: `Player-${rand(5000)}-${rand(0xffffffff).toString(16).toUpperCase().padStart(8, "0")}`,
    targetName: `${NAMES[rand(10)]}${NAMES[rand(10)]!.toLowerCase()} ${NAMES[rand(10)]}bane`,
    targetClassID: 1 + rand(13),
    targetFaction: 1 + rand(2),
    rewardGold: 1 + rand(10000),
    posterName: `${NAMES[rand(10)]} ${NAMES[rand(10)]}son`,
    expiresAt: 1796400000 + rand(1209600),
  })),
};

const codes = [
  { name: "B basic", type: "B", fields: bBasic },
  { name: "B add to existing, unicode, note, no board tag", type: "B", fields: bStack },
  { name: "B max values", type: "B", fields: bMax },
  { name: "B writer truncates name and note on a UTF-8 boundary", type: "B", fields: bTruncate, decoded: bTruncateDecoded },
  { name: "K basic, honor corroborated", type: "K", fields: kBasic },
  { name: "K pet kill, no honor", type: "K", fields: kPet },
  { name: "K GUIDs in raw form", type: "K", fields: kRawGuids },
  { name: "L basic", type: "L", fields: lBasic },
  { name: "P empty pack", type: "P", fields: packEmpty },
  { name: "P three bounties", type: "P", fields: packThree },
  { name: "P 25 bounties", type: "P", fields: packMany },
].map((v) => {
  const code = v.type === "P" ? encodePack(v.fields as BountyPack) : [encode(v.type as CodeType, v.fields)];
  assert(code.length === 1, `${v.name} should be a single code`);
  const r = decode(code[0]!);
  assert(r.ok, `${v.name} does not decode`);
  return { ...v, code: code[0]! };
});
const code = (name: string) => codes.find((c) => c.name === name)!.code;

// ---------------------------------------------------------------- forward compatibility (newer schema)

const futureK = _unsafe.wrapBytes("K", [..._unsafe.payload("K", { ...kBasic, schema: 2, flags: 7 }), 0xde, 0xad, 0xbe, 0xef]);
const forwardCompat = [
  {
    name: "K schema 2 with appended fields and new flag bit: known fields read, rest ignored",
    code: futureK,
    type: "K",
    fields: { ...kBasic, schema: 2, flags: 7 },
  },
];

// ---------------------------------------------------------------- normalization

const base = code("B basic");
const kCode = code("K basic, honor corroborated");
const swapTypos = (c: string) => {
  const [v, t, p, k] = c.split("-") as [string, string, string, string];
  const sw = (s: string) => s.replace(/0/g, "O").replace(/1/, "I").replace(/1/, "l");
  return [v, t, sw(p), sw(k)].join("-");
};
assert(/[OIl]/.test(swapTypos(base).slice(7)), "base vector has no 0/1 to alias");
const normalization = [
  { input: `  \`${kCode.toLowerCase()}\`  `, normalized: kCode },
  { input: base.toLowerCase(), normalized: base },
  { input: `\t${base}\r\n`, normalized: base },
  { input: `${base.slice(0, 10)} ${base.slice(10, 40)}\n${base.slice(40, 70)}\r\n\t${base.slice(70)}`, normalized: base },
  { input: swapTypos(base), normalized: base },
  { input: "```\n" + kCode + "\n```", normalized: kCode },
];
for (const n of normalization) {
  const r = decode(n.input);
  assert(r.ok && r.code === n.normalized, `normalization failed for ${JSON.stringify(n.input)}`);
}

// ---------------------------------------------------------------- invalid codes

const replaceAt = (s: string, i: number, ch: string) => s.slice(0, i) + ch + s.slice(i + 1);
const other = (ch: string) => (ch === "Q" ? "R" : "Q");
const pStart = base.indexOf("-", 4) + 1;
const cStart = base.lastIndexOf("-") + 1;
const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const wrapB = (f: object) => _unsafe.wrapBytes("B", _unsafe.payload("B", { ...bBasic, ...f }));
const wrapK = (f: object) => _unsafe.wrapBytes("K", _unsafe.payload("K", { ...kBasic, ...f }));
const wrapPackBody = (bytes: number[]) => _unsafe.wrapBytes("P", bytes);
const packBody = (f: object) => _unsafe.payload("P", { ...packThree, ...f });

const padBitsCode = (() => {
  for (const v of codes) {
    const [, t, p] = v.code.split("-") as [string, string, string];
    if (p.length * 5 - base32Decode(p).length * 8 > 0)
      return wrapPayload(t, p.slice(0, -1) + ALPHABET[ALPHABET.indexOf(p.at(-1)!) + 1]);
  }
  throw new Error("no vector with pad bits");
})();

const goodPack = _unsafe.packBytes(packBody({}));
const invalid: { name: string; code: string; error: string }[] = [
  // FORMAT
  { name: "empty", code: "", error: "FORMAT" },
  { name: "whitespace only", code: " \n\t ", error: "FORMAT" },
  { name: "chatter", code: "anyone up for BGs?", error: "FORMAT" },
  { name: "missing version digits", code: "BL-B-00-0000", error: "FORMAT" },
  { name: "only two parts", code: "BL1-B-0000", error: "FORMAT" },
  { name: "four parts on a B code", code: "BL1-B-00-00-0000", error: "FORMAT" },
  { name: "empty payload", code: "BL1-B--0000", error: "FORMAT" },
  { name: "check too short", code: "BL1-B-00-000", error: "FORMAT" },
  { name: "check too long", code: "BL1-B-00-00000", error: "FORMAT" },
  { name: "U is not in the alphabet", code: replaceAt(base, pStart + 2, "U"), error: "FORMAT" },
  { name: "non-ASCII character", code: replaceAt(base, pStart + 2, "Ä"), error: "FORMAT" },
  { name: "punctuation in payload", code: replaceAt(base, pStart + 2, "*"), error: "FORMAT" },
  { name: "impossible payload length (1 char)", code: wrapPayload("K", "0"), error: "FORMAT" },
  { name: "impossible payload length (3 chars)", code: wrapPayload("K", "000"), error: "FORMAT" },
  { name: "non-zero pad bits", code: padBitsCode, error: "FORMAT" },
  { name: "bad part marker", code: wrapPayload("P", "00", "1F3"), error: "FORMAT" },
  { name: "part marker with leading zero", code: wrapPayload("P", "00", "01OF3"), error: "FORMAT" },
  // VERSION
  { name: "future version BL2", code: base.replace(/^BL1/, "BL2"), error: "VERSION" },
  { name: "version BL0", code: "BL0-K-00-0000", error: "VERSION" },
  { name: "version BL10", code: "BL10-K-00-0000", error: "VERSION" },
  { name: "version with leading zero", code: base.replace(/^BL1/, "BL01"), error: "VERSION" },
  { name: "lowercase future version", code: "bl2-b-00-0000", error: "VERSION" },
  // TYPE
  { name: "unknown type", code: "BL1-X-00-0000", error: "TYPE" },
  { name: "two-letter type", code: "BL1-BK-00-0000", error: "TYPE" },
  { name: "empty type", code: "BL1--00-0000", error: "TYPE" },
  { name: "type is checked before the alphabet", code: "BL1-X-0U-0000", error: "TYPE" },
  // CHECKSUM
  { name: "bad checksum", code: replaceAt(base, base.length - 1, other(base.at(-1)!)), error: "CHECKSUM" },
  { name: "one payload char changed", code: replaceAt(base, pStart + 5, other(base[pStart + 5]!)), error: "CHECKSUM" },
  {
    name: "adjacent chars transposed",
    code: (() => {
      for (let i = pStart; i < cStart - 2; i++) if (base[i] !== base[i + 1]) return base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2);
      throw new Error("no pair");
    })(),
    error: "CHECKSUM",
  },
  { name: "truncated (5 middle chars missing)", code: base.slice(0, pStart + 10) + base.slice(pStart + 15), error: "CHECKSUM" },
  { name: "type letter changed B->K", code: base.replace(/^BL1-B-/, "BL1-K-"), error: "CHECKSUM" },
  { name: "check out of range", code: base.slice(0, cStart) + "ZZZZ", error: "CHECKSUM" },
  // SCHEMA
  { name: "schema 0", code: _unsafe.wrapBytes("K", [0, ..._unsafe.payload("K", kBasic).slice(1)]), error: "SCHEMA" },
  // FACTION
  { name: "same faction B", code: wrapB({ targetFaction: 1, posterFaction: 1 }), error: "FACTION" },
  { name: "faction 0", code: wrapK({ killerFaction: 0 }), error: "FACTION" },
  { name: "faction 3", code: wrapB({ targetFaction: 3 }), error: "FACTION" },
  { name: "faction 3 in a pack entry", code: wrapPackBody(_unsafe.packBytes(packBody({ bounties: [{ ...packThree.bounties[0]!, targetFaction: 3 }] }))), error: "FACTION" },
  // PAYLOAD
  { name: "trailing byte at schema 1", code: _unsafe.wrapBytes("K", [..._unsafe.payload("K", kBasic), 0]), error: "PAYLOAD" },
  { name: "truncated bytes (valid checksum)", code: _unsafe.wrapBytes("K", _unsafe.payload("K", kBasic).slice(0, -1)), error: "PAYLOAD" },
  { name: "schema byte only", code: _unsafe.wrapBytes("L", [1]), error: "PAYLOAD" },
  { name: "B payload under an L type", code: _unsafe.wrapBytes("L", _unsafe.payload("B", bBasic)), error: "PAYLOAD" },
  { name: "B mode 2", code: wrapB({ mode: 2 }), error: "PAYLOAD" },
  { name: "B new bounty with an existing id", code: wrapB({ mode: 0, existingBountyId: 5 }), error: "PAYLOAD" },
  { name: "B add-to with no existing id", code: wrapB({ mode: 1, existingBountyId: 0 }), error: "PAYLOAD" },
  { name: "K unknown flag bit at schema 1", code: wrapK({ flags: 4 }), error: "PAYLOAD" },
  { name: "note over 80 bytes", code: wrapB({ note: "n".repeat(81) }), error: "PAYLOAD" },
  { name: "board tag with U", code: wrapK({ boardTag: "K7QU" }), error: "PAYLOAD" },
  { name: "board tag lowercase", code: wrapK({ boardTag: "k7qf" }), error: "PAYLOAD" },
  { name: "raw GUID that should be compact", code: wrapK({ victimGUID: ascii("Player-1-00000001") }), error: "PAYLOAD" },
  { name: "empty raw GUID", code: wrapK({ victimGUID: [] }), error: "PAYLOAD" },
  { name: "unknown GUID form", code: wrapK({ victimGUID: { form: 2 } }), error: "PAYLOAD" },
  { name: "compact GUID cut short", code: _unsafe.wrapBytes("K", _unsafe.payload("K", kBasic).slice(0, 12)), error: "PAYLOAD" },
  { name: "invalid UTF-8", code: wrapK({ killerName: [0xc3, 0x28] }), error: "PAYLOAD" },
  { name: "overlong UTF-8", code: wrapK({ killerName: [0xc0, 0xaf] }), error: "PAYLOAD" },
  { name: "UTF-8 surrogate", code: wrapK({ killerName: [0xed, 0xa0, 0x80] }), error: "PAYLOAD" },
  { name: "UTF-8 above U+10FFFF", code: wrapK({ killerName: [0xf4, 0x90, 0x80, 0x80] }), error: "PAYLOAD" },
  { name: "UTF-8 truncated sequence", code: wrapK({ killerName: [0xe2, 0x98] }), error: "PAYLOAD" },
  { name: "pack rewardMin above rewardMax", code: wrapPackBody(_unsafe.packBytes(packBody({ rewardMin: 500, rewardMax: 100 }))), error: "PAYLOAD" },
  { name: "pack not compressed", code: wrapPackBody(packBody({})), error: "PAYLOAD" },
  { name: "pack with a bad zlib header", code: wrapPackBody([0x78, 0x00, ...goodPack.slice(2)]), error: "PAYLOAD" },
  { name: "pack with a bad Adler-32", code: wrapPackBody([...goodPack.slice(0, -1), goodPack.at(-1)! ^ 1]), error: "PAYLOAD" },
  { name: "pack with corrupt deflate data", code: wrapPackBody([...goodPack.slice(0, 2), 0xff, 0xff, 0xff, 0xff, ...goodPack.slice(-4)]), error: "PAYLOAD" },
  { name: "pack count larger than contents", code: wrapPackBody(_unsafe.packBytes([...packBody({ bounties: [] }).slice(0, -2), 0, 5])), error: "PAYLOAD" },
];
for (const v of invalid) {
  const r = decode(v.code);
  assert(!r.ok && r.error === v.error, `invalid "${v.name}" gives ${r.ok ? "ok" : r.error}, expected ${v.error}`);
}

// ---------------------------------------------------------------- multi-part packs

const SMALL = 160; // force parts with a short max length
const parts = encodePack(packThree, SMALL);
assert(parts.length >= 3, "expected at least 3 parts");
const otherParts = encodePack({ ...packThree, packVersion: packThree.packVersion + 1, bounties: packThree.bounties.slice(0, 2).concat(packThree.bounties.slice(0, 1)) }, SMALL);
const join = (xs: string[]) => xs.join("\n");
const reversed = [...parts].reverse();
type PackCase = { name: string; input: string; fields?: BountyPack; error?: string; received?: number[]; total?: number };
const packs: PackCase[] = [
  { name: "single-part pack", input: code("P three bounties"), fields: packThree },
  { name: "parts in order, one per line", input: join(parts), fields: packThree },
  { name: "parts reversed, backticks, lowercase", input: reversed.map((p) => "`" + p.toLowerCase() + "`").join(" "), fields: packThree },
  { name: "a part pasted twice", input: join([parts[0]!, ...parts]), fields: packThree },
  { name: "missing a part", input: join([parts[0]!, parts[2]!]), error: "INCOMPLETE", received: [1, 3], total: parts.length },
  { name: "one part only", input: parts[1]!, error: "INCOMPLETE", received: [2], total: parts.length },
  { name: "parts with different totals", input: join([parts[0]!, wrapPayload("P", "00", "2OF9")]), error: "PARTS" },
  { name: "whole pack mixed with parts", input: join([code("P empty pack"), parts[1]!]), error: "PARTS" },
  { name: "two different versions of a part", input: join([parts[0]!, ...parts.slice(1), wrapPayload("P", "00", `1OF${parts.length}`)]), error: "PARTS" },
  { name: "part number above total", input: wrapPayload("P", "00", "4OF3"), error: "PARTS" },
  { name: "B code pasted as a pack", input: base, error: "TYPE" },
  { name: "junk before the code", input: "pack: " + parts[0], error: "FORMAT" },
  { name: "one corrupted part", input: join([parts[0]!, replaceAt(parts[1]!, 12, other(parts[1]![12]!)), parts[2]!]), error: "CHECKSUM" },
];
if (otherParts.length === parts.length) {
  packs.push({ name: "parts from two different packs", input: join([parts[0]!, otherParts[1]!, ...parts.slice(2)]), error: "" });
}
for (const p of packs) {
  const r = decodePack(p.input);
  if (p.error === "") p.error = r.ok ? "" : r.error; // whatever the reference says; Lua must agree
  if (p.fields) assert(r.ok && JSON.stringify(r.fields) === JSON.stringify(p.fields), `pack "${p.name}" should decode`);
  else assert(!r.ok && r.error === p.error, `pack "${p.name}" gives ${r.ok ? "ok" : r.error}, expected ${p.error}`);
}
assert(packs.at(-1)!.error !== "", "mixed packs must be rejected");
// A part code is not a standalone code.
invalid.push({ name: "pack part passed to decode()", code: parts[0]!, error: "PARTS" });
assert(!decode(parts[0]!).ok, "part should not decode alone");

// ---------------------------------------------------------------- encode errors

const encodeErrors: { name: string; type: string; fields: unknown }[] = [
  { name: "unknown type", type: "X", fields: bBasic },
  { name: "P through encode()", type: "P", fields: packEmpty },
  { name: "fields not an object", type: "B", fields: "nope" },
  { name: "missing field", type: "B", fields: { ...bBasic, rewardGold: undefined } },
  { name: "schema 2", type: "B", fields: { ...bBasic, schema: 2 } },
  { name: "negative reward", type: "B", fields: { ...bBasic, rewardGold: -1 } },
  { name: "fractional reward", type: "B", fields: { ...bBasic, rewardGold: 1.5 } },
  { name: "reward over 32 bits", type: "B", fields: { ...bBasic, rewardGold: 4294967296 } },
  { name: "reward as string", type: "B", fields: { ...bBasic, rewardGold: "500" } },
  { name: "level over 255", type: "B", fields: { ...bBasic, targetLevel: 256 } },
  { name: "mapID over 16 bits", type: "B", fields: { ...bBasic, mapID: 65536 } },
  { name: "same faction", type: "B", fields: { ...bBasic, posterFaction: 2 } },
  { name: "faction 3", type: "B", fields: { ...bBasic, targetFaction: 3 } },
  { name: "mode 2", type: "B", fields: { ...bBasic, mode: 2 } },
  { name: "add-to without id", type: "B", fields: { ...bBasic, mode: 1, existingBountyId: 0 } },
  { name: "board tag with 3 chars", type: "K", fields: { ...kBasic, boardTag: "K7Q" } },
  { name: "board tag lowercase", type: "K", fields: { ...kBasic, boardTag: "k7qf" } },
  { name: "board tag empty", type: "K", fields: { ...kBasic, boardTag: "" } },
  { name: "unknown flag bit", type: "K", fields: { ...kBasic, flags: 4 } },
  { name: "name as number", type: "K", fields: { ...kBasic, killerName: 42 } },
  { name: "empty GUID", type: "K", fields: { ...kBasic, victimGUID: "" } },
  { name: "GUID over 255 bytes (never truncated)", type: "K", fields: { ...kBasic, victimGUID: "Creature-" + "9".repeat(250) } },
  { name: "L faction 0", type: "L", fields: { ...lBasic, faction: 0 } },
];
for (const v of encodeErrors) {
  let threw = false;
  try {
    encode(v.type as CodeType, v.fields);
  } catch {
    threw = true;
  }
  assert(threw, `encode error "${v.name}" did not throw`);
}

// ---------------------------------------------------------------- primitives

const crc = [
  { input: "123456789", crc: "29B1" },
  { input: "", crc: "FFFF" },
];
const base32 = [
  { hex: "", b32: "" },
  { hex: "00", b32: "00" },
  { hex: "FF", b32: "ZW" },
  { hex: "48656C6C6F", b32: "91JPRV3F" },
  { hex: "0000000000", b32: "00000000" },
  { hex: "FFFFFFFFFF", b32: "ZZZZZZZZ" },
];
const adler = [
  { input: "Wikipedia", adler: "11E60398" }, // standard reference value
  { input: "z".repeat(1000), adler: adler32([..."z".repeat(1000)].map((c) => c.charCodeAt(0))).toString(16).toUpperCase().padStart(8, "0") },
];
assert(adler32([..."Wikipedia"].map((c) => c.charCodeAt(0))) === 0x11e60398, "adler reference");
for (const c of crc) assert(crc16(c.input).toString(16).toUpperCase().padStart(4, "0") === c.crc, `crc ${c.input}`);
for (const b of base32) assert(base32Encode((b.hex.match(/../g) ?? []).map((h) => parseInt(h, 16))) === b.b32, `base32 ${b.hex}`);
assert(normalize(" `a b` ") === "AB", "normalize");

// ---------------------------------------------------------------- write (frozen: never change an existing vector)

const file = {
  $comment:
    "BL1 codec test vectors (docs/compendium/02-Code-Format-Spec.md). FROZEN: add vectors, never change them. Both worker (vitest) and addon (addon/tests/run.lua) must pass every entry. Regenerate with `npm run vectors` in worker/.",
  crc16: crc,
  adler32: adler,
  base32,
  codes,
  forwardCompat,
  normalization,
  invalid,
  packs: { maxLength: SMALL, parts, cases: packs },
  encodeErrors,
};

if (existsSync(OUT) && !process.argv.includes("--force")) {
  const old = JSON.parse(readFileSync(OUT, "utf8"));
  if (Array.isArray(old.codes) && old.codes[0]?.fields?.schema !== undefined) {
    for (const o of old.codes as { name: string; code: string }[]) {
      const n = codes.find((c) => c.name === o.name);
      assert(n && n.code === o.code, `frozen vector "${o.name}" changed or was removed (pass --force only if no code has shipped)`);
    }
  }
}
writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
console.log(`wrote ${OUT}: ${codes.length} codes, ${forwardCompat.length} forward-compat, ${normalization.length} normalization, ${invalid.length} invalid, ${packs.length} pack cases, ${encodeErrors.length} encode errors`);
