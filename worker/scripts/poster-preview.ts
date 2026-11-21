/**
 * Renders a sample wanted poster to worker/poster-preview.png (gitignored), using the
 * same code the Worker runs. Handy when changing the parchment art or the layout.
 *
 *   npm run poster-preview
 *   npm run poster-preview -- "Some Very Long Character Name" 10000
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { renderPosterPng } from "../src/poster-image";

const at = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)));
const [name = "Vexa Nightwhisper", reward = "500"] = process.argv.slice(2);
const now = Math.floor(Date.now() / 1000);

const png = await renderPosterPng(
  {
    name,
    subtitle: "Night Elf Monk · Level 57 · Alliance",
    rewardGold: Number(reward),
    postedBy: "Slac Jaw",
    zone: null,
    markedAt: now,
    bountyId: 12,
    expiresAt: now + 14 * 86400,
    boardName: "Grief Bounty Board",
    status: "open",
  },
  {
    wasm: at("../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
    parchment: at("../../art/poster/parchment.png"),
    fonts: [at("../assets/fonts/Rye-Regular.ttf"), at("../assets/fonts/IMFeENrm28P.ttf")],
  },
);
const out = fileURLToPath(new URL("../poster-preview.png", import.meta.url));
writeFileSync(out, png);
console.log(`Wrote ${out} (${Math.round(png.length / 1024)} KB)`);
