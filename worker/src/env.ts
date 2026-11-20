/** Bindings, vars and secrets (Compendium 01 Section 3). */
export interface Env {
  DB: D1Database;
  PROOFS: R2Bucket;

  // vars (rendered from deployment values)
  ALLOWED_GUILD_IDS: string;
  READ_CHAT?: string;
  AI_CHECK?: string;
  AI_DAILY_CAP?: string;
  PROOF_RETENTION_DAYS?: string;
  LOG_LEVEL?: string;

  // secrets (wrangler secret put)
  DISCORD_TOKEN: string;
  DISCORD_PUBLIC_KEY: string;
  DISCORD_APP_ID: string;
}
