/**
 * Gateway dispatch handling: MESSAGE_CREATE in #bounty-line, and leaving
 * servers that aren't allowlisted. Order: allowlist -> cheap filters -> rate
 * limit -> database work (Compendium 01 Section 3.4).
 */
import { extractCodes, processCode, type Outcome } from "./bounties";
import type { Attachment } from "./kills";
import { isAllowedGuild } from "./discord";
import type { Env } from "./env";
import { log } from "./log";
import { codeLimiter, imageLimiter } from "./ratelimit";
import type { DiscordRest } from "./rest";
import { getTenant } from "./tenants";

export const ERROR_REPLY_TTL_MS = 60_000;
/** Screenshots above this size are not scanned for a QR code (same limit as src/qr.ts). */
const MAX_SCAN_BYTES = 12 * 1024 * 1024;
const isScreenshot = (a: Attachment) => /^image\/(png|jpeg)\b/i.test(a.content_type ?? "") && (a.size ?? 0) <= MAX_SCAN_BYTES;

/**
 * The kill code from a proof screenshot's QR code (the addon's stamp draws it), or null.
 * Never throws: an image that can't be read is just an image.
 */
async function killCodeFromScreenshot(env: Env, shot: Attachment): Promise<string | null> {
  try {
    const res = await fetch(shot.url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength > MAX_SCAN_BYTES) return null;
    const [{ readQr }, { posterAssets }] = await Promise.all([import("./qr"), import("./poster-assets")]);
    const [code] = extractCodes((await readQr(bytes, shot.content_type ?? "", posterAssets.wasm)) ?? "", 1);
    return code && /^BL[0-9]+-K-/i.test(code) ? code : null;
  } catch (e) {
    log(env, "warn", "qr.failed", { error: String(e) });
    return null;
  }
}

interface MessageCreate {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: { id: string; bot?: boolean };
  attachments?: Attachment[];
  webhook_id?: string;
}

export interface ChatDeps {
  env: Env;
  rest: DiscordRest;
  now: () => number;
  /** Schedules work later (error-reply cleanup). */
  later: (fn: () => Promise<unknown>, ms: number) => void;
}

export async function onDispatch(deps: ChatDeps, type: string, data: unknown): Promise<void> {
  if (type === "GUILD_CREATE") {
    const guild = data as { id: string };
    if (!isAllowedGuild(deps.env, guild.id)) {
      log(deps.env, "warn", "guild.leave", { tenant_id: guild.id, outcome: "not_allowlisted" });
      await deps.rest.leaveGuild(guild.id);
    }
    return;
  }
  if (type === "MESSAGE_CREATE") await onMessage(deps, data as MessageCreate);
}

async function onMessage(deps: ChatDeps, m: MessageCreate): Promise<void> {
  const { env, rest } = deps;
  // 1. Allowlist, then free filters: no database work for bots, webhooks or normal chat.
  if (!isAllowedGuild(env, m.guild_id)) return;
  if (!m.author || m.author.bot || m.webhook_id) return;
  const codes = extractCodes(m.content ?? "");
  // No code in the text: a screenshot may carry the kill code as a QR code. A pasted code always wins.
  const shot = codes.length === 0 ? (m.attachments ?? []).find(isScreenshot) : undefined;
  if (codes.length === 0 && !shot) return;

  // 2. Only #bounty-line counts.
  const tenant = await getTenant(env.DB, m.guild_id!);
  if (!tenant || m.channel_id !== tenant.bounty_line_ch) return;

  // 3. Screenshots: scan for the QR code. People post ordinary pictures too, so anything
  //    that isn't a kill screenshot (or is over the scan limit) is silently left alone.
  if (shot) {
    if (!imageLimiter.allow(`${tenant.id}:${m.author.id}`)) return;
    const code = await killCodeFromScreenshot(env, shot);
    if (!code) return;
    codes.push(code);
  }

  // 4. Rate limit, then the real work.
  if (!codeLimiter.allow(`${tenant.id}:${m.author.id}`)) {
    await replyError(deps, m, "Slow down a little: try again in a minute.");
    return;
  }
  const outcomes: Outcome[] = [];
  for (const code of codes) {
    try {
      outcomes.push(await processCode(env, rest, tenant, code, m.author.id, deps.now(), m.attachments ?? []));
    } catch (e) {
      log(env, "error", "code.failed", { tenant_id: tenant.id, error: String(e) });
      outcomes.push({ ok: false, code: "INTERNAL", message: "Something went wrong on the Bounty Board. Try again in a minute." });
    }
  }
  const relevant = outcomes.filter((o) => o.ok !== null);
  if (relevant.length === 0) return;

  const failures = relevant.filter((o): o is Extract<Outcome, { ok: false }> => o.ok === false);
  // Success is just the reaction: the poster, the thread and the pinned pack already say the rest,
  // and a reply per code buries the channel. Failures get the reason, which deletes itself.
  await rest.react(m.channel_id, m.id, failures.length ? "❌" : "✅").catch(() => undefined);
  if (failures.length) await replyError(deps, m, [...new Set(failures.map((f) => f.message))].join("\n"));
}

/** Error replies clean themselves up after a minute (spec 7.4). */
async function replyError(deps: ChatDeps, m: MessageCreate, text: string): Promise<void> {
  const sent = await deps.rest.sendMessage(m.channel_id, `❌ ${text}`, m.id);
  deps.later(() => deps.rest.deleteMessage(m.channel_id, sent.id), ERROR_REPLY_TTL_MS);
}
