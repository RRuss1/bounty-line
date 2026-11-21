/**
 * AI stamp check (spec 9.3 check 5): a Workers AI vision model reads the proof stamp in the
 * kill screenshot and we compare it with the pasted kill code.
 *
 * Never blocks a claim: off (AI_CHECK=false), no binding, over the daily cap, or any error
 * all mean "skipped" and the claim goes to officers as before.
 */
import { normalize } from "./codec";
import type { Env } from "./env";
import { log } from "./log";

export const DEFAULT_MODEL = "@cf/meta/llama-4-scout-17b-16e-instruct";

export type StampResult =
  | { status: "match"; read: StampRead }
  | { status: "mismatch"; read: StampRead }
  | { status: "unreadable"; read?: StampRead }
  | { status: "skipped"; reason: "off" | "cap" | "error" };

export interface StampRead {
  found: boolean;
  code?: string;
  target?: string;
  bountyId?: number;
}

const PROMPT = [
  "This is a World of Warcraft screenshot. In the middle there should be a dark band with a red top and bottom edge,",
  'titled "BOUNTY LINE · KILL CONFIRMED". Read it exactly. Reply with JSON only, no other text:',
  '{"found": true|false, "code": "<the BL1-K-... code, exactly>", "target": "<the name before the first ·>", "bountyId": <the number after Bounty #>}',
  'If there is no such band, reply {"found": false}.',
].join(" ");

/** Pulls the first {...} out of a model reply and reads the fields we care about. */
export function parseStamp(text: string): StampRead | null {
  const m = /\{[\s\S]*\}/.exec(text);
  if (!m) return null;
  try {
    const o = JSON.parse(m[0]) as Record<string, unknown>;
    return {
      found: o.found === true,
      code: typeof o.code === "string" ? o.code : undefined,
      target: typeof o.target === "string" ? o.target.trim() : undefined,
      bountyId: typeof o.bountyId === "number" ? o.bountyId : Number(o.bountyId) || undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Match = the stamp shows this exact code, or (since OCR can slip a character in a long code)
 * the same bounty number and target name.
 */
export function compareStamp(read: StampRead, code: string, bountyId: number, target: string): "match" | "mismatch" | "unreadable" {
  if (!read.found) return "unreadable";
  const sameCode = !!read.code && normalize(read.code) === normalize(code);
  const sameBounty = read.bountyId === bountyId && !!read.target && read.target.toLowerCase() === target.toLowerCase();
  if (sameCode || sameBounty) return "match";
  if (!read.code && !read.bountyId) return "unreadable";
  return "mismatch";
}

/** Counts one AI call against today's cap. Returns false (no call) when the cap is reached. */
async function takeQuota(env: Env, now: number): Promise<boolean> {
  const cap = Number(env.AI_DAILY_CAP ?? 200);
  const day = new Date(now * 1000).toISOString().slice(0, 10);
  const row = await env.DB.prepare(
    "INSERT INTO ai_usage (day, count) VALUES (?1, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1 WHERE count < ?2 RETURNING count",
  )
    .bind(day, cap)
    .first<{ count: number }>();
  return !!row && row.count <= cap;
}

function base64(bytes: ArrayBuffer): string {
  const b = new Uint8Array(bytes);
  let s = "";
  for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode(...b.subarray(i, i + 0x8000));
  return btoa(s);
}

export async function checkStamp(
  env: Env,
  image: { bytes: ArrayBuffer; contentType: string },
  claim: { code: string; bountyId: number; target: string },
  now: number,
): Promise<StampResult> {
  if (env.AI_CHECK === "false" || !env.AI) return { status: "skipped", reason: "off" };
  if (!(await takeQuota(env, now))) return { status: "skipped", reason: "cap" };
  try {
    const out = (await env.AI.run((env.AI_MODEL || DEFAULT_MODEL) as never, {
      messages: [
        { role: "system", content: PROMPT },
        {
          role: "user",
          content: [
            { type: "text", text: "Read the Bounty Line stamp." },
            { type: "image_url", image_url: { url: `data:${image.contentType};base64,${base64(image.bytes)}` } },
          ],
        },
      ],
      max_tokens: 256,
      temperature: 0,
    } as never)) as { response?: unknown };
    const text = typeof out?.response === "string" ? out.response : JSON.stringify(out?.response ?? "");
    const read = parseStamp(text);
    if (!read) return { status: "unreadable" };
    const status = compareStamp(read, claim.code, claim.bountyId, claim.target);
    return status === "unreadable" ? { status, read } : { status, read };
  } catch (e) {
    log(env, "warn", "ai.stamp_failed", { error: String(e) });
    return { status: "skipped", reason: "error" };
  }
}
