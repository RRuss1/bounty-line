/** Discord interaction primitives: signature checks, allowlist, response helpers. */
import type { Env } from "./env";

export const InteractionType = { PING: 1, APPLICATION_COMMAND: 2, MESSAGE_COMPONENT: 3, MODAL_SUBMIT: 5 } as const;
export const ResponseType = { PONG: 1, CHANNEL_MESSAGE: 4, DEFERRED_UPDATE_MESSAGE: 6, MODAL: 9 } as const;

/** A field of a submitted form: in a Label (type 18), or in an action row (type 1) on older layouts. */
export interface ModalComponent {
  type: number;
  custom_id?: string;
  value?: string;
  values?: string[];
  component?: ModalComponent;
  components?: ModalComponent[];
}

/** A submitted form's answers by field: a text input's text, or a dropdown's first pick. */
export function modalValues(components: ModalComponent[] | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  const walk = (c: ModalComponent) => {
    if (c.custom_id && (c.value !== undefined || c.values !== undefined)) out[c.custom_id] = c.value ?? c.values?.[0] ?? "";
    if (c.component) walk(c.component);
    for (const child of c.components ?? []) walk(child);
  };
  for (const c of components ?? []) walk(c);
  return out;
}
export const EPHEMERAL = 64;

export const Permission = { ADMINISTRATOR: 1n << 3n, MANAGE_GUILD: 1n << 5n } as const;

export interface CommandOption {
  name: string;
  type: number;
  value?: string | number | boolean;
  options?: CommandOption[];
}

export interface Interaction {
  id: string;
  type: number;
  token: string;
  guild_id?: string;
  channel_id?: string;
  member?: { user?: { id: string; username?: string; global_name?: string | null }; nick?: string | null; permissions?: string; roles?: string[] };
  user?: { id: string; username?: string; global_name?: string | null };
  data?: {
    name: string;
    options?: CommandOption[];
    /** buttons */
    custom_id?: string;
    /** forms (MODAL_SUBMIT) */
    components?: ModalComponent[];
    resolved?: { attachments?: Record<string, { url: string; filename?: string; content_type?: string; size?: number }> };
  };
}

export interface InteractionResponse {
  type: number;
  data?: { content?: string; flags?: number; allowed_mentions?: { parse: string[] }; custom_id?: string; title?: string; components?: unknown[] };
}

/** Ephemeral reply that never pings anyone. */
export const reply = (content: string): InteractionResponse => ({
  type: ResponseType.CHANNEL_MESSAGE,
  data: { content, flags: EPHEMERAL, allowed_mentions: { parse: [] } },
});

export const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

/** Allowlist from ALLOWED_GUILD_IDS (comma/space separated). Fails closed: empty means nobody. */
export function isAllowedGuild(env: Pick<Env, "ALLOWED_GUILD_IDS">, guildId: string | undefined): boolean {
  if (!guildId) return false;
  return (env.ALLOWED_GUILD_IDS ?? "").split(/[\s,]+/).includes(guildId);
}

export function hasAdmin(interaction: Interaction): boolean {
  const raw = interaction.member?.permissions;
  if (!raw || !/^[0-9]+$/.test(raw)) return false;
  const perms = BigInt(raw);
  return (perms & Permission.ADMINISTRATOR) !== 0n || (perms & Permission.MANAGE_GUILD) !== 0n;
}

// ---------------------------------------------------------------- Ed25519 signature verification

const HEX = /^[0-9a-fA-F]*$/;

function hexToBytes(hex: string): Uint8Array | null {
  if (hex.length % 2 !== 0 || !HEX.test(hex)) return null;
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return out;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function importKey(publicKeyHex: string): Promise<CryptoKey> | null {
  const raw = hexToBytes(publicKeyHex);
  if (!raw || raw.length !== 32) return null;
  let key = keyCache.get(publicKeyHex);
  if (!key) {
    key = crypto.subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    keyCache.set(publicKeyHex, key);
  }
  return key;
}

/** Verifies Discord's X-Signature-Ed25519 over timestamp + raw body. Never throws. */
export async function verifySignature(
  publicKeyHex: string | undefined,
  signatureHex: string | null,
  timestamp: string | null,
  body: string,
): Promise<boolean> {
  if (!publicKeyHex || !signatureHex || !timestamp) return false;
  const sig = hexToBytes(signatureHex);
  const key = importKey(publicKeyHex);
  if (!sig || sig.length !== 64 || !key) return false;
  try {
    return await crypto.subtle.verify("Ed25519", await key, sig, new TextEncoder().encode(timestamp + body));
  } catch {
    return false;
  }
}
