/**
 * Publishes the /bl slash commands to Discord.
 *
 *   npm run register-commands            # each server in ALLOWED_GUILD_IDS (instant)
 *   npm run register-commands -- --global  # everywhere the app is installed (up to 1 hour to appear)
 *
 * Reads DISCORD_APP_ID, DISCORD_TOKEN and ALLOWED_GUILD_IDS from the environment,
 * then worker/.dev.vars, then worker/.deploy.env. The token is never printed.
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, URL } from "node:url";
import { COMMANDS } from "../src/commands";
import { parseEnvFile } from "./render-config";

const file = (name: string) => {
  const p = fileURLToPath(new URL(`../${name}`, import.meta.url));
  return existsSync(p) ? parseEnvFile(readFileSync(p, "utf8")) : {};
};
const values: Record<string, string | undefined> = { ...file(".deploy.env"), ...file(".dev.vars"), ...process.env };

const appId = values.DISCORD_APP_ID;
const token = values.DISCORD_TOKEN;
if (!appId || !token) {
  console.error("Set DISCORD_APP_ID and DISCORD_TOKEN (environment or worker/.dev.vars).");
  process.exit(1);
}

const global = process.argv.includes("--global");
const guilds = (values.ALLOWED_GUILD_IDS ?? "").split(/[\s,]+/).filter(Boolean);
if (!global && guilds.length === 0) {
  console.error("Set ALLOWED_GUILD_IDS, or pass --global.");
  process.exit(1);
}

const targets = global
  ? [{ label: "global", url: `https://discord.com/api/v10/applications/${appId}/commands` }]
  : guilds.map((g) => ({ label: `server ${g}`, url: `https://discord.com/api/v10/applications/${appId}/guilds/${g}/commands` }));

let failed = false;
for (const t of targets) {
  const res = await fetch(t.url, {
    method: "PUT", // bulk overwrite: removes commands that no longer exist
    headers: { Authorization: `Bot ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(COMMANDS),
  });
  if (res.ok) {
    const list = (await res.json()) as { name: string }[];
    console.log(`✓ ${t.label}: registered ${list.map((c) => `/${c.name}`).join(", ")}`);
  } else {
    failed = true;
    console.error(`✗ ${t.label}: ${res.status} ${await res.text()}`);
  }
}
process.exit(failed ? 1 : 0);
