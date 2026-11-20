import type { Env } from "./env";

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 } as const;
type Level = keyof typeof LEVELS;

/** Structured JSON log line for `wrangler tail` (Compendium 01 Section 7). */
export function log(env: Pick<Env, "LOG_LEVEL">, level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const min = LEVELS[(env.LOG_LEVEL as Level) ?? "info"] ?? LEVELS.info;
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}
