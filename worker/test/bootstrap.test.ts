import { describe, expect, it } from "vitest";
import {
  BOT_PERMISSIONS,
  checkDiscord,
  CloudflareError,
  cloudflareFix,
  ensureD1,
  ensureR2,
  inviteUrl,
  readInputs,
  report,
  setInteractionsUrl,
  validate,
  waitForHealth,
  workersSubdomain,
  type Inputs,
} from "../scripts/bootstrap";

const GOOD: Record<string, string> = {
  WORKER_NAME: "bounty-board-myguild",
  ALLOWED_GUILD_IDS: "123456789012345678",
  CLOUDFLARE_ACCOUNT_ID: "0123456789abcdef0123456789abcdef",
  CLOUDFLARE_API_TOKEN: "x".repeat(40),
  DISCORD_TOKEN: "MTIz.abc.def-ghi",
  DISCORD_APP_ID: "400000000000000000",
  DISCORD_PUBLIC_KEY: "a".repeat(64),
};
const inputs = (over: Record<string, string> = {}): Inputs => readInputs({ ...GOOD, ...over });

/** A fake fetch: routes "METHOD path" (Cloudflare/Discord prefix stripped) to handlers. */
function fake(routes: Record<string, (body: unknown) => { status?: number; json: unknown }>) {
  const calls: { method: string; path: string; body: unknown }[] = [];
  const f = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    const path = url.pathname.replace(/^\/client\/v4|^\/api\/v10/, "") + url.search;
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, path, body });
    const h = routes[`${method} ${path}`];
    if (!h) return new Response(JSON.stringify({ success: false, errors: [{ code: 7003, message: "not found" }] }), { status: 404 });
    const r = h(body);
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200 });
  }) as typeof fetch;
  return { f, calls };
}
const ok = (result: unknown) => () => ({ json: { success: true, result } });

describe("settings check", () => {
  it("passes good settings and fills in default names", () => {
    expect(validate(inputs())).toEqual([]);
    expect(inputs()).toMatchObject({ d1Name: "bounty-board-myguild", r2Bucket: "bounty-board-myguild-proofs", readChat: true });
  });

  it("names every missing secret and variable, with where to get it", () => {
    const problems = validate(readInputs({}));
    const text = problems.map((p) => `${p.what} ${p.fix}`).join("\n");
    for (const name of ["CLOUDFLARE_API_TOKEN", "CLOUDFLARE_ACCOUNT_ID", "DISCORD_TOKEN", "DISCORD_APP_ID", "DISCORD_PUBLIC_KEY", "WORKER_NAME", "ALLOWED_GUILD_IDS"]) {
      expect(text).toContain(name);
    }
    expect(problems.every((p) => p.level === "error" && p.fix.length > 10)).toBe(true);
    expect(text).toContain("Developer Mode");
  });

  it.each([
    ["WORKER_NAME", "Bounty Board", "lowercase"],
    ["CLOUDFLARE_ACCOUNT_ID", "me@example.com", "32 letters"],
    ["DISCORD_TOKEN", "abcdef", "two dots"],
    ["DISCORD_APP_ID", "my-app", "long number"],
    ["DISCORD_PUBLIC_KEY", "a".repeat(10), "64 letters"],
    ["ALLOWED_GUILD_IDS", "123, my server", "isn't a server ID"],
    ["R2_BUCKET", "No", "3-63"],
  ])("catches a bad %s", (key, value, hint) => {
    expect(validate(inputs({ [key]: value })).map((p) => p.what + p.fix).join(" ")).toContain(hint);
  });
});

describe("Cloudflare", () => {
  it("keeps an existing database, creates a missing one, and doesn't create on a dry run", async () => {
    const existing = fake({ "GET /accounts/0123456789abcdef0123456789abcdef/d1/database?name=bounty-board-myguild": ok([{ name: "bounty-board-myguild", uuid: "db-1" }]) });
    expect(await ensureD1(inputs(), false, existing.f)).toEqual({ id: "db-1", created: false });

    const missing = fake({
      "GET /accounts/0123456789abcdef0123456789abcdef/d1/database?name=bounty-board-myguild": ok([]),
      "POST /accounts/0123456789abcdef0123456789abcdef/d1/database": ok({ uuid: "db-new" }),
    });
    expect(await ensureD1(inputs(), true, missing.f)).toEqual({ id: null, created: false });
    expect(missing.calls.some((c) => c.method === "POST")).toBe(false);
    expect(await ensureD1(inputs(), false, missing.f)).toEqual({ id: "db-new", created: true });
    expect(missing.calls.find((c) => c.method === "POST")!.body).toEqual({ name: "bounty-board-myguild" });
  });

  it("creates the screenshot bucket only when it's missing", async () => {
    const acct = "/accounts/0123456789abcdef0123456789abcdef/r2/buckets";
    const exists = fake({ [`GET ${acct}/bounty-board-myguild-proofs`]: ok({ name: "x" }) });
    expect(await ensureR2(inputs(), false, exists.f)).toEqual({ exists: true, created: false });
    const missing = fake({ [`POST ${acct}`]: ok({}) });
    expect(await ensureR2(inputs(), true, missing.f)).toEqual({ exists: false, created: false });
    expect(await ensureR2(inputs(), false, missing.f)).toEqual({ exists: true, created: true });
  });

  it("finds the workers.dev subdomain, or says there isn't one", async () => {
    const sub = "GET /accounts/0123456789abcdef0123456789abcdef/workers/subdomain";
    expect(await workersSubdomain(inputs(), fake({ [sub]: ok({ subdomain: "myguild" }) }).f)).toBe("myguild");
    expect(await workersSubdomain(inputs(), fake({}).f)).toBeNull();
  });

  it("turns permission errors into the exact token permission to add", () => {
    expect(cloudflareFix(new CloudflareError(403, [10000], "Authentication error"), "d1").fix).toContain("D1 → Edit");
    expect(cloudflareFix(new CloudflareError(403, [10000], "Authentication error"), "r2").fix).toContain("R2 Storage → Edit");
    expect(cloudflareFix(new CloudflareError(401, [], "Invalid token"), "token").fix).toContain("Create a new one");
    expect(cloudflareFix(new CloudflareError(400, [10042], "Please enable R2 through the Cloudflare Dashboard."), "r2").what).toContain("R2 isn't turned on");
  });
});

describe("Discord", () => {
  const app = (over: Record<string, unknown> = {}) =>
    fake({
      "GET /applications/@me": () => ({ json: { id: "400000000000000000", verify_key: "a".repeat(64), bot_public: false, flags: 1 << 18, ...over } }),
      "GET /users/@me/guilds": () => ({ json: [{ id: "123456789012345678" }] }),
    }).f;

  it("is happy with a well set-up app", async () => {
    const r = await checkDiscord(inputs(), app());
    expect(r.problems).toEqual([]);
    expect(r.inGuilds).toEqual(["123456789012345678"]);
  });

  it("catches a wrong token, a mismatched app id or public key", async () => {
    const bad = fake({ "GET /applications/@me": () => ({ status: 401, json: {} }) });
    expect((await checkDiscord(inputs(), bad.f)).problems[0]!.fix).toContain("Reset Token");
    expect((await checkDiscord(inputs(), app({ id: "999999999999999999" }))).problems[0]!.what).toContain("DISCORD_APP_ID");
    expect((await checkDiscord(inputs(), app({ verify_key: "b".repeat(64) }))).problems[0]!.what).toContain("DISCORD_PUBLIC_KEY");
  });

  it("warns about Public Bot and a missing Message Content Intent (unless budget mode)", async () => {
    const warns = (await checkDiscord(inputs(), app({ bot_public: true, flags: 0 }))).problems;
    expect(warns.map((p) => p.level)).toEqual(["warn", "warn"]);
    expect(warns.map((p) => p.what).join(" ")).toMatch(/Public Bot.*Message Content/s);
    expect((await checkDiscord(inputs({ READ_CHAT: "false" }), app({ flags: 0 }))).problems).toEqual([]);
  });

  it("sets the Interactions Endpoint URL, and reports Discord's refusal", async () => {
    const yes = fake({ "PATCH /applications/@me": () => ({ json: {} }) });
    expect(await setInteractionsUrl(inputs(), "https://x.workers.dev/interactions", yes.f)).toEqual({ ok: true, detail: "" });
    expect(yes.calls[0]!.body).toEqual({ interactions_endpoint_url: "https://x.workers.dev/interactions" });
    const no = fake({ "PATCH /applications/@me": () => ({ status: 400, json: { message: "Interactions endpoint url could not be verified" } }) });
    expect((await setInteractionsUrl(inputs(), "https://x", no.f)).detail).toContain("could not be verified");
  });

  it("builds the invite link with the bot's permissions", () => {
    expect(inviteUrl("400000000000000000")).toBe(
      `https://discord.com/oauth2/authorize?client_id=400000000000000000&scope=bot+applications.commands&permissions=${BOT_PERMISSIONS}`,
    );
  });
});

describe("health and the summary page", () => {
  it("waits for /health to report the database OK", async () => {
    let n = 0;
    const f = (async () => {
      n++;
      return new Response(JSON.stringify(n < 3 ? { db: "error" } : { db: "ok", version: "0.6.0" }), { status: n < 3 ? 503 : 200 });
    }) as typeof fetch;
    expect(await waitForHealth("https://x/health", f, 5, 0)).toEqual({ ok: true, detail: "version 0.6.0" });
    expect((await waitForHealth("https://x/health", (async () => new Response("{}", { status: 500 })) as typeof fetch, 2, 0)).ok).toBe(false);
  });

  it("puts errors before warnings, each with its fix, then numbered next steps", () => {
    const md = report("Dry run", ["Checked."], [
      { level: "warn", what: "W", fix: "fix w" },
      { level: "error", what: "E", fix: "fix e" },
    ], ["Do this", "Then that"]);
    expect(md.indexOf("Must fix")).toBeLessThan(md.indexOf("Worth fixing"));
    expect(md).toContain("| E | fix e |");
    expect(md).toContain("1. Do this\n2. Then that");
    expect(md.startsWith("## ❌")).toBe(true);
  });
});
