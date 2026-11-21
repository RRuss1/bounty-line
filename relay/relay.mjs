#!/usr/bin/env node
// Bounty Line Relay: carries data between the game and your Bounty Board so nobody pastes.
//   - Every minute it fetches the Bounty Pack and writes it where the game loads it
//     (Interface\AddOns\BountyLine_Relay). Your next login or /reload picks it up.
//   - It watches your Screenshots folder for the QR frames the addon makes when a guildie
//     sets a bounty, and sends those bounty codes to the Bounty Board.
// It only reads screenshots and writes one data file. It never types or clicks in the game.
// Setup and details: docs/relay.md
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, watch, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { RELAY_TOC, dataLua, isBountyCode, parseSetupCode, readQr } from "./lib.mjs";

const CONFIG = fileURLToPath(new URL("./config.json", import.meta.url));
const DEFAULT_WOW = "C:\\Program Files (x86)\\World of Warcraft\\_forever_";
const POLL_MS = 60_000;
const say = (text) => console.log(`[${new Date().toLocaleTimeString()}] ${text}`);

// ---------------------------------------------------------------- setup

async function loadConfig() {
  let config = {};
  if (existsSync(CONFIG)) {
    try {
      config = JSON.parse(readFileSync(CONFIG, "utf8"));
    } catch {
      console.log("config.json couldn't be read; starting setup again.");
    }
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    while (!parseSetupCode(config.setup)) {
      console.log("\nIn Discord, run:  /bl relay action: enable");
      console.log("Then paste the relay setup code it gives you (starts with BLR1).");
      config.setup = (await rl.question("Setup code: ")).trim();
      if (!parseSetupCode(config.setup)) console.log("That doesn't look like a setup code. Copy the whole thing, from BLR1 to the end.");
    }
    while (!config.wow || !existsSync(join(config.wow, "Interface", "AddOns"))) {
      if (!config.wow && existsSync(join(DEFAULT_WOW, "Interface", "AddOns"))) {
        config.wow = DEFAULT_WOW;
        break;
      }
      console.log("\nWhere is your WoW: Forever folder? It's the one that contains Interface and Screenshots.");
      config.wow = (await rl.question(`Folder [${DEFAULT_WOW}]: `)).trim().replace(/^"|"$/g, "") || DEFAULT_WOW;
      if (!existsSync(join(config.wow, "Interface", "AddOns"))) console.log("I can't find Interface\\AddOns in there. Try again.");
    }
  } finally {
    rl.close();
  }
  writeFileSync(CONFIG, JSON.stringify(config, null, 2));
  return { ...parseSetupCode(config.setup), wow: config.wow };
}

// ---------------------------------------------------------------- Discord -> game: the pack

function makePackWriter(wow) {
  const dir = join(wow, "Interface", "AddOns", "BountyLine_Relay");
  let codes = null;
  const firstTime = !existsSync(dir);
  mkdirSync(dir, { recursive: true });
  for (const toc of ["BountyLine_Relay.toc", "BountyLine_Relay_Forever.toc"]) writeFileSync(join(dir, toc), RELAY_TOC);
  if (firstTime) say("Created Interface\\AddOns\\BountyLine_Relay. Restart WoW once so it sees the new folder.");
  return {
    /** Rewrites Data.lua: the pack (when given) and "the relay was running at this time". */
    write(newCodes) {
      if (newCodes) codes = newCodes;
      writeFileSync(join(dir, "Data.lua"), dataLua(codes, Math.floor(Date.now() / 1000)));
    },
  };
}

async function pollPack(config, writer, state) {
  try {
    const res = await fetch(`${config.url}/relay/pack`, {
      headers: { Authorization: `Bearer ${config.token}`, ...(state.etag ? { "If-None-Match": state.etag } : {}) },
    });
    if (res.status === 304) return writer.write(null);
    if (res.status === 401) return stop("The Bounty Board refused the relay token. Run /bl relay action: enable again, delete relay\\config.json and restart.");
    if (!res.ok) return say(`Bounty Board answered ${res.status} for the pack; trying again in a minute.`);
    const body = await res.json();
    writer.write(body.codes);
    const first = state.etag === undefined;
    state.etag = res.headers.get("ETag") ?? "";
    say(`${first ? "Bounty Pack ready" : "\x07Bounty Pack changed"}: ${body.count} open ${body.count === 1 ? "bounty" : "bounties"}. /reload in game to load it.`);
  } catch (e) {
    say(`Couldn't reach the Bounty Board (${e.message}); trying again in a minute.`);
  }
}

// ---------------------------------------------------------------- game -> Discord: bounty codes

function watchScreenshots(config) {
  const dir = join(config.wow, "Screenshots");
  mkdirSync(dir, { recursive: true });
  const seen = new Set(readdirSync(dir)); // only screenshots taken from now on
  const sent = new Set();
  const handle = async (name, attempt = 1) => {
    const file = join(dir, name);
    let code;
    try {
      code = readQr(readFileSync(file), name);
    } catch {
      return; // moved or deleted meanwhile
    }
    if (!isBountyCode(code)) return; // an ordinary screenshot, or a kill proof: not ours to touch
    const remove = () => {
      try {
        unlinkSync(file);
      } catch {
        /* already gone */
      }
    };
    if (sent.has(code)) return remove();
    try {
      const res = await fetch(`${config.url}/relay/code`, {
        method: "POST",
        headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const body = await res.json().catch(() => ({}));
      if (res.status === 401) return stop("The Bounty Board refused the relay token. Run /bl relay action: enable again, delete relay\\config.json and restart.");
      if (res.status === 429 || res.status >= 500) throw new Error(`Bounty Board answered ${res.status}`);
      sent.add(code);
      remove();
      say(body.ok ? `Posted a guildie's bounty (#${body.bountyId}).` : `A relayed bounty was refused: ${body.message ?? body.code ?? res.status}`);
    } catch (e) {
      if (attempt >= 5) return say(`Gave up on one bounty code after 5 tries (${e.message}). The screenshot is still in your folder.`);
      setTimeout(() => handle(name, attempt + 1), 30_000);
    }
  };
  watch(dir, (_, name) => {
    if (!name || seen.has(name) || !/\.(jpe?g|png)$/i.test(name)) return;
    seen.add(name);
    // Give the game a moment to finish writing the file.
    setTimeout(() => {
      try {
        if (statSync(join(dir, name)).size > 0) handle(name);
      } catch {
        /* gone */
      }
    }, 1500);
  });
  say(`Watching ${dir}`);
}

function stop(message) {
  console.error(`\n${message}`);
  process.exit(1);
}

// ---------------------------------------------------------------- run

const config = await loadConfig();
console.log(`\nBounty Line Relay is running for ${config.url}. Leave this window open while you play. Ctrl+C stops it.\n`);
const writer = makePackWriter(config.wow);
const state = {};
watchScreenshots(config);
await pollPack(config, writer, state);
setInterval(() => pollPack(config, writer, state), POLL_MS);
