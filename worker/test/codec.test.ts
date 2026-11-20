import { describe, expect, it } from "vitest";
import vectors from "../../shared/test-vectors.json";
import { adler32, base32Decode, base32Encode, crc16, decode, decodePack, encode, encodePack, type BountyPack, type CodeType } from "../src/codec";

const hexToBytes = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
const bytesToHex = (b: number[]) => b.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");

describe("primitives", () => {
  it.each(vectors.crc16)("crc16($input) = $crc", ({ input, crc }) => {
    expect(crc16(input).toString(16).toUpperCase().padStart(4, "0")).toBe(crc);
  });
  it.each(vectors.adler32)("adler32 $adler", ({ input, adler }) => {
    expect(adler32([...input].map((c) => c.charCodeAt(0))).toString(16).toUpperCase().padStart(8, "0")).toBe(adler);
  });
  it.each(vectors.base32)("base32 $hex <-> $b32", ({ hex, b32 }) => {
    expect(base32Encode(hexToBytes(hex))).toBe(b32);
    expect(bytesToHex(base32Decode(b32))).toBe(hex);
  });
});

describe("codes", () => {
  it.each(vectors.codes)("$name: encodes to the frozen code", ({ type, fields, code }) => {
    const out = type === "P" ? encodePack(fields as BountyPack) : [encode(type as CodeType, fields)];
    expect(out).toEqual([code]);
  });
  it.each(vectors.codes)("$name: decodes", (v) => {
    const expected = "decoded" in v ? v.decoded : v.fields;
    expect(decode(v.code)).toEqual({ ok: true, type: v.type, fields: expected, code: v.code });
  });
  it.each(vectors.forwardCompat)("$name", ({ code, type, fields }) => {
    expect(decode(code)).toEqual({ ok: true, type, fields, code });
  });
});

describe("normalization", () => {
  it.each(vectors.normalization)("$input", ({ input, normalized }) => {
    const r = decode(input);
    expect(r.ok && r.code).toBe(normalized);
  });
});

describe("invalid codes", () => {
  it.each(vectors.invalid)("$name -> $error", ({ code, error }) => {
    const r = decode(code);
    expect(r.ok ? "ok" : r.error).toBe(error);
  });
});

describe("packs", () => {
  it("splits into the frozen parts", () => {
    const fields = vectors.codes.find((c) => c.name === "P three bounties")!.fields as BountyPack;
    expect(encodePack(fields, vectors.packs.maxLength)).toEqual(vectors.packs.parts);
  });
  it.each(vectors.packs.cases)("$name", (c) => {
    const r = decodePack(c.input);
    if ("fields" in c && c.fields) {
      expect(r.ok && r.fields).toEqual(c.fields);
    } else {
      expect(r.ok ? "ok" : r.error).toBe(c.error);
      if ("received" in c && !r.ok) expect({ received: r.received, total: r.total }).toEqual({ received: c.received, total: c.total });
    }
  });
});

describe("encode errors", () => {
  it.each(vectors.encodeErrors)("$name", ({ type, fields }) => {
    expect(() => encode(type as CodeType, fields)).toThrow();
  });
});

describe("properties", () => {
  it("re-encoding a decoded B/K/L code reproduces the canonical code", () => {
    for (const v of [...vectors.codes.map((x) => x.code), ...vectors.normalization.map((x) => x.input)]) {
      const r = decode(v);
      if (!r.ok) throw new Error(r.message);
      if (r.type === "P") continue;
      expect(encode(r.type, r.fields)).toBe(r.code);
    }
  });
  it("every single-character substitution in a K payload is caught", () => {
    const code = vectors.codes.find((c) => c.type === "K")!.code;
    const start = code.indexOf("-", 4) + 1;
    const end = code.lastIndexOf("-");
    for (let i = start; i < end; i++)
      for (const ch of "0123456789ABCDEFGHJKMNPQRSTVWXYZ")
        if (ch !== code[i]) expect(decode(code.slice(0, i) + ch + code.slice(i + 1)).ok).toBe(false);
  });
});
