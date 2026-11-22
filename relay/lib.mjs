// Pure pieces of the Bounty Line Relay, kept apart so they can be tested without the game.
import jpeg from "jpeg-js";
import jsQR from "jsqr";
import { PNG } from "pngjs";

/** "BLR1.<address, base64url>.<guildId>.<secret>" from /bl relay -> { url, token }, or null. */
export function parseSetupCode(text) {
  const m = String(text ?? "").trim().match(/^BLR1\.([A-Za-z0-9_-]+)\.(\d{17,20}\.[A-Za-z0-9_-]{20,80})$/);
  if (!m) return null;
  let url;
  try {
    url = new URL(Buffer.from(m[1], "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.pathname !== "/" || url.search || url.hash || url.username) return null;
  return { url: url.origin, token: m[2] };
}

/** Bounty Line codes are uppercase letters, digits and dashes. Nothing else is ever written into the game's files. */
export const isCode = (text) => typeof text === "string" && /^BL[0-9]+-[A-Z]{1,2}-[0-9A-Z]+(?:-[0-9A-Z]+)+$/.test(text);
// B: a bounty on one player. S: an Open Season on a whole guild.
export const isBountyCode = (text) => isCode(text) && /^BL[0-9]+-[BS]-/.test(text);

/**
 * The Lua file the game loads at login or /reload (BountyLine_Relay/Data.lua).
 * codes: the pack's part codes, or null for "no pack yet". Throws on anything that isn't a
 * plain code: this text is run by the game, so it must never carry anything else.
 */
export function dataLua(codes, aliveAt) {
  if (!Number.isInteger(aliveAt) || aliveAt < 0) throw new Error("bad time");
  const list = codes ?? [];
  if (!Array.isArray(list) || list.length > 8 || !list.every(isCode)) throw new Error("refusing to write something that isn't a Bounty Line code");
  return [
    "-- Written by the Bounty Line relay program. Safe to delete; it is rewritten every minute.",
    `BountyLine_RelayAlive = ${aliveAt}`,
    `BountyLine_RelayPack = ${list.length ? `"${list.join(" ")}"` : "nil"}`,
    "",
  ].join("\n");
}

export const RELAY_TOC = [
  "## Interface: 16001",
  "## Title: Bounty Line Relay Data",
  "## Notes: Written by the Bounty Line relay program on this PC. Holds the latest Bounty Pack. Safe to delete.",
  "Data.lua",
  "",
].join("\n");

function pixels(bytes, name) {
  if (/\.png$/i.test(name)) {
    const png = PNG.sync.read(Buffer.from(bytes));
    return { data: png.data, width: png.width, height: png.height };
  }
  if (/\.jpe?g$/i.test(name)) return jpeg.decode(bytes, { useTArray: true, maxMemoryUsageInMB: 1024 });
  return null;
}

/** Where the addon draws its QR codes: lower left, under the stamp's band. Tried before the whole picture. */
const REGION = { x: 0, y: 0.5, w: 0.35, h: 0.42 };

/** The text of the QR code in a screenshot file, or null. */
export function readQr(bytes, name) {
  let img;
  try {
    img = pixels(bytes, name);
  } catch {
    return null;
  }
  if (!img) return null;
  const { width: W, height: H } = img;
  const scan = (x0, y0, w, h) => {
    const out = new Uint8ClampedArray(w * h * 4);
    for (let y = 0; y < h; y++) out.set(img.data.subarray(((y0 + y) * W + x0) * 4, ((y0 + y) * W + x0 + w) * 4), y * w * 4);
    return jsQR(out, w, h)?.data || null;
  };
  return scan(Math.floor(W * REGION.x), Math.floor(H * REGION.y), Math.floor(W * REGION.w), Math.floor(H * REGION.h)) ?? scan(0, 0, W, H);
}
