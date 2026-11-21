/**
 * src/poster-assets.ts imports the art, fonts and .wasm as wrangler modules, which Node can't
 * load. Tests get the same files from disk instead.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { vi } from "vitest";

vi.mock("../../src/poster-assets", () => {
  const read = (p: string) => readFileSync(fileURLToPath(new URL(p, import.meta.url)));
  return {
    posterAssets: {
      wasm: read("../../node_modules/@resvg/resvg-wasm/index_bg.wasm"),
      parchment: read("../../../art/poster/parchment.png"),
      fonts: [read("../../assets/fonts/Rye-Regular.ttf"), read("../../assets/fonts/IMFeENrm28P.ttf")],
    },
  };
});

/**
 * Slash commands and crons read the real clock, while the tests write rows around a fixed
 * NOW (1795200000). Pin Date to that moment so the suite doesn't start failing once the
 * real date passes a test row's expiry. Timers stay real.
 */
vi.useFakeTimers({ toFake: ["Date"], now: 1795200000_000 });
