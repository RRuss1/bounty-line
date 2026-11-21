/** Tenant (Discord server) settings in D1. Every query is keyed by tenant id. */
import { ALPHABET } from "./codec";

/** Runtime settings and their defaults (Compendium 01 Section 3.3). config_json stores overrides only. */
export const DEFAULT_CONFIG = {
  discord_display_name: "",
  reward_min: 1,
  reward_max: 10000,
  expiry_days: 14,
  proof_window_hours: 24,
  trust_threshold: 5,
  auto_approve: "trusted_only" as "off" | "trusted_only" | "all_clean",
  pet_kills_count: true,
  allow_stacking: true,
  weekly_recap: true,
  branding_color: "#B8860B",
  /** Forum tag IDs on #bounty-board, by status key. Filled in by /bl setup. */
  forum_tags: {} as Partial<Record<ForumTagKey, string>>,
  /** The pinned how-to message in #bounty-line. */
  howto_message_id: "",
  /** The pinned Bounty Pack message(s) in #bounty-line, one per part. */
  pack_message_ids: [] as string[],
};

/** Forum tags (spec Section 8.1), keyed by bounty status. */
export const FORUM_TAGS = {
  open: "Open",
  review: "Claimed – Review",
  awaiting_payment: "Awaiting Payment",
  paid: "Paid",
  expired: "Expired",
  cancelled: "Cancelled",
} as const;
export type ForumTagKey = keyof typeof FORUM_TAGS;
export type TenantConfig = typeof DEFAULT_CONFIG;

export interface TenantRow {
  id: string;
  board_tag: string;
  wow_guild_name: string | null;
  bounty_line_ch: string | null;
  bounty_board_forum: string | null;
  hall_of_fame_ch: string | null;
  officer_role_id: string | null;
  config_json: string;
  created_at: number;
}

export interface Tenant extends TenantRow {
  config: TenantConfig;
}

function withConfig(row: TenantRow): Tenant {
  let overrides: Partial<TenantConfig> = {};
  try {
    overrides = JSON.parse(row.config_json) as Partial<TenantConfig>;
  } catch {
    // A corrupt config falls back to defaults rather than locking the server out.
  }
  return { ...row, config: { ...DEFAULT_CONFIG, ...overrides } };
}

/** Random 4-char Crockford tag. "0000" means "no board" in codes, so it's never issued. */
export function newBoardTag(): string {
  for (;;) {
    const bytes = crypto.getRandomValues(new Uint8Array(4));
    const tag = Array.from(bytes, (b) => ALPHABET[b % 32]).join(""); // 256 % 32 == 0: unbiased
    if (tag !== "0000") return tag;
  }
}

export async function getTenant(db: D1Database, id: string): Promise<Tenant | null> {
  const row = await db.prepare("SELECT * FROM tenants WHERE id = ?1").bind(id).first<TenantRow>();
  return row ? withConfig(row) : null;
}

export interface SetupInput {
  id: string;
  wowGuildName: string;
  bountyLineChannel: string;
  bountyBoardForum: string;
  officerRoleId: string;
  displayName: string;
}

/**
 * Creates or updates a tenant. Idempotent: re-running keeps the board tag
 * (codes already in players' hands carry it) and only updates settings.
 */
export async function upsertTenant(db: D1Database, input: SetupInput, now: number): Promise<{ tenant: Tenant; created: boolean }> {
  const existed = (await getTenant(db, input.id)) !== null;
  const overrides = JSON.stringify({ discord_display_name: input.displayName });
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const row = await db
        .prepare(
          `INSERT INTO tenants (id, board_tag, wow_guild_name, bounty_line_ch, bounty_board_forum, officer_role_id, config_json, created_at)
           VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
           ON CONFLICT(id) DO UPDATE SET
             wow_guild_name = excluded.wow_guild_name,
             bounty_line_ch = excluded.bounty_line_ch,
             bounty_board_forum = excluded.bounty_board_forum,
             officer_role_id = excluded.officer_role_id,
             config_json = json_patch(tenants.config_json, excluded.config_json)
           RETURNING *`,
        )
        .bind(input.id, newBoardTag(), input.wowGuildName, input.bountyLineChannel, input.bountyBoardForum, input.officerRoleId, overrides, now)
        .first<TenantRow>();
      if (!row) throw new Error("upsert returned no row");
      return { tenant: withConfig(row), created: !existed };
    } catch (e) {
      // Another server already has this tag: draw a new one.
      if (String(e).includes("tenants.board_tag")) continue;
      throw e;
    }
  }
  throw new Error("could not allocate a unique board tag");
}

/** Merges settings into config_json (RFC 7396 merge, so nested maps merge too). */
export async function patchConfig(db: D1Database, id: string, patch: Partial<TenantConfig>): Promise<void> {
  await db.prepare("UPDATE tenants SET config_json = json_patch(config_json, ?2) WHERE id = ?1").bind(id, JSON.stringify(patch)).run();
}

export async function audit(db: D1Database, tenantId: string, actor: string, action: string, detail: unknown, now: number): Promise<void> {
  await db
    .prepare("INSERT INTO audit_log (tenant_id, at, actor, action, detail_json) VALUES (?1, ?2, ?3, ?4, ?5)")
    .bind(tenantId, now, actor, action, JSON.stringify(detail))
    .run();
}

export async function boardCounts(db: D1Database, tenantId: string): Promise<{ open: number; pendingReviews: number }> {
  const [open, pending] = await db.batch<{ n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM bounties WHERE tenant_id = ?1 AND status = 'open'").bind(tenantId),
    db.prepare("SELECT COUNT(*) AS n FROM kills WHERE tenant_id = ?1 AND verdict = 'pending'").bind(tenantId),
  ]);
  return { open: open?.results[0]?.n ?? 0, pendingReviews: pending?.results[0]?.n ?? 0 };
}
