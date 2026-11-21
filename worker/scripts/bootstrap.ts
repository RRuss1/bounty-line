/**
 * Bootstrap a Bounty Board deployment from a fork (Compendium 01 Section 4.3). Used by
 * .github/workflows/bootstrap.yml; written for people doing this for the first time, so every
 * problem says what's wrong AND how to fix it, and nothing is ever deleted.
 *
 *   npx tsx scripts/bootstrap.ts preflight [--dry-run]   check everything, create D1 + R2 if missing
 *   npx tsx scripts/bootstrap.ts finish                  after deploy: health, Discord endpoint, next steps
 *
 * Reads Secrets/Variables from the environment. Writes GitHub step outputs and a step summary
 * when run in Actions (GITHUB_OUTPUT / GITHUB_STEP_SUMMARY). Never prints a secret.
 */
import { appendFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

export const CF_API = "https://api.cloudflare.com/client/v4";
export const DISCORD_API = "https://discord.com/api/v10";
/** Bot permissions (spec 13) and scopes for the invite link. */
export const BOT_PERMISSIONS = "2252126231317568";
const MESSAGE_CONTENT = (1 << 18) | (1 << 19); // GATEWAY_MESSAGE_CONTENT (+ _LIMITED)

export interface Inputs {
  workerName: string;
  d1Name: string;
  r2Bucket: string;
  allowedGuildIds: string[];
  accountId: string;
  cfToken: string;
  discordToken: string;
  discordAppId: string;
  discordPublicKey: string;
  readChat: boolean;
}

export interface Problem {
  level: "error" | "warn";
  what: string;
  fix: string;
}

export function readInputs(env: Record<string, string | undefined>): Inputs {
  const t = (k: string) => (env[k] ?? "").trim();
  const worker = t("WORKER_NAME");
  return {
    workerName: worker,
    d1Name: t("D1_NAME") || worker,
    r2Bucket: t("R2_BUCKET") || (worker ? `${worker}-proofs` : ""),
    allowedGuildIds: t("ALLOWED_GUILD_IDS").split(/[\s,]+/).filter(Boolean),
    accountId: t("CLOUDFLARE_ACCOUNT_ID"),
    cfToken: t("CLOUDFLARE_API_TOKEN"),
    discordToken: t("DISCORD_TOKEN"),
    discordAppId: t("DISCORD_APP_ID"),
    discordPublicKey: t("DISCORD_PUBLIC_KEY"),
    readChat: t("READ_CHAT").toLowerCase() !== "false",
  };
}

const SECRETS = "your fork → Settings → Secrets and variables → Actions → **Secrets** tab";
const VARIABLES = "your fork → Settings → Secrets and variables → Actions → **Variables** tab";

/** Every value present and in the right shape. Pure, so it's unit-tested. */
export function validate(i: Inputs): Problem[] {
  const p: Problem[] = [];
  const err = (what: string, fix: string) => p.push({ level: "error", what, fix });
  if (!i.cfToken) err("Secret `CLOUDFLARE_API_TOKEN` is missing.", `Create it in Cloudflare (see the guide, step 2) and add it in ${SECRETS}.`);
  else if (i.cfToken.length < 30) err("`CLOUDFLARE_API_TOKEN` looks too short.", "Copy the whole token again from Cloudflare (it's shown only once; create a new one if needed).");
  if (!i.accountId) err("Secret `CLOUDFLARE_ACCOUNT_ID` is missing.", `Cloudflare dashboard → Workers & Pages → the **Account ID** on the right. Add it in ${SECRETS}.`);
  else if (!/^[0-9a-f]{32}$/i.test(i.accountId)) err("`CLOUDFLARE_ACCOUNT_ID` should be 32 letters/numbers (0-9, a-f).", "Copy the Account ID (not the email, not the token) from the Cloudflare dashboard.");
  if (!i.discordToken) err("Secret `DISCORD_TOKEN` is missing.", `Discord Developer Portal → your app → **Bot** → Reset Token → copy. Add it in ${SECRETS}.`);
  else if (i.discordToken.split(".").length !== 3) err("`DISCORD_TOKEN` doesn't look like a bot token (it has two dots).", "Use the **Bot** tab's token, not the Client Secret or the Public Key.");
  if (!i.discordAppId) err("Secret `DISCORD_APP_ID` is missing.", `Developer Portal → your app → **General Information** → Application ID. Add it in ${SECRETS}.`);
  else if (!/^\d{17,20}$/.test(i.discordAppId)) err("`DISCORD_APP_ID` should be a long number.", "Copy the **Application ID** from General Information.");
  if (!i.discordPublicKey) err("Secret `DISCORD_PUBLIC_KEY` is missing.", `Developer Portal → **General Information** → Public Key. Add it in ${SECRETS}.`);
  else if (!/^[0-9a-f]{64}$/i.test(i.discordPublicKey)) err("`DISCORD_PUBLIC_KEY` should be 64 letters/numbers (0-9, a-f).", "Copy the **Public Key** from General Information (not the token).");
  if (!i.workerName) err("Variable `WORKER_NAME` is missing.", `Pick a name like \`bounty-board-myguild\` and add it in ${VARIABLES}.`);
  else if (!/^[a-z0-9]([a-z0-9-]{0,52}[a-z0-9])?$/.test(i.workerName)) err("`WORKER_NAME` can only use lowercase letters, numbers and dashes (max 54).", "For example: `bounty-board-myguild`.");
  if (i.d1Name && !/^[a-z0-9][a-z0-9_-]{0,63}$/.test(i.d1Name)) err("`D1_NAME` can only use lowercase letters, numbers, dashes and underscores.", "Or delete the variable to use the Worker name.");
  if (i.r2Bucket && !/^[a-z0-9][a-z0-9-]{1,61}[a-z0-9]$/.test(i.r2Bucket)) err("`R2_BUCKET` must be 3-63 lowercase letters, numbers and dashes.", "Or delete the variable to use `<WORKER_NAME>-proofs`.");
  if (!i.allowedGuildIds.length) err("Variable `ALLOWED_GUILD_IDS` is missing.", `Discord → Settings → Advanced → turn on **Developer Mode**, then right-click your server icon → **Copy Server ID**. Add it in ${VARIABLES}.`);
  for (const id of i.allowedGuildIds) if (!/^\d{17,20}$/.test(id)) err(`\`ALLOWED_GUILD_IDS\` has "${id}", which isn't a server ID.`, "Server IDs are long numbers. Separate several with commas.");
  return p;
}

export const inviteUrl = (appId: string) =>
  `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}`;

// ---------------------------------------------------------------- Cloudflare

type Fetch = typeof fetch;

export class CloudflareError extends Error {
  constructor(
    readonly status: number,
    readonly codes: number[],
    message: string,
  ) {
    super(message);
  }
}

export function cloudflare(i: Inputs, f: Fetch = fetch) {
  return async <T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
    const res = await f(CF_API + path, {
      method: init.method ?? "GET",
      headers: { Authorization: `Bearer ${i.cfToken}`, "Content-Type": "application/json" },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const json = (await res.json().catch(() => ({}))) as { success?: boolean; result?: T; errors?: { code: number; message: string }[] };
    if (!res.ok || json.success === false) {
      const errors = json.errors ?? [];
      throw new CloudflareError(res.status, errors.map((e) => e.code), errors.map((e) => e.message).join("; ") || `HTTP ${res.status}`);
    }
    return json.result as T;
  };
}

/** Plain-English fix for a Cloudflare failure on a given step. */
export function cloudflareFix(e: unknown, step: "token" | "d1" | "r2" | "subdomain"): Problem {
  const status = e instanceof CloudflareError ? e.status : 0;
  const detail = e instanceof Error ? e.message : String(e);
  const perm: Record<typeof step, string> = {
    token: "",
    d1: "**Account → D1 → Edit**",
    r2: "**Account → Workers R2 Storage → Edit**",
    subdomain: "**Account → Workers Scripts → Edit**",
  };
  if (status === 401 || status === 403) {
    return {
      level: "error",
      what: `Cloudflare refused the ${step === "token" ? "API token" : step.toUpperCase() + " request"} (${detail}).`,
      fix:
        step === "token"
          ? "The token is wrong, expired or for another account. Create a new one (guide step 2) and update `CLOUDFLARE_API_TOKEN`."
          : `Edit the API token in Cloudflare → My Profile → API Tokens and add ${perm[step]}, for the account in \`CLOUDFLARE_ACCOUNT_ID\`. Then re-run.`,
    };
  }
  if (step === "r2" && /enable|subscription|10042/i.test(detail)) {
    return { level: "error", what: "R2 isn't turned on for this Cloudflare account.", fix: "Cloudflare dashboard → **R2 Object Storage** → enable it (it has a free tier), then re-run." };
  }
  return { level: "error", what: `Cloudflare ${step} step failed: ${detail}`, fix: "Re-run the workflow in a minute. If it keeps failing, open an issue with this message." };
}

export async function verifyToken(i: Inputs, f: Fetch = fetch): Promise<Problem | null> {
  const cf = cloudflare(i, f);
  try {
    // Account-owned tokens verify under the account; user tokens under /user.
    await cf(`/accounts/${i.accountId}/tokens/verify`).catch(() => cf("/user/tokens/verify"));
    return null;
  } catch (e) {
    return cloudflareFix(e, "token");
  }
}

/** Finds the D1 database by name, creating it unless this is a dry run. */
export async function ensureD1(i: Inputs, dryRun: boolean, f: Fetch = fetch): Promise<{ id: string | null; created: boolean }> {
  const cf = cloudflare(i, f);
  const list = await cf<{ name: string; uuid: string }[]>(`/accounts/${i.accountId}/d1/database?name=${encodeURIComponent(i.d1Name)}`);
  const found = list.find((d) => d.name === i.d1Name);
  if (found) return { id: found.uuid, created: false };
  if (dryRun) return { id: null, created: false };
  const made = await cf<{ uuid: string }>(`/accounts/${i.accountId}/d1/database`, { method: "POST", body: { name: i.d1Name } });
  return { id: made.uuid, created: true };
}

export async function ensureR2(i: Inputs, dryRun: boolean, f: Fetch = fetch): Promise<{ exists: boolean; created: boolean }> {
  const cf = cloudflare(i, f);
  try {
    await cf(`/accounts/${i.accountId}/r2/buckets/${i.r2Bucket}`);
    return { exists: true, created: false };
  } catch (e) {
    if (!(e instanceof CloudflareError) || e.status !== 404) throw e;
  }
  if (dryRun) return { exists: false, created: false };
  await cf(`/accounts/${i.accountId}/r2/buckets`, { method: "POST", body: { name: i.r2Bucket } });
  return { exists: true, created: true };
}

export async function workersSubdomain(i: Inputs, f: Fetch = fetch): Promise<string | null> {
  const r = await cloudflare(i, f)<{ subdomain?: string }>(`/accounts/${i.accountId}/workers/subdomain`).catch((e) => {
    if (e instanceof CloudflareError && e.status === 404) return {} as { subdomain?: string };
    throw e;
  });
  return r.subdomain || null;
}

// ---------------------------------------------------------------- Discord

export interface DiscordApp {
  id: string;
  verify_key?: string;
  bot_public?: boolean;
  flags?: number;
  interactions_endpoint_url?: string | null;
}

const discord = (i: Inputs, f: Fetch) => (path: string, init: { method?: string; body?: unknown } = {}) =>
  f(DISCORD_API + path, {
    method: init.method ?? "GET",
    headers: { Authorization: `Bot ${i.discordToken}`, "Content-Type": "application/json", "User-Agent": "DiscordBot (bounty-board bootstrap, 1)" },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });

/** Checks the Discord app against the Secrets, and the usual setup mistakes. */
export async function checkDiscord(i: Inputs, f: Fetch = fetch): Promise<{ problems: Problem[]; app: DiscordApp | null; inGuilds: string[] }> {
  const call = discord(i, f);
  const problems: Problem[] = [];
  const res = await call("/applications/@me");
  if (res.status === 401) {
    return {
      problems: [{ level: "error", what: "Discord rejected `DISCORD_TOKEN`.", fix: "Developer Portal → **Bot** → **Reset Token**, copy it, and update the `DISCORD_TOKEN` secret." }],
      app: null,
      inGuilds: [],
    };
  }
  if (!res.ok) {
    return { problems: [{ level: "error", what: `Discord answered ${res.status} when checking the app.`, fix: "Re-run in a minute; Discord may be having a moment." }], app: null, inGuilds: [] };
  }
  const app = (await res.json()) as DiscordApp;
  if (app.id !== i.discordAppId) {
    problems.push({ level: "error", what: "`DISCORD_APP_ID` isn't the app that `DISCORD_TOKEN` belongs to.", fix: "Copy both from the **same** app in the Developer Portal." });
  }
  if (app.verify_key && i.discordPublicKey && app.verify_key.toLowerCase() !== i.discordPublicKey.toLowerCase()) {
    problems.push({ level: "error", what: "`DISCORD_PUBLIC_KEY` doesn't match this app.", fix: "Copy the **Public Key** from General Information of the same app." });
  }
  if (app.bot_public) {
    problems.push({ level: "warn", what: "**Public Bot** is on: anyone could add your bot to their server.", fix: "Developer Portal → **Bot** → turn **Public Bot** off. (The allowlist still protects you, but this keeps it tidy.)" });
  }
  if (i.readChat && !((app.flags ?? 0) & MESSAGE_CONTENT)) {
    problems.push({
      level: "warn",
      what: "**Message Content Intent** is off, so the bot can't read codes pasted in chat.",
      fix: "Developer Portal → **Bot** → turn on **Message Content Intent** and save. (Or set Variable `READ_CHAT=false` for budget mode: players use `/bl submit`.)",
    });
  }
  const guilds = await call("/users/@me/guilds");
  const inGuilds = guilds.ok ? ((await guilds.json()) as { id: string }[]).map((g) => g.id) : [];
  return { problems, app, inGuilds };
}

/** Points Discord at the Worker. Discord sends a signed PING first, so the Worker must be up. */
export async function setInteractionsUrl(i: Inputs, url: string, f: Fetch = fetch): Promise<{ ok: boolean; detail: string }> {
  const res = await discord(i, f)("/applications/@me", { method: "PATCH", body: { interactions_endpoint_url: url } });
  return { ok: res.ok, detail: res.ok ? "" : `${res.status} ${(await res.text()).slice(0, 200)}` };
}

export async function waitForHealth(url: string, f: Fetch = fetch, tries = 12, delayMs = 5000): Promise<{ ok: boolean; detail: string }> {
  let detail = "";
  for (let n = 0; n < tries; n++) {
    try {
      const res = await f(url);
      const body = (await res.json().catch(() => ({}))) as { db?: string; version?: string };
      if (res.ok && body.db === "ok") return { ok: true, detail: `version ${body.version}` };
      detail = `HTTP ${res.status}, db ${body.db ?? "?"}`;
    } catch (e) {
      detail = String(e);
    }
    if (n < tries - 1) await new Promise((r) => setTimeout(r, delayMs));
  }
  return { ok: false, detail };
}

// ---------------------------------------------------------------- report

export function report(title: string, done: string[], problems: Problem[], next: string[]): string {
  const errors = problems.filter((p) => p.level === "error");
  const warns = problems.filter((p) => p.level === "warn");
  const row = (p: Problem) => `| ${p.what} | ${p.fix} |`;
  return [
    `## ${errors.length ? "❌" : warns.length ? "⚠️" : "✅"} ${title}`,
    "",
    ...(done.length ? ["**Done**", "", ...done.map((d) => `- ${d}`), ""] : []),
    ...(errors.length ? ["**Must fix before going on**", "", "| Problem | How to fix |", "|---|---|", ...errors.map(row), ""] : []),
    ...(warns.length ? ["**Worth fixing**", "", "| Warning | How to fix |", "|---|---|", ...warns.map(row), ""] : []),
    ...(next.length ? ["**Next**", "", ...next.map((n, k) => `${k + 1}. ${n}`), ""] : []),
  ].join("\n");
}

function emit(summary: string, outputs: Record<string, string>, problems: Problem[]) {
  for (const p of problems) console.log(`::${p.level === "error" ? "error" : "warning"} title=${p.what.replace(/[`*]/g, "")}::${p.fix.replace(/[`*]/g, "")}`);
  console.log(summary);
  if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, summary + "\n");
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, Object.entries(outputs).map(([k, v]) => `${k}=${v}\n`).join(""));
}

// ---------------------------------------------------------------- CLI

async function preflight(dryRun: boolean): Promise<number> {
  const i = readInputs(process.env);
  const problems = validate(i);
  const done: string[] = [];
  const outputs: Record<string, string> = { d1_name: i.d1Name, r2_bucket: i.r2Bucket };
  if (problems.some((p) => p.level === "error")) {
    emit(report("Bootstrap: settings need fixing", done, problems, ["Fix the settings above, then run **Bootstrap deployment** again."]), outputs, problems);
    return 1;
  }
  done.push("All Secrets and Variables are present and look right.");

  const tokenProblem = await verifyToken(i);
  if (tokenProblem) problems.push(tokenProblem);
  else done.push("Cloudflare API token works.");

  const d = await checkDiscord(i);
  problems.push(...d.problems);
  if (d.app && !d.problems.some((p) => p.level === "error")) done.push("Discord bot token, Application ID and Public Key all belong to the same app.");

  if (!tokenProblem) {
    try {
      const sub = await workersSubdomain(i);
      if (sub) {
        outputs.subdomain = sub;
        outputs.worker_url = `https://${i.workerName}.${sub}.workers.dev`;
        done.push(`Your bot will live at \`${outputs.worker_url}\`.`);
      } else {
        problems.push({ level: "error", what: "This Cloudflare account has no workers.dev subdomain yet.", fix: "Cloudflare dashboard → **Workers & Pages** → it asks you to pick a subdomain the first time. Pick one, then re-run." });
      }
    } catch (e) {
      problems.push(cloudflareFix(e, "subdomain"));
    }
    try {
      const db = await ensureD1(i, dryRun);
      if (db.id) outputs.d1_id = db.id;
      done.push(db.created ? `Created database \`${i.d1Name}\`.` : db.id ? `Database \`${i.d1Name}\` already exists (kept as is).` : `Database \`${i.d1Name}\` will be created.`);
    } catch (e) {
      problems.push(cloudflareFix(e, "d1"));
    }
    try {
      const r2 = await ensureR2(i, dryRun);
      done.push(r2.created ? `Created screenshot storage \`${i.r2Bucket}\`.` : r2.exists ? `Screenshot storage \`${i.r2Bucket}\` already exists.` : `Screenshot storage \`${i.r2Bucket}\` will be created.`);
    } catch (e) {
      problems.push(cloudflareFix(e, "r2"));
    }
  }

  const missing = i.allowedGuildIds.filter((g) => !d.inGuilds.includes(g));
  const failed = problems.some((p) => p.level === "error");
  const next = failed
    ? ["Fix the problems above, then run **Bootstrap deployment** again. Nothing has been changed that a re-run can't pick up."]
    : dryRun
      ? ["Everything checks out. Run **Bootstrap deployment** again with **Dry run** unticked to deploy."]
      : [];
  if (!failed && !dryRun && missing.length) outputs.invite = inviteUrl(i.discordAppId);
  emit(report(dryRun ? "Bootstrap dry run" : "Bootstrap: checks and storage", done, problems, next), outputs, problems);
  return failed ? 1 : 0;
}

async function finish(): Promise<number> {
  const i = readInputs(process.env);
  const base = process.env.WORKER_URL ?? "";
  const problems: Problem[] = [];
  const done: string[] = [];
  const health = await waitForHealth(`${base}/health`);
  if (health.ok) done.push(`The bot is up: \`${base}/health\` answers OK (${health.detail}).`);
  else problems.push({ level: "error", what: `The bot didn't answer at \`${base}/health\` (${health.detail}).`, fix: "Wait a minute and open that link in a browser. If it still fails, check the **Deploy** step above for errors." });

  const endpoint = `${base}/interactions`;
  const d = await checkDiscord(i);
  let endpointSet = d.app?.interactions_endpoint_url === endpoint;
  if (health.ok && !endpointSet) {
    const r = await setInteractionsUrl(i, endpoint);
    endpointSet = r.ok;
    if (r.ok) done.push(`Set Discord's **Interactions Endpoint URL** to \`${endpoint}\`.`);
    else problems.push({ level: "warn", what: `Couldn't set the Interactions Endpoint URL automatically (${r.detail}).`, fix: `Developer Portal → **General Information** → paste \`${endpoint}\` into **Interactions Endpoint URL** → Save.` });
  } else if (endpointSet) done.push("Discord's Interactions Endpoint URL already points at the bot.");

  const missing = i.allowedGuildIds.filter((g) => !d.inGuilds.includes(g));
  const next = [
    ...(missing.length ? [`**Invite your bot**: open ${inviteUrl(i.discordAppId)}, pick your server, Authorize.`] : []),
    ...(missing.length ? ["Re-run the **Deploy Worker** workflow once (Actions tab) so slash commands appear in your server."] : []),
    "In your Discord, make a text channel `#bounty-line` and a **forum** channel `#bounty-board` (forum settings → Default Layout: **Gallery**).",
    "Forum `#bounty-board` → Edit Channel → Permissions → add your bot's role → allow **Manage Channels** (for the status tags).",
    "Run **`/bl setup`** in your server and pick those channels, your officer role and your in-game guild name.",
    "Tell your guild to install **Bounty Line** from CurseForge and `/bl import` the pinned Bounty Pack. Done!",
  ];
  emit(report("Your Bounty Board is deployed", done, problems, next), {}, problems);
  return problems.some((p) => p.level === "error") ? 1 : 0;
}

/** For Deploy Worker in forks that never set D1_ID: find the database by name (never creates). */
async function resolveD1(): Promise<number> {
  const i = readInputs(process.env);
  const db = await ensureD1(i, true);
  if (!db.id) {
    console.log(`::error title=Database not found::No D1 database named "${i.d1Name}". Run the Bootstrap deployment workflow first (Actions tab).`);
    return 1;
  }
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `d1_id=${db.id}\n`);
  console.log(`Using database "${i.d1Name}".`);
  return 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [cmd] = process.argv.slice(2);
  const dryRun = process.argv.includes("--dry-run");
  const run = cmd === "preflight" ? preflight(dryRun) : cmd === "finish" ? finish() : cmd === "resolve-d1" ? resolveD1() : Promise.resolve(2);
  run.then((code) => process.exit(code)).catch((e) => {
    console.log(`::error title=Bootstrap crashed::${String(e)}`);
    process.exit(1);
  });
}
