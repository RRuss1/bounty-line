/**
 * Bounty Line code codec, format BL1. Reference implementation.
 *
 * The contract is docs/compendium/02-Code-Format-Spec.md. The Lua port
 * (addon/BountyLine/Codec.lua) must stay structurally parallel: same schemas,
 * same check order, same error codes. Both must pass shared/test-vectors.json.
 */
import { deflateSync, inflateSync } from "fflate";

export const PREFIX = "BL1";
/** The first schema of every code type. K and P also have a schema 2 (Open Season): see SCHEMAS. */
export const SCHEMA = 1;
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Longest single code the bot posts; longer packs are split into parts. */
export const MAX_CODE_LENGTH = 3800;
export const MAX_PARTS = 8;
/** Upper bound on a decompressed pack, as a guard against deflate bombs. */
const MAX_PACK_BYTES = 262144;

export const FACTION = { Alliance: 1, Horde: 2 } as const;

export type CodeType = "B" | "K" | "P" | "L" | "S" | "W";
export type ErrorCode =
  | "FORMAT"
  | "VERSION"
  | "TYPE"
  | "CHECKSUM"
  | "SCHEMA"
  | "PAYLOAD"
  | "FACTION"
  | "PARTS"
  | "INCOMPLETE";

export interface BountyPost {
  schema: number;
  boardTag: string;
  targetGUID: string;
  targetName: string;
  targetClassID: number;
  targetRaceID: number;
  targetLevel: number;
  targetFaction: number;
  posterFaction: number;
  rewardGold: number;
  posterGUID: string;
  posterName: string;
  mapID: number;
  createdAt: number;
  nonce: number;
  note: string;
  /** 0 = new bounty, 1 = add to existing */
  mode: number;
  existingBountyId: number;
  /** Schema 2 only (the Expand section, spec 5.4c): how many kills the reward buys, 1 to 10. */
  kills?: number;
  /** Schema 2: 0 = each kill pays its share, 1 = one hunter must land every kill. */
  payout?: number;
  /** Schema 2: 0 = the server's default length, or 7, 14 or 28 days. */
  days?: number;
  /** Schema 2: bonuses and restrictions, at most MAX_TERMS, one of each kind. */
  terms?: BountyTerm[];
}

/** One bonus (gold > 0) or restriction (gold = 0) on a bounty. Kinds: TERM. */
export interface BountyTerm {
  kind: number;
  value: number;
  gold: number;
}

/** Bounty term kinds (Compendium 02 Section 3.1). Bonuses are below 64, restrictions from 65. */
export const TERM = {
  zoneBonus: 1, // value: mapID
  classBonus: 2, // value: the hunter's classID
  soloBonus: 3,
  underdogBonus: 4, // the hunter was a lower level than the target
  rushBonus: 5, // value: hours after the bounty was made
  insultBonus: 6, // /lol within 10 seconds of the kill
  zoneOnly: 65, // value: mapID
  classOnly: 66, // value: classID
  soloOnly: 67,
} as const;
export const MAX_TERMS = 8;
export const MAX_KILLS = 10;
export const BOUNTY_DAYS = [0, 7, 14, 28] as const;

/** K schema 3 facts bits. */
export const FACT = { solo: 1, insult: 2 } as const;

/** Which term kinds carry a value, and its range. */
function termValueOk(kind: number, value: number): boolean {
  switch (kind) {
    case TERM.zoneBonus:
    case TERM.zoneOnly:
      return value >= 1;
    case TERM.classBonus:
    case TERM.classOnly:
      return value >= 1 && value <= 30;
    case TERM.rushBonus:
      return value >= 1 && value <= 168;
    case TERM.soloBonus:
    case TERM.underdogBonus:
    case TERM.insultBonus:
    case TERM.soloOnly:
      return value === 0;
    default:
      return false;
  }
}

/** Rules for a B schema 2 code's extras. Returns a message, or null when they are fine. */
export function termsProblem(f: { mode: number; kills?: number; payout?: number; days?: number; terms?: BountyTerm[] }): string | null {
  if (f.kills === undefined) return null;
  const terms = f.terms ?? [];
  if (f.mode !== 0) return "adding gold carries no terms";
  if (f.kills < 1 || f.kills > MAX_KILLS) return `kills must be 1 to ${MAX_KILLS}`;
  if (f.payout !== 0 && f.payout !== 1) return "invalid payout";
  if (f.payout === 1 && f.kills < 2) return "all-or-nothing needs at least 2 kills";
  if (!(BOUNTY_DAYS as readonly number[]).includes(f.days ?? -1)) return "days must be 0, 7, 14 or 28";
  if (terms.length > MAX_TERMS) return `at most ${MAX_TERMS} terms`;
  const seen = new Set<number>();
  for (const t of terms) {
    if (seen.has(t.kind)) return "each term kind at most once";
    seen.add(t.kind);
    if (!termValueOk(t.kind, t.value)) return `invalid term ${t.kind}`;
    const bonus = t.kind < 64;
    if (bonus ? t.gold < 1 : t.gold !== 0) return bonus ? "a bonus needs gold" : "a restriction carries no gold";
  }
  return null;
}

export interface KillClaim {
  schema: number;
  boardTag: string;
  bountyId: number;
  victimGUID: string;
  killerGUID: string;
  killerName: string;
  killerFaction: number;
  killedAt: number;
  mapID: number;
  /** bit0 honorCorroborated, bit1 petKill */
  flags: number;
  nonce: number;
  /** Schema 2 (Open Season kills) only. 0 = no season matched. */
  seasonId?: number;
  victimName?: string;
  /** The victim's guild as the addon saw it; "" when it never saw it. The Bounty Board finds the season by it. */
  guildName?: string;
  /** 1 = the addon saw the victim in the season's guild; 0 = guild unknown, officers decide. */
  guildSeen?: number;
  /** Schema 3 only (kills on bounties with terms): the hunter's class and level, the victim's level (0 = unknown). */
  killerClassID?: number;
  killerLevel?: number;
  victimLevel?: number;
  /** Schema 3: FACT bits. bit0 not in a group, bit1 /lol within 10 seconds of the kill. */
  facts?: number;
}

export const SEASON_KIND = { pot: 1, pool: 2, open: 3 } as const;
export const SEASON_DAYS = [7, 14, 28] as const;

/** S: declares an Open Season on an enemy guild, or adds gold to one (mode 1). */
export interface SeasonPost {
  schema: number;
  boardTag: string;
  guildName: string;
  guildFaction: number;
  posterFaction: number;
  /** 1 per head + pot, 2 prize pool, 3 per head with no ceiling. 0 when mode = 1. */
  kind: number;
  perKillGold: number;
  /** The pot (kind 1), the pool (kind 2), 0 (kind 3), or the gold added (mode 1). */
  totalGold: number;
  /** 7, 14 or 28. 0 when mode = 1. */
  days: number;
  posterGUID: string;
  posterName: string;
  createdAt: number;
  nonce: number;
  /** 0 = new season, 1 = add gold to an existing one */
  mode: number;
  existingSeasonId: number;
  /** Schema 2 only: a prize pool pays out only if the season reaches this many kills (0 = none). */
  minKills?: number;
}

export interface PackSeason {
  seasonId: number;
  guildName: string;
  guildFaction: number;
  kind: number;
  perKillGold: number;
  /** Pot left (kind 1), the whole pool (kind 2), 0 (kind 3). */
  remainingGold: number;
  posterName: string;
  expiresAt: number;
}

/** A bounty set by name from Discord (/bl wanted, spec 5.12): no GUID until a kill locks it. */
export interface PackWanted {
  bountyId: number;
  targetName: string;
  targetFaction: number;
  rewardGold: number;
  posterName: string;
  expiresAt: number;
}

export interface CharacterLink {
  schema: number;
  boardTag: string;
  charGUID: string;
  charName: string;
  faction: number;
  guildName: string;
  createdAt: number;
  nonce: number;
}

/** One sighting of a wanted player, as guild sync carried it. */
export interface Sighting {
  bountyId: number;
  mapID: number;
  seenAt: number;
  /** Who saw them (character name), "" if unknown. */
  spotterName: string;
}

/** W: the latest sightings of wanted players, sent by a relay officer's addon (spec 5.10). */
export interface SightingReport {
  schema: number;
  boardTag: string;
  sentAt: number;
  nonce: number;
  sightings: Sighting[];
}

/** Most sightings in one W code: keeps its QR code small enough to read in a screenshot. */
export const MAX_SIGHTINGS = 8;

export interface PackEntry {
  bountyId: number;
  targetGUID: string;
  targetName: string;
  targetClassID: number;
  targetFaction: number;
  rewardGold: number;
  posterName: string;
  expiresAt: number;
}

export interface BountyPack {
  schema: number;
  boardTag: string;
  packVersion: number;
  minAddonVersion: number;
  discordDisplayName: string;
  rewardMin: number;
  rewardMax: number;
  bounties: PackEntry[];
  /** Schema 2 only: open seasons. */
  seasons?: PackSeason[];
  /** Schema 3 only: the terms of bounties that have any (the Expand section). */
  bountyTerms?: PackTerms[];
  /** Schema 4 only: bounties set by name, not yet locked to a GUID. */
  wanted?: PackWanted[];
}

export interface PackTerms {
  bountyId: number;
  kills: number;
  /** Kills still wanted (each kill: kills not yet approved; all-or-nothing: the whole count). */
  killsLeft: number;
  payout: number;
  terms: BountyTerm[];
}

export type Decoded =
  | { type: "B"; fields: BountyPost }
  | { type: "K"; fields: KillClaim }
  | { type: "L"; fields: CharacterLink }
  | { type: "S"; fields: SeasonPost }
  | { type: "W"; fields: SightingReport }
  | { type: "P"; fields: BountyPack };

export type DecodeResult = ({ ok: true; code: string } & Decoded) | { ok: false; error: ErrorCode; message: string };

export type PackResult =
  | { ok: true; fields: BountyPack; codes: string[] }
  | { ok: false; error: ErrorCode; message: string; received?: number[]; total?: number };

export class CodecError extends Error {
  constructor(
    readonly code: ErrorCode | "INVALID",
    message: string,
    readonly extra: { received?: number[]; total?: number } = {},
  ) {
    super(message);
    this.name = "CodecError";
  }
}

function fail(code: CodecError["code"], message: string, extra?: CodecError["extra"]): never {
  throw new CodecError(code, message, extra);
}

// ---------------------------------------------------------------- schemas

type Field =
  | readonly [name: string, kind: "u8" | "u16" | "u32" | "tag" | "faction" | "guid"]
  | readonly [name: string, kind: "vstr", maxBytes: number]
  | readonly [name: string, kind: "list", fields: readonly Field[]];

const PACK_ENTRY: readonly Field[] = [
  ["bountyId", "u32"],
  ["targetGUID", "guid"],
  ["targetName", "vstr", 255],
  ["targetClassID", "u8"],
  ["targetFaction", "faction"],
  ["rewardGold", "u32"],
  ["posterName", "vstr", 255],
  ["expiresAt", "u32"],
];

const PACK_SEASON: readonly Field[] = [
  ["seasonId", "u32"],
  ["guildName", "vstr", 255],
  ["guildFaction", "faction"],
  ["kind", "u8"],
  ["perKillGold", "u32"],
  ["remainingGold", "u32"],
  ["posterName", "vstr", 255],
  ["expiresAt", "u32"],
];

const TERM_FIELDS: readonly Field[] = [
  ["kind", "u8"],
  ["value", "u16"],
  ["gold", "u32"],
];

const PACK_TERMS: readonly Field[] = [
  ["bountyId", "u32"],
  ["kills", "u8"],
  ["killsLeft", "u8"],
  ["payout", "u8"],
  ["terms", "list", TERM_FIELDS],
];

const PACK_WANTED: readonly Field[] = [
  ["bountyId", "u32"],
  ["targetName", "vstr", 255],
  ["targetFaction", "faction"],
  ["rewardGold", "u32"],
  ["posterName", "vstr", 255],
  ["expiresAt", "u32"],
];

const SIGHTING: readonly Field[] = [
  ["bountyId", "u32"],
  ["mapID", "u16"],
  ["seenAt", "u32"],
  ["spotterName", "vstr", 255],
];

const LAYOUT: Readonly<Record<CodeType, readonly Field[]>> = {
  B: [
    ["boardTag", "tag"],
    ["targetGUID", "guid"],
    ["targetName", "vstr", 255],
    ["targetClassID", "u8"],
    ["targetRaceID", "u8"],
    ["targetLevel", "u8"],
    ["targetFaction", "faction"],
    ["posterFaction", "faction"],
    ["rewardGold", "u32"],
    ["posterGUID", "guid"],
    ["posterName", "vstr", 255],
    ["mapID", "u16"],
    ["createdAt", "u32"],
    ["nonce", "u16"],
    ["note", "vstr", 80],
    ["mode", "u8"],
    ["existingBountyId", "u32"],
  ],
  K: [
    ["boardTag", "tag"],
    ["bountyId", "u32"],
    ["victimGUID", "guid"],
    ["killerGUID", "guid"],
    ["killerName", "vstr", 255],
    ["killerFaction", "faction"],
    ["killedAt", "u32"],
    ["mapID", "u16"],
    ["flags", "u8"],
    ["nonce", "u16"],
  ],
  L: [
    ["boardTag", "tag"],
    ["charGUID", "guid"],
    ["charName", "vstr", 255],
    ["faction", "faction"],
    ["guildName", "vstr", 255],
    ["createdAt", "u32"],
    ["nonce", "u16"],
  ],
  P: [
    ["boardTag", "tag"],
    ["packVersion", "u32"],
    ["minAddonVersion", "u16"],
    ["discordDisplayName", "vstr", 255],
    ["rewardMin", "u32"],
    ["rewardMax", "u32"],
    ["bounties", "list", PACK_ENTRY],
  ],
  S: [
    ["boardTag", "tag"],
    ["guildName", "vstr", 255],
    ["guildFaction", "faction"],
    ["posterFaction", "faction"],
    ["kind", "u8"],
    ["perKillGold", "u32"],
    ["totalGold", "u32"],
    ["days", "u8"],
    ["posterGUID", "guid"],
    ["posterName", "vstr", 255],
    ["createdAt", "u32"],
    ["nonce", "u16"],
    ["mode", "u8"],
    ["existingSeasonId", "u32"],
  ],
  W: [
    ["boardTag", "tag"],
    ["sentAt", "u32"],
    ["nonce", "u16"],
    ["sightings", "list", SIGHTING],
  ],
};

/**
 * Field layouts after the leading `u8 schema` byte (Compendium 02 Section 3), one per schema:
 * SCHEMAS.K[0] is K schema 1, SCHEMAS.K[1] is K schema 2. A later schema only appends fields.
 */
const K2: readonly Field[] = [...LAYOUT.K, ["seasonId", "u32"], ["victimName", "vstr", 255], ["guildName", "vstr", 255], ["guildSeen", "u8"]];
const P2: readonly Field[] = [...LAYOUT.P, ["seasons", "list", PACK_SEASON]];
const P3: readonly Field[] = [...P2, ["bountyTerms", "list", PACK_TERMS]];

export const SCHEMAS: Readonly<Record<CodeType, readonly (readonly Field[])[]>> = {
  B: [LAYOUT.B, [...LAYOUT.B, ["kills", "u8"], ["payout", "u8"], ["days", "u8"], ["terms", "list", TERM_FIELDS]]],
  K: [LAYOUT.K, K2, [...K2, ["killerClassID", "u8"], ["killerLevel", "u8"], ["victimLevel", "u8"], ["facts", "u8"]]],
  L: [LAYOUT.L],
  P: [LAYOUT.P, P2, P3, [...P3, ["wanted", "list", PACK_WANTED]]],
  S: [LAYOUT.S, [...LAYOUT.S, ["minKills", "u16"]]],
  W: [LAYOUT.W],
};

const isCodeType = (t: string): t is CodeType => t === "B" || t === "K" || t === "P" || t === "L" || t === "S" || t === "W";
const MAX: Record<"u8" | "u16" | "u32", number> = { u8: 0xff, u16: 0xffff, u32: 0xffffffff };

/**
 * Cross-field rules. `strict` is true for the schema this codec knows; newer
 * schemas only get the rules that can't change (faction, reward order).
 * Returns [errorCode, message] or null.
 */
function crossCheck(type: CodeType, f: Record<string, unknown>, strict: boolean): [ErrorCode, string] | null {
  if (type === "B") {
    if (f.targetFaction === f.posterFaction) return ["FACTION", "bounties must be on the opposite faction"];
    if (strict) {
      if (f.mode !== 0 && f.mode !== 1) return ["PAYLOAD", "invalid mode"];
      if (f.mode === 0 && f.existingBountyId !== 0) return ["PAYLOAD", "existingBountyId must be 0 for a new bounty"];
      if (f.mode === 1 && f.existingBountyId === 0) return ["PAYLOAD", "existingBountyId is required to add to a bounty"];
      const bad = (f.schema as number) >= 2 ? termsProblem(f as unknown as BountyPost) : null;
      if (bad) return ["PAYLOAD", bad];
    }
  } else if (type === "K") {
    if (strict && (f.flags as number) > 3) return ["PAYLOAD", "unknown flag bits"];
    if (strict && f.guildSeen !== undefined && f.guildSeen !== 0 && f.guildSeen !== 1) return ["PAYLOAD", "invalid guildSeen"];
    if (strict && f.facts !== undefined && (f.facts as number) > 3) return ["PAYLOAD", "unknown fact bits"];
  } else if (type === "P") {
    if ((f.rewardMin as number) > (f.rewardMax as number)) return ["PAYLOAD", "rewardMin is above rewardMax"];
  } else if (type === "W") {
    const list = f.sightings as Sighting[];
    if (strict && (list.length < 1 || list.length > MAX_SIGHTINGS)) return ["PAYLOAD", `a sighting report holds 1 to ${MAX_SIGHTINGS} sightings`];
    if (strict && list.some((x) => x.bountyId === 0)) return ["PAYLOAD", "a sighting needs a bounty number"];
  } else if (type === "S") {
    if (f.guildFaction === f.posterFaction) return ["FACTION", "an Open Season must be on the opposite faction"];
    if (strict) {
      const per = f.perKillGold as number;
      const total = f.totalGold as number;
      if (f.guildName === "") return ["PAYLOAD", "guildName is empty"];
      if (f.mode === 0) {
        if (f.existingSeasonId !== 0) return ["PAYLOAD", "existingSeasonId must be 0 for a new season"];
        if (f.days !== 7 && f.days !== 14 && f.days !== 28) return ["PAYLOAD", "days must be 7, 14 or 28"];
        if (f.kind === 1) {
          if (per < 1 || total < per) return ["PAYLOAD", "a pot must hold at least the price of one kill"];
        } else if (f.kind === 2) {
          if (per !== 0 || total < 1) return ["PAYLOAD", "a prize pool has a total and no price per kill"];
          if (f.minKills !== undefined && (f.minKills as number) < 1) return ["PAYLOAD", "a prize pool needs a minimum of at least 1 kill"];
        } else if (f.kind === 3) {
          if (per < 1 || total !== 0) return ["PAYLOAD", "a no-ceiling season has a price per kill and no total"];
        } else return ["PAYLOAD", "invalid kind"];
        if (f.kind !== 2 && (f.minKills ?? 0) !== 0) return ["PAYLOAD", "only a prize pool has a minimum of kills"];
      } else if (f.mode === 1) {
        if (f.existingSeasonId === 0) return ["PAYLOAD", "existingSeasonId is required to add gold"];
        if (f.kind !== 0 || per !== 0 || f.days !== 0 || (f.minKills ?? 0) !== 0 || total < 1) return ["PAYLOAD", "adding gold carries only the amount"];
      } else return ["PAYLOAD", "invalid mode"];
    }
  }
  return null;
}

// ---------------------------------------------------------------- CRC-16/CCITT-FALSE

const CRC_TABLE: number[] = [];
for (let i = 0; i < 256; i++) {
  let crc = i * 256;
  for (let j = 0; j < 8; j++) crc = crc >= 0x8000 ? ((crc - 0x8000) * 2) ^ 0x1021 : crc * 2;
  CRC_TABLE.push(crc);
}

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over an ASCII string. */
export function crc16(ascii: string): number {
  let crc = 0xffff;
  for (let i = 0; i < ascii.length; i++) {
    const idx = Math.floor(crc / 256) ^ ascii.charCodeAt(i);
    crc = ((crc % 256) * 256) ^ CRC_TABLE[idx]!;
  }
  return crc;
}

const checkChars = (crc: number): string =>
  ALPHABET[Math.floor(crc / 32768)]! +
  ALPHABET[Math.floor(crc / 1024) % 32]! +
  ALPHABET[Math.floor(crc / 32) % 32]! +
  ALPHABET[crc % 32]!;

// ---------------------------------------------------------------- Adler-32 (zlib trailer)

export function adler32(b: ArrayLike<number>): number {
  let a = 1;
  let s = 0;
  for (let i = 0; i < b.length; i++) {
    a = (a + b[i]!) % 65521;
    s = (s + a) % 65521;
  }
  return s * 65536 + a;
}

// ---------------------------------------------------------------- Crockford base32

const DEC: Record<string, number> = {};
for (let i = 0; i < 32; i++) DEC[ALPHABET[i]!] = i;

export function base32Encode(bytes: ArrayLike<number>): string {
  let out = "";
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buf = buf * 256 + bytes[i]!;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      const p = 2 ** bits;
      const idx = Math.floor(buf / p);
      out += ALPHABET[idx];
      buf -= idx * p;
    }
  }
  if (bits > 0) out += ALPHABET[buf * 2 ** (5 - bits)];
  return out;
}

/** Decodes canonical base32. Rejects impossible lengths and non-zero pad bits. */
export function base32Decode(text: string): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of text) {
    const v = DEC[ch];
    if (v === undefined) fail("FORMAT", `invalid character "${ch}"`);
    buf = buf * 32 + v;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      const p = 2 ** bits;
      const b = Math.floor(buf / p);
      out.push(b);
      buf -= b * p;
    }
  }
  if (bits >= 5 || buf !== 0) fail("FORMAT", "payload has an invalid length or padding");
  return out;
}

// ---------------------------------------------------------------- UTF-8 (strict, Unicode Table 3-7)

function utf8Encode(s: string, path: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0)!;
    if (cp >= 0xd800 && cp <= 0xdfff) fail("INVALID", `${path} contains a lone surrogate`);
    if (cp < 0x80) out.push(cp);
    else if (cp < 0x800) out.push(0xc0 + Math.floor(cp / 64), 0x80 + (cp % 64));
    else if (cp < 0x10000) out.push(0xe0 + Math.floor(cp / 4096), 0x80 + (Math.floor(cp / 64) % 64), 0x80 + (cp % 64));
    else
      out.push(
        0xf0 + Math.floor(cp / 262144),
        0x80 + (Math.floor(cp / 4096) % 64),
        0x80 + (Math.floor(cp / 64) % 64),
        0x80 + (cp % 64),
      );
  }
  return out;
}

/** Returns the decoded string, or null if the bytes are not well-formed UTF-8. */
function utf8Decode(b: readonly number[]): string | null {
  let s = "";
  let i = 0;
  const cont = (x: number | undefined) => x !== undefined && x >= 0x80 && x <= 0xbf;
  while (i < b.length) {
    const c = b[i]!;
    if (c < 0x80) {
      s += String.fromCodePoint(c);
      i += 1;
    } else if (c >= 0xc2 && c <= 0xdf) {
      if (!cont(b[i + 1])) return null;
      s += String.fromCodePoint((c - 0xc0) * 64 + (b[i + 1]! - 0x80));
      i += 2;
    } else if (c >= 0xe0 && c <= 0xef) {
      const lo = c === 0xe0 ? 0xa0 : 0x80;
      const hi = c === 0xed ? 0x9f : 0xbf;
      const c2 = b[i + 1];
      if (c2 === undefined || c2 < lo || c2 > hi || !cont(b[i + 2])) return null;
      s += String.fromCodePoint((c - 0xe0) * 4096 + (c2 - 0x80) * 64 + (b[i + 2]! - 0x80));
      i += 3;
    } else if (c >= 0xf0 && c <= 0xf4) {
      const lo = c === 0xf0 ? 0x90 : 0x80;
      const hi = c === 0xf4 ? 0x8f : 0xbf;
      const c2 = b[i + 1];
      if (c2 === undefined || c2 < lo || c2 > hi || !cont(b[i + 2]) || !cont(b[i + 3])) return null;
      s += String.fromCodePoint(
        (c - 0xf0) * 262144 + (c2 - 0x80) * 4096 + (b[i + 2]! - 0x80) * 64 + (b[i + 3]! - 0x80),
      );
      i += 4;
    } else return null;
  }
  return s;
}

/** Cuts UTF-8 bytes to at most `max`, never splitting a character. */
function truncateUtf8(b: number[], max: number): number[] {
  if (b.length <= max) return b;
  let cut = max;
  while (cut > 0 && b[cut]! >= 0x80 && b[cut]! <= 0xbf) cut--;
  return b.slice(0, cut);
}

// ---------------------------------------------------------------- GUIDs

const GUID_RE = /^Player-([0-9]+)-([0-9A-F]{8})$/;

/** [serverId, low] when the GUID round-trips through the compact form exactly, else null. */
function compactGuid(guid: string): [number, number] | null {
  const m = GUID_RE.exec(guid);
  if (!m || m[1]!.length > 5) return null;
  const sid = Number(m[1]);
  if (sid > 0xffff || String(sid) !== m[1]) return null;
  return [sid, parseInt(m[2]!, 16)];
}

const hex8 = (n: number): string => n.toString(16).toUpperCase().padStart(8, "0");

// ---------------------------------------------------------------- byte writer / reader

class Writer {
  readonly bytes: number[] = [];
  uint(n: number, size: 1 | 2 | 4): void {
    for (let i = size - 1; i >= 0; i--) this.bytes.push(Math.floor(n / 256 ** i) % 256);
  }
  raw(b: readonly number[]): void {
    for (const x of b) this.bytes.push(x);
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly b: readonly number[]) {}
  get done(): boolean {
    return this.pos === this.b.length;
  }
  bytes(n: number): number[] {
    if (this.pos + n > this.b.length) fail("PAYLOAD", "payload is truncated");
    const out = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  uint(size: 1 | 2 | 4): number {
    let n = 0;
    for (const x of this.bytes(size)) n = n * 256 + x;
    return n;
  }
}

const SIZE = { u8: 1, u16: 2, u32: 4 } as const;
const isTag = (s: string): boolean => s.length === 4 && [...s].every((c) => DEC[c] !== undefined);

// ---------------------------------------------------------------- field encode / decode

function checkUint(v: unknown, path: string, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max)
    fail("INVALID", `${path} must be an integer from 0 to ${max}`);
  return v;
}

/**
 * `raw` mode (test-vector crafting only) skips semantic checks, writes
 * factions as plain bytes, takes byte arrays for strings and never truncates.
 */
function writeFields(w: Writer, fields: readonly Field[], obj: unknown, path: string, raw: boolean): void {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) fail("INVALID", `${path || "fields"} must be an object`);
  const rec = obj as Record<string, unknown>;
  for (const f of fields) {
    const v = rec[f[0]];
    const p = path ? `${path}.${f[0]}` : f[0];
    switch (f[1]) {
      case "u8":
      case "u16":
      case "u32":
        w.uint(checkUint(v, p, MAX[f[1]]), SIZE[f[1]]);
        break;
      case "tag":
        if (typeof v !== "string" || !(isTag(v) || raw)) fail("INVALID", `${p} must be 4 Crockford base32 characters`);
        w.raw([...(v as string)].map((c) => c.charCodeAt(0)));
        break;
      case "faction":
        if (!raw && v !== 1 && v !== 2) fail("INVALID", `${p} must be 1 (Alliance) or 2 (Horde)`);
        w.uint(checkUint(v, p, 0xff), 1);
        break;
      case "guid": {
        // raw mode: { form: n } writes a bare form byte; a byte array forces the raw form.
        if (raw && typeof v === "object" && v !== null && !Array.isArray(v)) {
          w.uint((v as { form: number }).form, 1);
          break;
        }
        if (raw && Array.isArray(v)) {
          w.raw([1, v.length, ...(v as number[])]);
          break;
        }
        if (typeof v !== "string" || v === "") fail("INVALID", `${p} must be a non-empty string`);
        const c = compactGuid(v);
        if (c) {
          w.uint(0, 1);
          w.uint(c[0], 2);
          w.uint(c[1], 4);
        } else {
          // Never truncate a GUID: a cut-off GUID would identify the wrong player.
          const b = utf8Encode(v, p);
          if (b.length > 255) fail("INVALID", `${p} is longer than 255 bytes`);
          w.raw([1, b.length, ...b]);
        }
        break;
      }
      case "vstr": {
        let b: number[];
        if (raw && Array.isArray(v)) b = v as number[];
        else if (typeof v === "string") b = utf8Encode(v, p);
        else fail("INVALID", `${p} must be a string`);
        if (!raw) b = truncateUtf8(b, f[2]);
        w.uint(b.length, 1);
        w.raw(b);
        break;
      }
      case "list": {
        if (!Array.isArray(v)) fail("INVALID", `${p} must be an array`);
        w.uint(checkUint(v.length, `${p}.length`, 0xffff), 2);
        v.forEach((item, i) => writeFields(w, f[2], item, `${p}[${i}]`, raw));
        break;
      }
    }
  }
}

function readFields(r: Reader, fields: readonly Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f[1]) {
      case "u8":
      case "u16":
      case "u32":
        out[f[0]] = r.uint(SIZE[f[1]]);
        break;
      case "tag": {
        const s = String.fromCharCode(...r.bytes(4));
        if (!isTag(s)) fail("PAYLOAD", "invalid board tag");
        out[f[0]] = s;
        break;
      }
      case "faction": {
        const v = r.uint(1);
        if (v !== 1 && v !== 2) fail("FACTION", "invalid faction");
        out[f[0]] = v;
        break;
      }
      case "guid": {
        const form = r.uint(1);
        if (form === 0) {
          const sid = r.uint(2);
          out[f[0]] = `Player-${sid}-${hex8(r.uint(4))}`;
        } else if (form === 1) {
          const s = utf8Decode(r.bytes(r.uint(1)));
          if (s === null || s === "") fail("PAYLOAD", `${f[0]} is not a valid GUID`);
          if (compactGuid(s as string)) fail("PAYLOAD", `${f[0]} uses a non-canonical GUID form`);
          out[f[0]] = s;
        } else fail("PAYLOAD", `${f[0]} has an unknown GUID form`);
        break;
      }
      case "vstr": {
        const n = r.uint(1);
        if (n > f[2]) fail("PAYLOAD", `${f[0]} is longer than ${f[2]} bytes`);
        const s = utf8Decode(r.bytes(n));
        if (s === null) fail("PAYLOAD", `${f[0]} is not valid UTF-8`);
        out[f[0]] = s;
        break;
      }
      case "list": {
        const n = r.uint(2);
        const items: Record<string, unknown>[] = [];
        for (let i = 0; i < n; i++) items.push(readFields(r, f[2]));
        out[f[0]] = items;
        break;
      }
    }
  }
  return out;
}

function writePayload(type: CodeType, fields: unknown, raw = false): number[] {
  const rec = (fields ?? {}) as Record<string, unknown>;
  const schema = rec.schema ?? SCHEMA;
  const layouts = SCHEMAS[type];
  const known = typeof schema === "number" ? layouts[schema - 1] : undefined;
  if (!raw && !known) fail("INVALID", `schema must be 1 to ${layouts.length}`);
  const w = new Writer();
  w.uint(checkUint(schema, "schema", 0xff), 1);
  // raw mode with an unknown schema (vector crafting): the newest layout.
  writeFields(w, known ?? layouts.at(-1)!, fields, "", raw);
  if (!raw) {
    const bad = crossCheck(type, rec, true);
    if (bad) fail("INVALID", bad[1]);
  }
  return w.bytes;
}

function readPayload(type: CodeType, bytes: readonly number[]): Record<string, unknown> {
  const r = new Reader(bytes);
  const schema = r.uint(1);
  if (schema === 0) fail("SCHEMA", "unknown schema 0");
  // A newer schema appends fields: read the ones we know, ignore the rest (Compendium 01 Section 5.2).
  const layouts = SCHEMAS[type];
  const strict = schema <= layouts.length;
  const fields = { schema, ...readFields(r, layouts[Math.min(schema, layouts.length) - 1]!) };
  const bad = crossCheck(type, fields, strict);
  if (bad) fail(bad[0], bad[1]);
  if (strict && !r.done) fail("PAYLOAD", "unexpected trailing bytes");
  return fields;
}

// ---------------------------------------------------------------- pack container (zlib = header + raw deflate + Adler-32)

function packBytes(body: number[]): number[] {
  const deflated = deflateSync(Uint8Array.from(body), { level: 9 });
  const w = new Writer();
  w.raw([0x78, 0xda]);
  w.raw(Array.from(deflated));
  w.uint(adler32(body), 4);
  return w.bytes;
}

function unpackBytes(b: readonly number[]): number[] {
  if (b.length < 6) fail("PAYLOAD", "pack is too short");
  const cmf = b[0]!;
  const flg = b[1]!;
  if (cmf % 16 !== 8 || cmf >= 128 || (cmf * 256 + flg) % 31 !== 0 || Math.floor(flg / 32) % 2 === 1)
    fail("PAYLOAD", "pack has an invalid zlib header");
  let out: Uint8Array;
  try {
    out = inflateSync(Uint8Array.from(b.slice(2, -4)));
  } catch {
    return fail("PAYLOAD", "pack data is corrupt");
  }
  if (out.length > MAX_PACK_BYTES) fail("PAYLOAD", "pack is too large");
  const expected = b.at(-4)! * 16777216 + b.at(-3)! * 65536 + b.at(-2)! * 256 + b.at(-1)!;
  if (adler32(out) !== expected) fail("PAYLOAD", "pack data is corrupt (Adler-32 mismatch)");
  return Array.from(out);
}

// ---------------------------------------------------------------- text form

/** Builds `BL1-<type>-[<part>-]<payload>-<check>` from base32 payload text. */
export function wrapPayload(type: string, payloadText: string, partToken?: string): string {
  const body = `${PREFIX}-${type}-${partToken ? `${partToken}-` : ""}${payloadText}`;
  return `${body}-${checkChars(crc16(body))}`;
}

/** Compendium 02 Section 1.1: drop ASCII whitespace and backticks, uppercase ASCII. */
export function normalize(input: string): string {
  return input.replace(/[ \t\n\r\v\f`]/g, "").replace(/[a-z]/g, (c) => c.toUpperCase());
}

/** In PAYLOAD and CHECK only: I,L -> 1 and O -> 0. Anything else outside the alphabet is FORMAT. */
function crockford(text: string): string {
  const s = text.replace(/[IL]/g, "1").replace(/O/g, "0");
  for (const ch of s) if (DEC[ch] === undefined) fail("FORMAT", `invalid character "${ch}"`);
  return s;
}

interface ParsedCode {
  type: CodeType;
  part: { index: number; total: number } | null;
  payload: string;
  code: string;
}

/** Parses and checksums one normalized code. Does not look inside the payload. */
function parseCode(s: string): ParsedCode {
  const m = /^BL([0-9]+)-(.*)$/s.exec(s);
  if (!m) fail("FORMAT", "not a Bounty Line code");
  if (m[1] !== "1") fail("VERSION", `unsupported code version BL${m[1]}`);
  const parts = m[2]!.split("-");
  const type = parts[0]!;
  if (!isCodeType(type)) fail("TYPE", `unknown code type "${type}"`);
  let partToken: string | undefined;
  let part: ParsedCode["part"] = null;
  let rawPayload: string;
  let rawCheck: string;
  if (parts.length === 3) {
    [, rawPayload, rawCheck] = parts as [string, string, string];
  } else if (parts.length === 4 && type === "P") {
    [, partToken, rawPayload, rawCheck] = parts as [string, string, string, string];
    const pm = /^([1-9][0-9]?)OF([1-9][0-9]?)$/.exec(partToken);
    if (!pm) fail("FORMAT", "invalid part marker");
    part = { index: Number(pm[1]), total: Number(pm[2]) };
    if (part.total < 2 || part.total > MAX_PARTS || part.index > part.total)
      fail("PARTS", `invalid part ${part.index} of ${part.total}`);
  } else fail("FORMAT", "code must have the form BL1-<type>-<payload>-<check>");
  if (rawPayload === "" || rawCheck.length !== 4) fail("FORMAT", "code is missing its payload or check");
  const payload = crockford(rawPayload);
  const check = crockford(rawCheck);
  const body = `${PREFIX}-${type}-${partToken ? `${partToken}-` : ""}${payload}`;
  if (check !== checkChars(crc16(body))) fail("CHECKSUM", "checksum mismatch: the code is cut off or changed");
  return { type, part, payload, code: `${body}-${check}` };
}

function catchResult<T>(fn: () => T): T | { ok: false; error: ErrorCode; message: string } {
  try {
    return fn();
  } catch (e) {
    if (e instanceof CodecError && e.code !== "INVALID") return { ok: false, error: e.code, message: e.message, ...e.extra };
    throw e;
  }
}

// ---------------------------------------------------------------- public API

/** Encodes a B, K, L, S or W code. Throws CodecError("INVALID") if the fields don't fit. */
export function encode(type: "B", fields: BountyPost): string;
export function encode(type: "K", fields: KillClaim): string;
export function encode(type: "L", fields: CharacterLink): string;
export function encode(type: "S", fields: SeasonPost): string;
export function encode(type: "W", fields: SightingReport): string;
export function encode(type: CodeType, fields: unknown): string;
export function encode(type: CodeType, fields: unknown): string {
  if (type === "P") fail("INVALID", "use encodePack for packs");
  if (!isCodeType(type)) fail("INVALID", `unknown code type "${String(type)}"`);
  return wrapPayload(type, base32Encode(writePayload(type, fields)));
}

/** Encodes a Bounty Pack as one code, or as 2..MAX_PARTS part codes if it's longer than maxLength. */
export function encodePack(fields: BountyPack, maxLength = MAX_CODE_LENGTH): string[] {
  const text = base32Encode(packBytes(writePayload("P", fields)));
  const single = wrapPayload("P", text);
  if (single.length <= maxLength) return [single];
  for (let total = 2; total <= MAX_PARTS; total++) {
    const overhead = `${PREFIX}-P-${total}OF${total}--0000`.length;
    if ((maxLength - overhead) * total < text.length) continue;
    const chunk = Math.ceil(text.length / total);
    return Array.from({ length: total }, (_, i) =>
      wrapPayload("P", text.slice(i * chunk, (i + 1) * chunk), `${i + 1}OF${total}`),
    );
  }
  return fail("INVALID", `pack needs more than ${MAX_PARTS} parts`);
}

/** Decodes one B, K, L or single-part P code. Throws CodecError. */
export function decodeOrThrow(input: string): Decoded & { code: string } {
  if (typeof input !== "string") fail("FORMAT", "code must be a string");
  const c = parseCode(normalize(input));
  if (c.part) fail("PARTS", "this is one part of a multi-part Bounty Pack; paste all parts into /bl import");
  let bytes = base32Decode(c.payload);
  if (c.type === "P") bytes = unpackBytes(bytes);
  return { type: c.type, fields: readPayload(c.type, bytes), code: c.code } as unknown as Decoded & { code: string };
}

/** Decodes one code. Never throws on bad input. */
export function decode(input: string): DecodeResult {
  return catchResult(() => ({ ok: true as const, ...decodeOrThrow(input) }));
}

/** Start offsets of every `BL<digits>-` in normalized text. */
function codeStarts(s: string): number[] {
  const starts: number[] = [];
  const re = /BL[0-9]+-/y;
  for (let i = 0; i < s.length; i++) {
    re.lastIndex = i;
    if (re.test(s)) starts.push(i);
  }
  return starts;
}

/**
 * Decodes a Bounty Pack from pasted text: one code, or all parts of a
 * multi-part pack in any order (duplicates allowed). Never throws on bad input.
 */
export function decodePack(text: string): PackResult {
  return catchResult(() => {
    if (typeof text !== "string") fail("FORMAT", "pack must be a string");
    const s = normalize(text);
    const starts = codeStarts(s);
    if (starts[0] !== 0) fail("FORMAT", "not a Bounty Line code");
    const codes = starts.map((start, i) => parseCode(s.slice(start, starts[i + 1])));
    for (const c of codes) if (c.type !== "P") fail("TYPE", "that's not a Bounty Pack code");
    let payload: string;
    if (codes.length === 1 && !codes[0]!.part) {
      payload = codes[0]!.payload;
    } else {
      if (codes.some((c) => !c.part)) fail("PARTS", "a whole pack was mixed with pack parts");
      const total = codes[0]!.part!.total;
      const chunks = new Map<number, string>();
      for (const c of codes) {
        if (c.part!.total !== total) fail("PARTS", "parts come from different packs");
        const seen = chunks.get(c.part!.index);
        if (seen !== undefined && seen !== c.payload) fail("PARTS", `two different versions of part ${c.part!.index}`);
        chunks.set(c.part!.index, c.payload);
      }
      if (chunks.size < total) {
        const received = [...chunks.keys()].sort((a, b) => a - b);
        fail("INCOMPLETE", `${received.length} of ${total} parts received`, { received, total });
      }
      payload = Array.from({ length: total }, (_, i) => chunks.get(i + 1)!).join("");
    }
    const fields = readPayload("P", unpackBytes(base32Decode(payload))) as unknown as BountyPack;
    // Report codes in part order so callers can re-share them.
    const sorted = [...codes].sort((a, b) => (a.part?.index ?? 0) - (b.part?.index ?? 0));
    const unique = sorted.filter((c, i) => i === 0 || c.part?.index !== sorted[i - 1]!.part?.index);
    return { ok: true as const, fields, codes: unique.map((c) => c.code) };
  });
}

/** Test-vector crafting only: writes fields without validation and wraps them with a valid checksum. */
export const _unsafe = {
  payload: (type: CodeType, fields: unknown) => writePayload(type, fields, true),
  wrapBytes: (type: CodeType, bytes: number[]) => wrapPayload(type, base32Encode(bytes)),
  packBytes,
};
