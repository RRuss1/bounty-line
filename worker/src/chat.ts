/**
 * Gateway dispatch handling: MESSAGE_CREATE in #bounty-line, and leaving
 * servers that aren't allowlisted. Order: allowlist -> cheap filters -> rate
 * limit -> database work (Compendium 01 Section 3.4).
 */
import { extractCodes, processCode, type Outcome } from "./bounties";
import { isAllowedGuild } from "./discord";
import type { Env } from "./env";
import { log } from "./log";
import { codeLimiter } from "./ratelimit";
import type { DiscordRest } from "./rest";
import { getTenant } from "./tenants";

export const ERROR_REPLY_TTL_MS = 60_000;

interface MessageCreate {
  id: string;
  channel_id: string;
  guild_id?: string;
  content?: string;
  author?: { id: string; bot?: boolean };
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
  if (codes.length === 0) return;

  // 2. Only #bounty-line counts.
  const tenant = await getTenant(env.DB, m.guild_id!);
  if (!tenant || m.channel_id !== tenant.bounty_line_ch) return;

  // 3. Rate limit, then the real work.
  if (!codeLimiter.allow(`${tenant.id}:${m.author.id}`)) {
    await replyError(deps, m, "Slow down a little: try again in a minute.");
    return;
  }
  const outcomes: Outcome[] = [];
  for (const code of codes) {
    try {
      outcomes.push(await processCode(env, rest, tenant, code, m.author.id, deps.now()));
    } catch (e) {
      log(env, "error", "code.failed", { tenant_id: tenant.id, error: String(e) });
      outcomes.push({ ok: false, code: "INTERNAL", message: "Something went wrong on the Bounty Board. Try again in a minute." });
    }
  }
  const relevant = outcomes.filter((o) => o.ok !== null);
  if (relevant.length === 0) return;

  const failures = relevant.filter((o): o is Extract<Outcome, { ok: false }> => o.ok === false);
  const successes = relevant.filter((o): o is Extract<Outcome, { ok: true }> => o.ok === true);
  await rest.react(m.channel_id, m.id, failures.length ? "❌" : "✅").catch(() => undefined);
  if (successes.length) await rest.sendMessage(m.channel_id, successes.map((s) => s.message).join("\n"), m.id);
  if (failures.length) await replyError(deps, m, [...new Set(failures.map((f) => f.message))].join("\n"));
}

/** Error replies clean themselves up after a minute (spec 7.4). */
async function replyError(deps: ChatDeps, m: MessageCreate, text: string): Promise<void> {
  const sent = await deps.rest.sendMessage(m.channel_id, `❌ ${text}`, m.id);
  deps.later(() => deps.rest.deleteMessage(m.channel_id, sent.id), ERROR_REPLY_TTL_MS);
}
