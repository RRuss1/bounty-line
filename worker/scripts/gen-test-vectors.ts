/**
 * Regenerates shared/test-vectors.json.
 *
 *   npm run vectors      (from worker/)
 *
 * The valid codes come from the TS encoder, so on their own they only prove TS
 * agrees with itself. The cross-check is the Lua suite (addon/tests/run.lua),
 * which encodes the same data independently and must produce identical codes.
 * The primitive vectors (CRC, base32, varint) are hand-checkable references.
 *
 * Once a code ships to players, never change its vector: old codes pasted from
 * old addon versions must keep decoding. Add new vectors instead.
 */
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ALPHABET,
  base32Decode,
  base32Encode,
  crc16,
  decode,
  encode,
  encodePayload,
  wrapPayload,
  Writer,
  type BountyPack,
  type BountyPost,
  type CodeType,
  type KillClaim,
} from "../src/codec";

const OUT = fileURLToPath(new URL("../../shared/test-vectors.json", import.meta.url));

// ---------------------------------------------------------------- valid data

const bountyBasic: BountyPost = {
  boardTag: "K7QF",
  targetGuid: "Player-4395-0A1B2C3D",
  targetName: "Grimlok Ashveil",
  classId: 1,
  raceId: 2,
  level: 42,
  targetFaction: "Horde",
  reward: 500,
  posterGuid: "Player-4395-00F00BA4",
  posterName: "Thalia Brightwind",
  posterFaction: "Alliance",
  zoneMapId: 1434,
  timestamp: 1795190400,
  nonce: 4242,
  note: "",
};

const bountyUnicode: BountyPost = {
  boardTag: "",
  targetGuid: "Player-1-FFFFFFFF",
  targetName: "Zoë Brightblade",
  classId: 8,
  raceId: 7,
  level: 60,
  targetFaction: "Alliance",
  reward: 1,
  posterGuid: "Player-4294967295-00000000",
  posterName: "Ælfric Stormcrow",
  posterFaction: "Horde",
  zoneMapId: 1440,
  timestamp: 1795276800,
  nonce: 0,
  note: "Camped me at the flight master ☠ twice",
};

const bountyEdges: BountyPost = {
  boardTag: "ZZZZ",
  targetGuid: "Player-4395-0a1b2c3d", // lowercase hex: not canonical, so stored raw
  targetName: "",
  classId: 0,
  raceId: 0,
  level: 0,
  targetFaction: "Horde",
  reward: 4294967295,
  posterGuid: "Player-0042-0A1B2C3D", // leading zero in server id: stored raw
  posterName: "x".repeat(255),
  posterFaction: "Alliance",
  zoneMapId: 0,
  timestamp: 4294967295,
  nonce: 65535,
  note: "😀",
};

const killBasic: KillClaim = {
  boardTag: "K7QF",
  bountyId: 12,
  victimGuid: "Player-4395-0A1B2C3D",
  killerGuid: "Player-4395-01234567",
  killerName: "Hunter McHunterface",
  timestamp: 1795295647,
  zoneMapId: 1434,
  honorCorroborated: true,
  nonce: 513,
};

const killNoHonor: KillClaim = {
  boardTag: "",
  bountyId: 300,
  victimGuid: "Creature-0-4395-0-12-448-0000ABCDEF", // not a player GUID: stored raw
  killerGuid: "Player-77-89ABCDEF",
  killerName: "Ånund Ironside",
  timestamp: 1795300000,
  zoneMapId: 1429,
  honorCorroborated: false,
  nonce: 65535,
};

const packEmpty: BountyPack = { boardTag: "K7QF", packVersion: 1795190400, discordName: "WoW Forever", bounties: [] };

const packThree: BountyPack = {
  boardTag: "K7QF",
  packVersion: 1795300123,
  discordName: "Les Chasseurs de Primes ⚔",
  bounties: [
    {
      id: 12,
      targetGuid: "Player-4395-0A1B2C3D",
      targetName: "Grimlok Ashveil",
      classId: 1,
      targetFaction: "Horde",
      reward: 500,
      posterGuid: "Player-4395-00F00BA4",
      posterName: "Thalia Brightwind",
      expiresAt: 1796400000,
    },
    {
      id: 13,
      targetGuid: "Player-4395-1B2C3D4E",
      targetName: "Mograth Skullsplitter",
      classId: 9,
      targetFaction: "Horde",
      reward: 10000,
      posterGuid: "Player-4395-01234567",
      posterName: "Hunter McHunterface",
      expiresAt: 1796486400,
    },
    {
      id: 1000,
      targetGuid: "Player-11-2C3D4E5F",
      targetName: "Zoë Brightblade",
      classId: 8,
      targetFaction: "Alliance",
      reward: 2500,
      posterGuid: "Player-11-99999999",
      posterName: "Ælfric Stormcrow",
      expiresAt: 1796572800,
    },
  ],
};

const valid: { name: string; type: CodeType; data: unknown }[] = [
  { name: "B basic", type: "B", data: bountyBasic },
  { name: "B unicode, no board tag, note, 1g", type: "B", data: bountyUnicode },
  { name: "B edge values, raw GUIDs, 255-byte name", type: "B", data: bountyEdges },
  { name: "K basic, honor corroborated", type: "K", data: killBasic },
  { name: "K no honor, non-player victim GUID", type: "K", data: killNoHonor },
  { name: "P empty pack", type: "P", data: packEmpty },
  { name: "P three bounties", type: "P", data: packThree },
];

const validOut = valid.map((v) => ({ ...v, code: encode(v.type, v.data) }));

// ---------------------------------------------------------------- normalization

const base = validOut[0]!.code;
const kCode = validOut[3]!.code;
const [, , kPayload, kCheck] = kCode.split("-") as [string, string, string, string];

function crockfordTypos(code: string): string {
  const [v, t, p, c] = code.split("-") as [string, string, string, string];
  const swap = (s: string) => s.replace(/0/g, "O").replace(/1/, "I").replace(/1/, "l");
  return [v, t, swap(p), swap(c)].join("-");
}
const typoInput = crockfordTypos(base);
if (!/[OIl]/.test(typoInput.slice(7))) throw new Error("pick a base vector containing 0 or 1 in its payload");

const normalize = [
  { name: "lowercase", input: base.toLowerCase(), code: base },
  { name: "surrounding whitespace", input: `  \t${base}\r\n`, code: base },
  {
    name: "whitespace and line breaks inside",
    input: `${base.slice(0, 10)} ${base.slice(10, 30)}\n${base.slice(30, 50)}\r\n\t${base.slice(50)}`,
    code: base,
  },
  { name: "Crockford typos O->0, I/l->1", input: typoInput, code: base },
  { name: "mixed case K code", input: `bl1-k-${kPayload.toLowerCase()}-${kCheck}`, code: kCode },
];

// ---------------------------------------------------------------- invalid inputs

function replaceAt(s: string, i: number, ch: string): string {
  return s.slice(0, i) + ch + s.slice(i + 1);
}
const otherChar = (ch: string) => (ch === "Q" ? "R" : "Q");
const payloadStart = base.indexOf("-", 4) + 1;
const checkStart = base.lastIndexOf("-") + 1;

/** Wraps raw bytes in a code with a correct checksum, so only the payload is bad. */
const wrapBytes = (type: CodeType, bytes: number[]) => wrapPayload(type, base32Encode(bytes));

/** A K payload with overridable byte segments. */
function kBytes(over: Partial<Record<"tag" | "bountyId" | "victim" | "name" | "bool", number[]>>): number[] {
  const w = new Writer();
  const push = (b: number[]) => w.bytes.push(...b);
  const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
  push(over.tag ?? [4, ...ascii("K7QF")]);
  push(over.bountyId ?? [12]);
  push(over.victim ?? [0, 0xab, 0x22, 0x0a, 0x1b, 0x2c, 0x3d]); // Player-4395-0A1B2C3D
  push([0, 0xab, 0x22, 0x01, 0x23, 0x45, 0x67]); // killer Player-4395-01234567
  push(over.name ?? [4, ...ascii("Rich")]);
  w.varint(1795295647); // timestamp
  w.varint(1434); // zone
  push(over.bool ?? [1]);
  push([0x02, 0x01]); // nonce
  return w.bytes;
}
// Sanity: the unmodified builder must decode cleanly.
{
  const r = decode(wrapBytes("K", kBytes({})));
  if (!r.ok) throw new Error(`kBytes baseline is broken: ${r.message}`);
}

const ascii = (s: string) => [...s].map((c) => c.charCodeAt(0));
const pBytesBadFaction = (() => {
  const b = encodePayload("P", { ...packThree, bounties: [packThree.bounties[0]!] });
  // Layout: tag(5) packVersion(5) discordName(len+bytes) count(1) id(1) guid(7) name(len+15) classId(1) faction
  const nameLen = b[10]!;
  const factionAt = 10 + 1 + nameLen + 1 + 1 + 7 + 1 + 15 + 1;
  if (b[factionAt] !== 1) throw new Error("faction offset is wrong");
  b[factionAt] = 2;
  return b;
})();

// Payload text with non-zero pad bits: find a vector whose last char carries pad bits and set the lowest one.
const padBitsCode = (() => {
  for (const v of validOut) {
    const [, t, p] = v.code.split("-") as [string, CodeType, string];
    const padBits = p.length * 5 - base32Decode(p).length * 8;
    if (padBits > 0) {
      const last = ALPHABET.indexOf(p[p.length - 1]!);
      return wrapPayload(t, p.slice(0, -1) + ALPHABET[last + 1]);
    }
  }
  throw new Error("no vector with pad bits");
})();

const invalid: { name: string; input: string; error: string }[] = [
  { name: "empty", input: "", error: "format" },
  { name: "whitespace only", input: " \n\t ", error: "format" },
  { name: "chatter", input: "anyone up for BGs?", error: "format" },
  { name: "missing version digits", input: "BL-B-00-0000", error: "format" },
  { name: "only two parts", input: "BL1-B-0000", error: "format" },
  { name: "four parts", input: "BL1-B-00-0000-0000", error: "format" },
  { name: "empty payload", input: "BL1-B--0000", error: "format" },
  { name: "check too short", input: "BL1-B-00-000", error: "format" },
  { name: "check too long", input: "BL1-B-00-00000", error: "format" },
  { name: "U is not in the alphabet", input: replaceAt(base, payloadStart + 2, "U"), error: "format" },
  { name: "non-ASCII character", input: replaceAt(base, payloadStart + 2, "Ä"), error: "format" },
  { name: "punctuation in payload", input: replaceAt(base, payloadStart + 2, "*"), error: "format" },
  { name: "payload with impossible length (1 char)", input: wrapPayload("K", "0"), error: "format" },
  { name: "payload with impossible length (3 chars)", input: wrapPayload("K", "000"), error: "format" },
  { name: "non-zero pad bits", input: padBitsCode, error: "format" },
  { name: "future version BL2", input: base.replace(/^BL1/, "BL2"), error: "version" },
  { name: "version BL0", input: "BL0-K-00-0000", error: "version" },
  { name: "version BL10", input: "BL10-K-00-0000", error: "version" },
  { name: "version with leading zero BL01", input: base.replace(/^BL1/, "BL01"), error: "version" },
  { name: "lowercase future version", input: "bl2-b-00-0000", error: "version" },
  { name: "unknown type X", input: "BL1-X-00-0000", error: "type" },
  { name: "two-letter type", input: "BL1-BK-00-0000", error: "type" },
  { name: "empty type", input: "BL1--00-0000", error: "type" },
  { name: "type check precedes alphabet check", input: "BL1-X-0U-0000", error: "type" },
  { name: "one payload char changed", input: replaceAt(base, payloadStart + 5, otherChar(base[payloadStart + 5]!)), error: "checksum" },
  { name: "one check char changed", input: replaceAt(base, checkStart, otherChar(base[checkStart]!)), error: "checksum" },
  {
    name: "adjacent chars transposed",
    input: (() => {
      for (let i = payloadStart; i < checkStart - 2; i++)
        if (base[i] !== base[i + 1]) return base.slice(0, i) + base[i + 1] + base[i] + base.slice(i + 2);
      throw new Error("no transposable pair");
    })(),
    error: "checksum",
  },
  { name: "truncated payload (last 3 chars dropped)", input: base.slice(0, checkStart - 4) + base.slice(checkStart - 1), error: "checksum" },
  { name: "type letter changed B->K", input: base.replace(/^BL1-B-/, "BL1-K-"), error: "checksum" },
  { name: "check out of range", input: base.slice(0, checkStart) + "ZZZZ", error: "checksum" },
  { name: "trailing byte", input: wrapBytes("K", [...kBytes({}), 0]), error: "payload" },
  { name: "truncated bytes (valid checksum)", input: wrapBytes("K", kBytes({}).slice(0, -1)), error: "payload" },
  { name: "truncated mid-string", input: wrapBytes("K", [4, ...ascii("K7")]), error: "payload" },
  { name: "B payload under a P type", input: wrapBytes("P", encodePayload("B", bountyBasic)), error: "payload" },
  { name: "non-minimal varint", input: wrapBytes("K", kBytes({ bountyId: [0x8c, 0x00] })), error: "payload" },
  { name: "varint over 32 bits", input: wrapBytes("K", kBytes({ bountyId: [0xff, 0xff, 0xff, 0xff, 0x1f] })), error: "payload" },
  { name: "varint longer than 5 bytes", input: wrapBytes("K", kBytes({ bountyId: [0x80, 0x80, 0x80, 0x80, 0x80, 0x01] })), error: "payload" },
  { name: "string over 255 bytes", input: wrapBytes("K", kBytes({ name: [0x80, 0x02, ...new Array(256).fill(0x61)] })), error: "payload" },
  { name: "invalid UTF-8", input: wrapBytes("K", kBytes({ name: [2, 0xc3, 0x28] })), error: "payload" },
  { name: "overlong UTF-8", input: wrapBytes("K", kBytes({ name: [2, 0xc0, 0xaf] })), error: "payload" },
  { name: "UTF-8 surrogate", input: wrapBytes("K", kBytes({ name: [3, 0xed, 0xa0, 0x80] })), error: "payload" },
  { name: "UTF-8 above U+10FFFF", input: wrapBytes("K", kBytes({ name: [4, 0xf4, 0x90, 0x80, 0x80] })), error: "payload" },
  { name: "UTF-8 truncated sequence", input: wrapBytes("K", kBytes({ name: [2, 0xe2, 0x98] })), error: "payload" },
  { name: "board tag with 3 chars", input: wrapBytes("K", kBytes({ tag: [3, ...ascii("K7Q")] })), error: "payload" },
  { name: "board tag with U", input: wrapBytes("K", kBytes({ tag: [4, ...ascii("K7QU")] })), error: "payload" },
  { name: "board tag lowercase", input: wrapBytes("K", kBytes({ tag: [4, ...ascii("k7qf")] })), error: "payload" },
  { name: "unknown GUID tag", input: wrapBytes("K", kBytes({ victim: [2] })), error: "payload" },
  { name: "raw GUID that should be compact", input: wrapBytes("K", kBytes({ victim: [1, 17, ...ascii("Player-1-00000001")] })), error: "payload" },
  { name: "boolean value 2", input: wrapBytes("K", kBytes({ bool: [2] })), error: "payload" },
  { name: "faction value 2", input: wrapBytes("P", pBytesBadFaction), error: "payload" },
  { name: "pack count larger than contents", input: wrapBytes("P", [...encodePayload("P", packEmpty).slice(0, -1), 5]), error: "payload" },
];

for (const v of invalid) {
  const r = decode(v.input);
  if (r.ok || r.error !== v.error) throw new Error(`invalid vector "${v.name}" gives ${r.ok ? "ok" : r.error}, expected ${v.error}`);
}

// ---------------------------------------------------------------- encode errors

const encodeErrors: { name: string; type: string; data: unknown }[] = [
  { name: "unknown type", type: "X", data: bountyBasic },
  { name: "data is not an object", type: "B", data: "nope" },
  { name: "missing field", type: "B", data: { ...bountyBasic, reward: undefined } },
  { name: "negative reward", type: "B", data: { ...bountyBasic, reward: -1 } },
  { name: "fractional reward", type: "B", data: { ...bountyBasic, reward: 1.5 } },
  { name: "reward over 32 bits", type: "B", data: { ...bountyBasic, reward: 4294967296 } },
  { name: "reward as string", type: "B", data: { ...bountyBasic, reward: "500" } },
  { name: "nonce over 16 bits", type: "B", data: { ...bountyBasic, nonce: 65536 } },
  { name: "neutral faction", type: "B", data: { ...bountyBasic, targetFaction: "Neutral" } },
  { name: "name over 255 bytes", type: "B", data: { ...bountyBasic, targetName: "é".repeat(128) } },
  { name: "board tag with 3 chars", type: "K", data: { ...killBasic, boardTag: "K7Q" } },
  { name: "board tag lowercase", type: "K", data: { ...killBasic, boardTag: "k7qf" } },
  { name: "board tag with I", type: "K", data: { ...killBasic, boardTag: "K7QI" } },
  { name: "honor as number", type: "K", data: { ...killBasic, honorCorroborated: 1 } },
  { name: "GUID as number", type: "K", data: { ...killBasic, victimGuid: 12345 } },
  { name: "bounties not an array", type: "P", data: { ...packEmpty, bounties: "none" } },
  { name: "bad pack entry", type: "P", data: { ...packEmpty, bounties: [{ ...packThree.bounties[0]!, reward: -5 }] } },
];

for (const v of encodeErrors) {
  let threw = false;
  try {
    encode(v.type as CodeType, v.data);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error(`encode error vector "${v.name}" did not throw`);
}

// ---------------------------------------------------------------- primitives (hand-checkable)

const primitives = {
  crc16: [
    { ascii: "", crc: 0xffff },
    { ascii: "123456789", crc: 0x29b1 }, // standard CRC-16/CCITT-FALSE check value
  ],
  base32: [
    { hex: "", text: "" },
    { hex: "00", text: "00" },
    { hex: "FF", text: "ZW" },
    { hex: "48656C6C6F", text: "91JPRV3F" }, // "Hello"
    { hex: "0000000000", text: "00000000" },
    { hex: "FFFFFFFFFF", text: "ZZZZZZZZ" },
    { hex: "0102030405060708", text: "041061050R3GG" },
  ],
  varint: [
    { value: 0, hex: "00" },
    { value: 1, hex: "01" },
    { value: 127, hex: "7F" },
    { value: 128, hex: "8001" },
    { value: 300, hex: "AC02" },
    { value: 16384, hex: "808001" },
    { value: 4294967295, hex: "FFFFFFFF0F" },
  ],
};
for (const b of primitives.base32) {
  const bytes = (b.hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
  if (base32Encode(bytes) !== b.text) throw new Error(`base32 reference "${b.hex}" mismatch: ${base32Encode(bytes)}`);
}
if (crc16("123456789") !== 0x29b1) throw new Error("CRC reference mismatch");

// ---------------------------------------------------------------- write

const file = {
  $comment:
    "Shared codec test vectors. Both addon/tests/run.lua and worker/test/codec.test.ts must pass every entry. Regenerate with `npm run vectors` in worker/. Format: shared/CODEC.md.",
  format: "BL1",
  primitives,
  valid: validOut,
  normalize,
  invalid,
  encodeErrors,
};
writeFileSync(OUT, JSON.stringify(file, null, 2) + "\n");
console.log(`wrote ${OUT}: ${validOut.length} valid, ${normalize.length} normalize, ${invalid.length} invalid, ${encodeErrors.length} encode errors`);
