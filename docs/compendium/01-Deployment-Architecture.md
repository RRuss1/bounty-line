# Compendium 01: Deployment Architecture
### "One Discord ↔ One Worker": bring-your-own-backend, built to scale

Companion to `docs/Bounty-Line-Design-Spec.md`. This document is binding for how the Worker is configured, deployed, upgraded and shared.

---

## 1. The model

```
                    ┌──────────────────────────────┐
                    │  UPSTREAM REPO (public)      │
                    │  github.com/<rich>/bounty-line│
                    │  • addon source              │
                    │  • worker source             │
                    │  • NO deployment IDs/secrets │
                    └──────────────┬───────────────┘
              fork / "Use this template" / clone
        ┌──────────────────────────┼──────────────────────────┐
        ▼                          ▼                          ▼
 ┌──────────────┐          ┌──────────────┐           ┌──────────────┐
 │ Rich's deploy│          │ Guild B      │           │ Guild C      │
 │ CF acct: Rich│          │ CF acct: B   │           │ CF acct: C   │
 │ Worker+D1+R2 │          │ Worker+D1+R2 │           │ Worker+D1+R2 │
 │ Discord app A│          │ Discord app B│           │ Discord app C│
 │ Server: WoW  │          │ Server: B    │           │ Server: C    │
 │ Forever      │          │              │           │              │
 └──────────────┘          └──────────────┘           └──────────────┘

           ▲                        ▲                         ▲
           └──────── same Bounty Line addon from CurseForge ──┘
                     (backend-agnostic, talks to nobody)
```

**Rules**
1. **One deployment = one owner's Cloudflare account + one Discord application.** The owner pays for it.
2. A deployment serves **its allowlisted Discord server(s) only.** Default: exactly one.
3. **The upstream repo never contains anyone's deployment values**, Rich's included. Deployment values live in each deployer's GitHub Actions variables/secrets, or in a gitignored local file.
4. **The addon has no idea which backend exists.** It only creates and reads codes. That's what makes the system infinitely forkable: any number of independent Bounty Boards can exist with zero coordination.

---

## 2. Why this is scale-proof

| Concern | How the model handles it |
|---|---|
| Costs | Each guild pays for its own usage. Rich's bill only reflects Rich's server. |
| Discord privileged intents | Each private bot has a small user count, far under Discord's 10,000-user review threshold. |
| Blast radius | A bug or outage in one deployment affects one guild. |
| Data ownership & privacy | Each guild's bounties, screenshots and member links live in its own D1/R2. |
| Rate limits | Discord and Cloudflare limits are per-app/per-account, so they never pool across guilds. |
| Growth | 1,000 guilds = 1,000 tiny independent deployments. Nothing central to scale. |
| Alliances (optional) | The schema is tenant-keyed, so one deployment *can* allowlist several friendly servers if its owner chooses. |

---

## 3. Configuration model

Three layers, from most fixed to most flexible.

### 3.1 Build-time bindings (`wrangler.jsonc`, generated)
Resource IDs that differ per deployment: D1 database ID, R2 bucket name, Worker name, routes/custom domain.

- Upstream ships **`worker/wrangler.template.jsonc`** with `${PLACEHOLDERS}`.
- **`worker/scripts/render-config.ts`** produces `worker/wrangler.jsonc` (gitignored) from:
  - locally: `worker/.deploy.env` (gitignored), or
  - in CI: GitHub Actions **Variables** (`vars.*`).
- Every deploy command runs `render-config` first.

```jsonc
// wrangler.template.jsonc (committed)
{
  "name": "${WORKER_NAME}",                       // e.g. bounty-board-wowforever
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "${D1_NAME}", "database_id": "${D1_ID}", "migrations_dir": "migrations" }],
  "r2_buckets":   [{ "binding": "PROOFS", "bucket_name": "${R2_BUCKET}" }],
  "ai":           { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "GATEWAY", "class_name": "GatewayDO" }] },
  "migrations":   [{ "tag": "v1", "new_sqlite_classes": ["GatewayDO"] }],
  "triggers":     { "crons": ["*/1 * * * *", "0 * * * *", "0 17 * * SUN"] },
  "vars": {
    "ALLOWED_GUILD_IDS": "${ALLOWED_GUILD_IDS}",
    "READ_CHAT": "${READ_CHAT:-true}",
    "AI_CHECK": "${AI_CHECK:-true}",
    "AI_DAILY_CAP": "${AI_DAILY_CAP:-200}",
    "PROOF_RETENTION_DAYS": "${PROOF_RETENTION_DAYS:-180}",
    "LOG_LEVEL": "${LOG_LEVEL:-info}"
  }
}
```

### 3.2 Secrets (never in any file that's committed)
Set with `wrangler secret put` (and mirrored in GitHub Actions **Secrets** for CI command registration).

| Secret | Purpose |
|---|---|
| `DISCORD_TOKEN` | Bot token (gateway + REST) |
| `DISCORD_PUBLIC_KEY` | Verifies interaction signatures |
| `DISCORD_APP_ID` | Command registration (not truly secret, kept with the others for simplicity) |

### 3.3 Runtime settings (per Discord server, stored in D1)
Changed live by admins with `/bl config`. No redeploy needed.

| Setting | Default |
|---|---|
| `bounty_line_channel`, `bounty_board_forum`, `hall_of_fame_channel` | set by `/bl setup` |
| `officer_role_id` | set by `/bl setup` |
| `wow_guild_name`, `discord_display_name` | set by `/bl setup` |
| `board_tag` | random 4 chars, generated by `/bl setup` |
| `reward_min` / `reward_max` | 1 / 10000 |
| `expiry_days` | 14 |
| `proof_window_hours` | 24 |
| `trust_threshold` | 5 approved kills |
| `auto_approve` | `trusted_only` (`off` / `trusted_only` / `all_clean`) |
| `pet_kills_count` | true |
| `allow_stacking` | true |
| `weekly_recap` | true |
| `branding_color` | `#B8860B` |

### 3.4 Deployment-level feature flags (vars)
| Var | Effect |
|---|---|
| `READ_CHAT=false` | **Budget mode:** no Gateway Durable Object, no Message Content intent. Players use `/bl submit`. |
| `AI_CHECK=false` | No Workers AI calls. Officers review every claim. |
| `AI_DAILY_CAP` | Max AI checks per day across the deployment, then fall back to officer review. |

**Order of operations on every inbound event:** `allowlist check → signature/auth check → rate limit → work`. Nothing that costs money runs before the allowlist check.

---

## 4. GitHub setup per deployment

### 4.1 Upstream (Rich's public repo)
- Contains code, templates, docs, tests, CI.
- `.gitignore` includes: `worker/wrangler.jsonc`, `worker/.deploy.env`, `worker/.dev.vars`, `.wrangler/`, `node_modules/`.
- Workflows are **deployment-neutral**: they read `vars.*` / `secrets.*`; if those are missing (e.g. a fork that hasn't configured anything), the deploy job **skips** instead of failing.

### 4.2 Rich's own deployment
Same repo. Rich sets **Actions Variables** (`WORKER_NAME`, `D1_NAME`, `D1_ID`, `R2_BUCKET`, `ALLOWED_GUILD_IDS`, …) and **Secrets** (`CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_*`). Push to `main` → deploy. None of these values appear in the code.

### 4.3 Another guild's deployment
1. **Fork** the repo (or "Use this template").
2. In *their* fork: set the same Variables/Secrets with *their* values.
3. Run the **"Bootstrap deployment"** workflow (manual trigger). It creates D1 + R2 if missing, applies migrations, deploys, and registers slash commands.
4. Invite their bot, run `/bl setup`.

### 4.4 Staying up to date
- Forks click **"Sync fork"** (or merge upstream tags). Their deploy workflow runs, applies new migrations, redeploys.
- Upstream publishes **CHANGELOG.md** with a "Deployer notes" section for anything that needs action (new var, new permission, new intent).

---

## 5. Versioning & compatibility

### 5.1 Three version streams
| Stream | Format | Lives in |
|---|---|---|
| Addon | `vMAJOR.MINOR.PATCH` | TOC `## Version`, CurseForge |
| Worker | `vMAJOR.MINOR.PATCH` | `worker/package.json`, `/bl version` |
| Code format | `BL1` prefix + per-type **schema byte** | Every code (Compendium 02) |

Addon and Worker release together from one tag (`v1.2.0`) to keep things simple, but they are **independently compatible** within the same code-format generation.

### 5.2 Compatibility rules
- **Within `BL1`**, changes are **additive only**: new fields are appended to the end of a payload with a bumped schema byte. Readers must ignore trailing bytes they don't understand.
- A Worker **accepts all schema versions** it has ever shipped for a type.
- The Bounty Pack carries `min_addon_version`. An older addon shows *"Bounty Line is out of date. Update from CurseForge."* but still imports what it can.
- A breaking change requires `BL2`, and the Worker accepts `BL1` and `BL2` side by side for at least one major version.

### 5.3 Compatibility matrix (kept in README)
| Addon \ Worker | 1.x | 2.x |
|---|---|---|
| 1.x | ✅ | ✅ (BL1 accepted) |
| 2.x | ⚠ new features unavailable | ✅ |

---

## 6. Database migrations

- `worker/migrations/NNNN_description.sql`, applied with `wrangler d1 migrations apply --remote` in CI before deploy.
- **Never edit a shipped migration.** Fix forward with a new one.
- Minor versions: only `CREATE TABLE`, `ADD COLUMN` (with defaults), `CREATE INDEX`. No drops/renames.
- Major versions may drop/rename, with a data-preserving copy step and a Deployer note.
- Every table carries `tenant_id` (the Discord server ID), even in single-server deployments.
- **Backups:** D1 Time Travel gives point-in-time restore (7 days on Free, 30 on Paid). Document the restore command in the README.

---

## 7. Operations

| Need | How |
|---|---|
| Health | `GET /health` → `{ version, gateway: "connected" | "reconnecting" | "disabled", db: "ok" }` |
| Admin status | `/bl status` (admins only): version, gateway state, AI usage today, open bounties, pending reviews |
| Logs | `wrangler tail`; structured JSON logs with `tenant_id`, `event`, `outcome` |
| Gateway recovery | Cron heartbeat every minute pings `GatewayDO`; reconnects with resume if dropped |
| Spend safety | Allowlist-first, rate limits, `AI_DAILY_CAP`, Cloudflare billing notifications |
| Privacy | No phone-home. No deployment ever sends data to upstream or to Rich. `/bl forget-me` per user. |
| Retention | R2 lifecycle rule deletes proofs `PROOF_RETENTION_DAYS` after a bounty closes |

---

## 8. Branding per deployment

- Bot name, avatar and banner: set in each deployer's Discord app. Upstream ships default original art in `art/`.
- `branding_color` and `discord_display_name` come from D1 settings.
- Wanted-poster template: default in the Worker bundle; optional override image in the deployer's R2 at `branding/poster.png`.
- The addon stays neutral and shows the server name from the imported pack: *"Go check the **{discord_display_name}** Bounty Board!"*

---

## 9. Deployer checklist (goes in the README as "Deploy your own Bounty Board")

- [ ] Cloudflare account (Free works in budget mode; Workers Paid recommended for chat reading + AI)
- [ ] Discord application created, **Public Bot OFF**, Message Content intent ON (unless budget mode)
- [ ] Fork created; Actions Variables + Secrets set
- [ ] "Bootstrap deployment" workflow run successfully
- [ ] Interactions Endpoint URL set in Discord portal
- [ ] Bot invited; `/bl setup` completed; pack pinned
- [ ] Billing notifications on
- [ ] Guild told to install Bounty Line from CurseForge and `/bl import` the pack
