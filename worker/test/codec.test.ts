import { describe, expect, it } from "vitest";
import vectors from "../../shared/test-vectors.json";
import { base32Decode, base32Encode, crc16, decode, encode, Writer, type CodeType } from "../src/codec";

const hexToBytes = (hex: string) => (hex.match(/../g) ?? []).map((h) => parseInt(h, 16));
const bytesToHex = (b: number[]) => b.map((x) => x.toString(16).toUpperCase().padStart(2, "0")).join("");

describe("primitives", () => {
  it.each(vectors.primitives.crc16)("crc16($ascii)", ({ ascii, crc }) => {
    expect(crc16(ascii)).toBe(crc);
  });
  it.each(vectors.primitives.base32)("base32 $hex <-> $text", ({ hex, text }) => {
    expect(base32Encode(hexToBytes(hex))).toBe(text);
    expect(bytesToHex(base32Decode(text))).toBe(hex);
  });
  it.each(vectors.primitives.varint)("varint $value", ({ value, hex }) => {
    const w = new Writer();
    w.varint(value);
    expect(bytesToHex(w.bytes)).toBe(hex);
  });
});

describe("valid codes", () => {
  it.each(vectors.valid)("$name: encodes", ({ type, data, code }) => {
    expect(encode(type as CodeType, data)).toBe(code);
  });
  it.each(vectors.valid)("$name: decodes", ({ type, data, code }) => {
    expect(decode(code)).toEqual({ ok: true, type, data, code });
  });
});

describe("normalization", () => {
  it.each(vectors.normalize)("$name", ({ input, code }) => {
    const r = decode(input);
    expect(r.ok && r.code).toBe(code);
  });
});

describe("invalid codes", () => {
  it.each(vectors.invalid)("$name -> $error", ({ input, error }) => {
    const r = decode(input);
    expect(r.ok ? "ok" : r.error).toBe(error);
  });
});

describe("encode errors", () => {
  it.each(vectors.encodeErrors)("$name", ({ type, data }) => {
    expect(() => encode(type as CodeType, data)).toThrow();
  });
});

describe("properties", () => {
  it("re-encoding a decoded code reproduces the canonical code", () => {
    for (const v of [...vectors.valid.map((x) => x.code), ...vectors.normalize.map((x) => x.input)]) {
      const r = decode(v);
      if (!r.ok) throw new Error(r.message);
      expect(encode(r.type, r.data)).toBe(r.code);
    }
  });

  it("every single-character substitution in the payload is caught", () => {
    const code = vectors.valid[3]!.code;
    const start = code.indexOf("-", 4) + 1;
    const end = code.lastIndexOf("-");
    for (let i = start; i < end; i++) {
      for (const ch of "0123456789ABCDEFGHJKMNPQRSTVWXYZ") {
        if (ch === code[i]) continue;
        const r = decode(code.slice(0, i) + ch + code.slice(i + 1));
        expect(r.ok).toBe(false);
      }
    }
  });

  it("every truncation is caught", () => {
    for (const v of vectors.valid) {
      for (let n = 0; n < v.code.length; n++) expect(decode(v.code.slice(0, n)).ok).toBe(false);
    }
  });
});
