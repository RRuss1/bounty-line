import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { Resvg } from "@resvg/resvg-wasm";
import { beforeAll, describe, expect, it } from "vitest";
import vector from "../../shared/qr-vector.json";
import { decode } from "../src/codec";
import { posterAssets } from "../src/poster-assets";
import { initResvg } from "../src/poster-image";
import { imageSize, readQr } from "../src/qr";

const rows = vector.matrix.split("/");

/** A fake screenshot: the shared QR matrix drawn the way the stamp draws it, at (x, y). */
function screenshot(width: number, height: number, x: number, y: number, module: number): Uint8Array {
  const quiet = 4;
  const side = (rows.length + quiet * 2) * module;
  let cells = "";
  rows.forEach((row, r) => {
    [...row].forEach((bit, c) => {
      if (bit === "1") cells += `<rect x="${x + (quiet + c) * module}" y="${y + (quiet + r) * module}" width="${module}" height="${module}"/>`;
    });
  });
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="100%" height="100%" fill="#3b2f1e"/>` +
    `<rect x="${x}" y="${y}" width="${side}" height="${side}" fill="#fff"/>${cells}</svg>`;
  const r = new Resvg(svg, { font: { loadSystemFonts: false } });
  return r.render().asPng();
}

beforeAll(() => initResvg(posterAssets.wasm));

describe("QR code on the proof stamp", () => {
  it("the shared vector is a real kill code", () => {
    expect(decode(vector.code)).toMatchObject({ ok: true, type: "K" });
  });

  it("reads the code the Lua encoder drew, from a PNG screenshot", async () => {
    // 1920x1080, QR under the band on the left, 4 px modules: where and how the stamp draws it.
    const png = screenshot(1920, 1080, 22, 627, 4);
    expect(await readQr(png, "image/png", posterAssets.wasm)).toBe(vector.code);
  });

  it("reads it from a JPG (the game's default format), 3 px modules", async () => {
    const jpg = new Uint8Array(readFileSync(fileURLToPath(new URL("./fixtures/qr-stamp.jpg", import.meta.url))));
    expect(imageSize(jpg)).toEqual({ width: 1280, height: 720 });
    expect(await readQr(jpg, "image/jpeg", posterAssets.wasm)).toBe(vector.code);
  });

  it("falls back to the whole picture when the QR code isn't where the stamp puts it", async () => {
    const png = screenshot(1920, 1080, 1500, 40, 4);
    expect(await readQr(png, "image/png", posterAssets.wasm)).toBe(vector.code);
  });

  it("returns null for a picture with no QR code, and for things that aren't pictures", async () => {
    const plain = new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="100%" height="100%" fill="#246"/></svg>`).render().asPng();
    expect(imageSize(plain)).toEqual({ width: 640, height: 360 });
    expect(await readQr(plain, "image/png", posterAssets.wasm)).toBeNull();
    expect(await readQr(new Uint8Array([1, 2, 3, 4]), "image/png", posterAssets.wasm)).toBeNull();
    expect(await readQr(plain, "image/gif", posterAssets.wasm)).toBeNull();
  });
});
