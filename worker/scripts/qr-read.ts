/**
 * Reads the QR code from a screenshot the same way the bot does. For checking real files:
 *   npx tsx scripts/qr-read.ts "C:\path\to\WoWScrnShot_....jpg"
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { readQr } from "../src/qr";

const file = process.argv[2];
if (!file) {
  console.error("usage: tsx scripts/qr-read.ts <screenshot.jpg|png>");
  process.exit(1);
}
const wasm = readFileSync(fileURLToPath(new URL("../node_modules/@resvg/resvg-wasm/index_bg.wasm", import.meta.url)));
const image = new Uint8Array(readFileSync(file));
const started = Date.now();
const text = await readQr(image, /\.png$/i.test(file) ? "image/png" : "image/jpeg", wasm);
console.log(text ?? "(no QR code found)", `· ${Date.now() - started} ms`);
