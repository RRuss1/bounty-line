import { afterEach, describe, expect, it, vi } from "vitest";
import type { BountyPost } from "../src/codec";
import { posterAssets } from "../src/poster-assets";
import { CANVAS, posterSvg, renderPosterPng, type PosterInput } from "../src/poster-image";
import type { Tenant } from "../src/tenants";

const input = (p: Partial<PosterInput> = {}): PosterInput => ({
  name: "Vexa Nightwhisper",
  subtitle: "Night Elf Monk · Level 57 · Alliance",
  rewardGold: 500,
  postedBy: "Slac Jaw",
  zone: "Zone #1434",
  markedAt: 1795200000,
  bountyId: 12,
  expiresAt: 1795200000 + 14 * 86400,
  boardTag: "MT8H",
  status: "open",
  ...p,
});

const pngSize = (png: Uint8Array) => {
  const v = new DataView(png.buffer, png.byteOffset);
  return { width: v.getUint32(16), height: v.getUint32(20) };
};

const fontSize = (svg: string, text: string) => Number(new RegExp(`font-size="(\\d+)"[^>]*>${text}<`).exec(svg)?.[1]);

describe("wanted-poster layout", () => {
  it("prints the facts and an OPEN stamp", () => {
    const svg = posterSvg(input());
    for (const s of ["WANTED", "VEXA NIGHTWHISPER", "REWARD 500g", "paid by Slac Jaw", "Bounty #12 · Expires Dec 4, 2026", "Board MT8H", ">OPEN<"]) {
      expect(svg).toContain(s);
    }
  });

  it("escapes player-supplied text", () => {
    const svg = posterSvg(input({ name: `<b>"x"&'y'`, postedBy: "</text><script>" }));
    expect(svg).not.toContain("<b>");
    expect(svg).not.toContain("<script>");
    expect(svg).toContain("&lt;B&gt;&quot;X&quot;&amp;&apos;Y&apos;");
  });

  it("shrinks long names to fit the sheet", () => {
    expect(fontSize(posterSvg(input()), "VEXA NIGHTWHISPER")).toBe(72);
    expect(fontSize(posterSvg(input({ name: "Bartholomew Thistlewaite-Underhill" })), "BARTHOLOMEW THISTLEWAITE-UNDERHILL")).toBeLessThan(50);
  });

  it.each([
    ["review", "CLAIMED"],
    ["paid", "PAID"],
    ["expired", "EXPIRED"],
  ] as const)("stamps %s as %s", (status, label) => {
    expect(posterSvg(input({ status }))).toContain(`>${label}<`);
  });
});

describe("wanted-poster image", () => {
  it("renders a 3:2 PNG (Discord's card crop) on the bundled parchment", async () => {
    const png = await renderPosterPng(input(), posterAssets);
    expect(Array.from(png.slice(0, 8))).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    expect(pngSize(png)).toEqual({ width: CANVAS.width, height: CANVAS.height });
    expect(CANVAS.width / CANVAS.height).toBeCloseTo(1.5, 2);
    // The parchment really got drawn: a text-only poster is far smaller.
    expect(png.length).toBeGreaterThan(500_000);
  });
});

describe("wantedPosterImage", () => {
  afterEach(() => {
    vi.doUnmock("../src/poster-image");
    vi.resetModules();
  });

  const b = { targetName: "Vexa", targetRaceID: 4, targetClassID: 10, targetLevel: 57, targetFaction: 1, rewardGold: 1, posterName: "Slac Jaw", mapID: 1434, createdAt: 0 } as BountyPost;
  const tenant = { id: "1", board_tag: "MT8H" } as Tenant;
  const env = (POSTER_IMAGE?: string) => ({ LOG_LEVEL: "error", POSTER_IMAGE }) as never;

  it("is off when POSTER_IMAGE=false", async () => {
    const { wantedPosterImage } = await import("../src/poster");
    expect(await wantedPosterImage(env("false"), b, { id: 1, expiresAt: 0, tenant })).toBeUndefined();
  });

  it("returns nothing instead of failing the bounty when drawing breaks", async () => {
    vi.resetModules();
    vi.doMock("../src/poster-image", () => ({ renderPosterPng: () => Promise.reject(new Error("boom")) }));
    const { wantedPosterImage } = await import("../src/poster");
    expect(await wantedPosterImage(env(), b, { id: 1, expiresAt: 0, tenant })).toBeUndefined();
  });
});
