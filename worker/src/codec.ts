/**
 * Bounty Line code codec, format BL1.
 *
 * Mirrors addon/BountyLine/Codec.lua. The wire format is documented in
 * shared/CODEC.md, and both implementations must pass shared/test-vectors.json.
 * Keep the two files structurally parallel: same schemas, same check order,
 * same error codes. Plain arithmetic is used instead of bit operators where
 * the Lua side has to (Lua 5.1 has no bitwise operators).
 */

export const VERSION = 1;
export const ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const MAX_UINT = 0xffffffff;
const MAX_STR_BYTES = 255;

export type Faction = "Alliance" | "Horde";
const FACTIONS: readonly Faction[] = ["Alliance", "Horde"]; // wire value = index

export interface BountyPost {
  boardTag: string;
  targetGuid: string;
  targetName: string;
  classId: number;
  raceId: number;
  level: number;
  targetFaction: Faction;
  reward: number;
  posterGuid: string;
  posterName: string;
  posterFaction: Faction;
  zoneMapId: number;
  timestamp: number;
  nonce: number;
  note: string;
}

export interface KillClaim {
  boardTag: string;
  bountyId: number;
  victimGuid: string;
  killerGuid: string;
  killerName: string;
  timestamp: number;
  zoneMapId: number;
  honorCorroborated: boolean;
  nonce: number;
}

export interface PackBounty {
  id: number;
  targetGuid: string;
  targetName: string;
  classId: number;
  targetFaction: Faction;
  reward: number;
  posterGuid: string;
  posterName: string;
  expiresAt: number;
}

export interface BountyPack {
  boardTag: string;
  packVersion: number;
  discordName: string;
  bounties: PackBounty[];
}

export type CodeType = "B" | "K" | "P";
export type Decoded =
  | { type: "B"; data: BountyPost }
  | { type: "K"; data: KillClaim }
  | { type: "P"; data: BountyPack };

export type DecodeErrorCode = "format" | "version" | "type" | "checksum" | "payload";
export type DecodeResult =
  | ({ ok: true; code: string } & Decoded)
  | { ok: false; error: DecodeErrorCode; message: string };

export class CodecError extends Error {
  constructor(
    readonly code: DecodeErrorCode | "invalid",
    message: string,
  ) {
    super(message);
    this.name = "CodecError";
  }
}

const fail = (code: CodecError["code"], message: string): never => {
  throw new CodecError(code, message);
};

// ---------------------------------------------------------------- schemas

type Kind = "tag" | "guid" | "str" | "uint" | "u16" | "faction" | "bool";
type Field = readonly [name: string, kind: Kind] | readonly [name: string, kind: "list", fields: readonly Field[]];

const PACK_BOUNTY: readonly Field[] = [
  ["id", "uint"],
  ["targetGuid", "guid"],
  ["targetName", "str"],
  ["classId", "uint"],
  ["targetFaction", "faction"],
  ["reward", "uint"],
  ["posterGuid", "guid"],
  ["posterName", "str"],
  ["expiresAt", "uint"],
];

export const SCHEMAS: Readonly<Record<CodeType, readonly Field[]>> = {
  B: [
    ["boardTag", "tag"],
    ["targetGuid", "guid"],
    ["targetName", "str"],
    ["classId", "uint"],
    ["raceId", "uint"],
    ["level", "uint"],
    ["targetFaction", "faction"],
    ["reward", "uint"],
    ["posterGuid", "guid"],
    ["posterName", "str"],
    ["posterFaction", "faction"],
    ["zoneMapId", "uint"],
    ["timestamp", "uint"],
    ["nonce", "u16"],
    ["note", "str"],
  ],
  K: [
    ["boardTag", "tag"],
    ["bountyId", "uint"],
    ["victimGuid", "guid"],
    ["killerGuid", "guid"],
    ["killerName", "str"],
    ["timestamp", "uint"],
    ["zoneMapId", "uint"],
    ["honorCorroborated", "bool"],
    ["nonce", "u16"],
  ],
  P: [
    ["boardTag", "tag"],
    ["packVersion", "uint"],
    ["discordName", "str"],
    ["bounties", "list", PACK_BOUNTY],
  ],
};

const isCodeType = (t: string): t is CodeType => t === "B" || t === "K" || t === "P";

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
    crc = ((crc % 256) * 256) ^ (CRC_TABLE[idx] as number);
  }
  return crc;
}

const checkChars = (crc: number): string =>
  ALPHABET[Math.floor(crc / 32768)]! +
  ALPHABET[Math.floor(crc / 1024) % 32]! +
  ALPHABET[Math.floor(crc / 32) % 32]! +
  ALPHABET[crc % 32]!;

// ---------------------------------------------------------------- Crockford base32

const DEC: Record<string, number> = {};
for (let i = 0; i < 32; i++) DEC[ALPHABET[i]!] = i;

export function base32Encode(bytes: ArrayLike<number>): string {
  let out = "";
  let buf = 0;
  let bits = 0;
  for (let i = 0; i < bytes.length; i++) {
    buf = buf * 256 + (bytes[i] as number);
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

/** Decodes canonical (already normalized) base32. Rejects impossible lengths and non-zero pad bits. */
export function base32Decode(text: string): number[] {
  const out: number[] = [];
  let buf = 0;
  let bits = 0;
  for (const ch of text) {
    const v = DEC[ch];
    if (v === undefined) fail("format", `invalid character "${ch}"`);
    buf = buf * 32 + (v as number);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      const p = 2 ** bits;
      const b = Math.floor(buf / p);
      out.push(b);
      buf -= b * p;
    }
  }
  if (bits >= 5 || buf !== 0) fail("format", "payload has an invalid length or padding");
  return out;
}

// ---------------------------------------------------------------- UTF-8 (strict, Unicode Table 3-7)

function utf8Encode(s: string, path: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    const cp = ch.codePointAt(0) as number;
    if (cp >= 0xd800 && cp <= 0xdfff) fail("invalid", `${path} contains a lone surrogate`);
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
    const c = b[i] as number;
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

// ---------------------------------------------------------------- GUIDs

const GUID_RE = /^Player-([0-9]+)-([0-9A-F]{8})$/;

/** Returns [serverId, low] when the GUID round-trips through the compact form exactly. */
function compactGuid(guid: string): [number, number] | null {
  const m = GUID_RE.exec(guid);
  if (!m || m[1]!.length > 10) return null;
  const sid = Number(m[1]);
  if (sid > MAX_UINT || String(sid) !== m[1]) return null;
  return [sid, parseInt(m[2]!, 16)];
}

const hex8 = (n: number): string => n.toString(16).toUpperCase().padStart(8, "0");

// ---------------------------------------------------------------- byte writer / reader

export class Writer {
  readonly bytes: number[] = [];
  u8(n: number): void {
    this.bytes.push(n);
  }
  varint(n: number): void {
    while (n >= 128) {
      this.bytes.push((n % 128) + 128);
      n = Math.floor(n / 128);
    }
    this.bytes.push(n);
  }
  u32(n: number): void {
    this.bytes.push(Math.floor(n / 16777216), Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256);
  }
  str(b: readonly number[]): void {
    this.varint(b.length);
    this.bytes.push(...b);
  }
}

class Reader {
  private pos = 0;
  constructor(private readonly b: readonly number[]) {}
  get done(): boolean {
    return this.pos === this.b.length;
  }
  u8(): number {
    const v = this.b[this.pos];
    if (v === undefined) fail("payload", "payload is truncated");
    this.pos += 1;
    return v as number;
  }
  varint(): number {
    let result = 0;
    let mult = 1;
    for (let i = 1; i <= 5; i++) {
      const b = this.u8();
      result += (b % 128) * mult;
      if (b < 128) {
        if (i > 1 && b === 0) fail("payload", "non-minimal varint");
        if (result > MAX_UINT) fail("payload", "varint exceeds 32 bits");
        return result;
      }
      mult *= 128;
    }
    return fail("payload", "varint too long");
  }
  bytes(n: number): number[] {
    if (this.pos + n > this.b.length) fail("payload", "payload is truncated");
    const out = this.b.slice(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  str(): string {
    const n = this.varint();
    if (n > MAX_STR_BYTES) fail("payload", "string too long");
    const s = utf8Decode(this.bytes(n));
    if (s === null) fail("payload", "string is not valid UTF-8");
    return s as string;
  }
}

// ---------------------------------------------------------------- field encode / decode

const isTag = (s: string): boolean => s === "" || (s.length === 4 && [...s].every((c) => DEC[c] !== undefined));

function checkUint(v: unknown, path: string, max: number): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > max)
    fail("invalid", `${path} must be an integer from 0 to ${max}`);
  return v as number;
}

function checkStr(v: unknown, path: string): number[] {
  if (typeof v !== "string") fail("invalid", `${path} must be a string`);
  const b = utf8Encode(v as string, path);
  if (b.length > MAX_STR_BYTES) fail("invalid", `${path} is longer than ${MAX_STR_BYTES} bytes`);
  return b;
}

function writeFields(w: Writer, fields: readonly Field[], obj: unknown, path: string): void {
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) fail("invalid", `${path || "data"} must be an object`);
  const rec = obj as Record<string, unknown>;
  for (const f of fields) {
    const v = rec[f[0]];
    const p = path ? `${path}.${f[0]}` : f[0];
    switch (f[1]) {
      case "uint":
        w.varint(checkUint(v, p, MAX_UINT));
        break;
      case "u16": {
        const n = checkUint(v, p, 0xffff);
        w.u8(Math.floor(n / 256));
        w.u8(n % 256);
        break;
      }
      case "str":
        w.str(checkStr(v, p));
        break;
      case "tag":
        if (typeof v !== "string" || !isTag(v)) fail("invalid", `${p} must be "" or 4 Crockford base32 characters`);
        w.str(checkStr(v, p));
        break;
      case "faction": {
        const i = FACTIONS.indexOf(v as Faction);
        if (i < 0) fail("invalid", `${p} must be "Alliance" or "Horde"`);
        w.u8(i);
        break;
      }
      case "bool":
        if (typeof v !== "boolean") fail("invalid", `${p} must be a boolean`);
        w.u8(v ? 1 : 0);
        break;
      case "guid": {
        if (typeof v !== "string") fail("invalid", `${p} must be a string`);
        const c = compactGuid(v as string);
        if (c) {
          w.u8(0);
          w.varint(c[0]);
          w.u32(c[1]);
        } else {
          w.u8(1);
          w.str(checkStr(v, p));
        }
        break;
      }
      case "list": {
        if (!Array.isArray(v)) fail("invalid", `${p} must be an array`);
        const arr = v as unknown[];
        w.varint(arr.length);
        arr.forEach((item, i) => writeFields(w, f[2], item, `${p}[${i}]`));
        break;
      }
    }
  }
}

function readFields(r: Reader, fields: readonly Field[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of fields) {
    switch (f[1]) {
      case "uint":
        out[f[0]] = r.varint();
        break;
      case "u16":
        out[f[0]] = r.u8() * 256 + r.u8();
        break;
      case "str":
        out[f[0]] = r.str();
        break;
      case "tag": {
        const s = r.str();
        if (!isTag(s)) fail("payload", "invalid board tag");
        out[f[0]] = s;
        break;
      }
      case "faction": {
        const v = FACTIONS[r.u8()];
        if (v === undefined) fail("payload", "invalid faction");
        out[f[0]] = v;
        break;
      }
      case "bool": {
        const v = r.u8();
        if (v > 1) fail("payload", "invalid boolean");
        out[f[0]] = v === 1;
        break;
      }
      case "guid": {
        const tag = r.u8();
        if (tag === 0) {
          const sid = r.varint();
          const b = r.bytes(4);
          out[f[0]] = `Player-${sid}-${hex8(b[0]! * 16777216 + b[1]! * 65536 + b[2]! * 256 + b[3]!)}`;
        } else if (tag === 1) {
          const s = r.str();
          if (compactGuid(s)) fail("payload", "non-canonical GUID encoding");
          out[f[0]] = s;
        } else fail("payload", "invalid GUID tag");
        break;
      }
      case "list": {
        const n = r.varint();
        const items: Record<string, unknown>[] = [];
        for (let i = 0; i < n; i++) items.push(readFields(r, f[2]));
        out[f[0]] = items;
        break;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------- public API

/** Builds `BL1-<type>-<payload>-<check>` from base32 payload text. */
export function wrapPayload(type: string, payloadText: string): string {
  const body = `BL${VERSION}-${type}-${payloadText}`;
  return `${body}-${checkChars(crc16(body))}`;
}

export function encodePayload(type: CodeType, data: unknown): number[] {
  if (!isCodeType(type)) fail("invalid", `unknown code type "${String(type)}"`);
  const w = new Writer();
  writeFields(w, SCHEMAS[type], data, "");
  return w.bytes;
}

/** Encodes a code. Throws CodecError("invalid") if the data doesn't fit the schema. */
export function encode(type: "B", data: BountyPost): string;
export function encode(type: "K", data: KillClaim): string;
export function encode(type: "P", data: BountyPack): string;
export function encode(type: CodeType, data: unknown): string;
export function encode(type: CodeType, data: unknown): string {
  return wrapPayload(type, base32Encode(encodePayload(type, data)));
}

/** Crockford normalization for payload/check text: I,L -> 1, O -> 0; anything else outside the alphabet is a format error. */
function crockford(text: string): string {
  const s = text.replace(/[IL]/g, "1").replace(/O/g, "0");
  for (const ch of s) if (DEC[ch] === undefined) fail("format", `invalid character "${ch}"`);
  return s;
}

/** Decodes a code, throwing CodecError on any failure. */
export function decodeOrThrow(input: string): Decoded & { code: string } {
  if (typeof input !== "string") fail("format", "code must be a string");
  // ASCII whitespace and ASCII case only, so Lua and TS normalize identically.
  const s = input.replace(/[ \t\n\r\v\f]/g, "").replace(/[a-z]/g, (c) => c.toUpperCase());
  const m = /^BL([0-9]+)-(.*)$/s.exec(s);
  if (!m) fail("format", "not a Bounty Line code");
  if (m![1] !== String(VERSION)) fail("version", `unsupported code version BL${m![1]}`);
  const parts = m![2]!.split("-");
  if (parts.length !== 3) fail("format", "code must have the form BL1-<type>-<payload>-<check>");
  const [type, rawPayload, rawCheck] = parts as [string, string, string];
  if (!isCodeType(type)) fail("type", `unknown code type "${type}"`);
  if (rawPayload === "" || rawCheck.length !== 4) fail("format", "code is missing its payload or check");
  const payload = crockford(rawPayload);
  const check = crockford(rawCheck);
  const body = `BL${VERSION}-${type}-${payload}`;
  if (check !== checkChars(crc16(body))) fail("checksum", "checksum mismatch: the code is cut off or mistyped");
  const r = new Reader(base32Decode(payload));
  const data = readFields(r, SCHEMAS[type as CodeType]);
  if (!r.done) fail("payload", "unexpected trailing bytes");
  // The schema walk guarantees `data` matches the interface for `type`.
  return { type, data, code: `${body}-${check}` } as unknown as Decoded & { code: string };
}

/** Decodes a code. Never throws for bad input; returns { ok: false, error } instead. */
export function decode(input: string): DecodeResult {
  try {
    return { ok: true, ...decodeOrThrow(input) };
  } catch (e) {
    if (e instanceof CodecError && e.code !== "invalid") return { ok: false, error: e.code, message: e.message };
    throw e;
  }
}
