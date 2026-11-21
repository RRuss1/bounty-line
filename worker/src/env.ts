/** Bindings, vars and secrets (Compendium 01 Section 3). */
export interface Env {
  DB: D1Database;
  PROOFS: R2Bucket;
  GATEWAY: DurableObjectNamespace;
  /** Workers AI (stamp reading). Absent in budget-mode deployments. */
  AI?: Ai;

  // vars (rendered from deployment values)
  ALLOWED_GUILD_IDS: string;
  READ_CHAT?: string;
  AI_CHECK?: string;
  AI_DAILY_CAP?: string;
  /** Workers AI vision model for the stamp check (default in src/ai.ts). */
  AI_MODEL?: string;
  PROOF_RETENTION_DAYS?: string;
  LOG_LEVEL?: string;
  POSTER_IMAGE?: string;

  // secrets (wrangler secret put)
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}
