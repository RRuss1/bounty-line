# Changelog

## v0.2.0 (2026-11-20): Phase 2, bounty posting

- The bot reads `#bounty-line` through a Discord Gateway connection (a Durable Object, kept alive by a once-a-minute cron). Pasted bounty codes become wanted posters in `#bounty-board` with the **Open** tag; the bot reacts ✅ or ❌, and error replies delete themselves after a minute.
- Rules: board tag must match (or be blank), opposite faction, reward within the server's limits (1g to 10,000g by default), one code per bounty, one open bounty per target for now.
- `/bl submit code:` does the same from a slash command, for when pasting doesn't work (and for budget mode).
- `/bl setup` now also creates the forum tags and posts and pins a how-to in `#bounty-line`. It stays safe to re-run.
- The bot leaves any server that isn't on the allowlist as soon as it joins.
- `npm run test-code` prints valid bounty codes for testing before the addon exists.

### Deployer notes

- **Discord:** keep **Message Content Intent** on (Bot tab). Without it the gateway stops with close code 4014 and `/bl status` shows chat reading as `error`.
- **Forum permission:** give the bot **Manage Channels on the `#bounty-board` forum only** (forum settings → Permissions → add the bot's role), then run `/bl setup` again to create the tags and the pinned how-to.
- New config (automatic): a `GatewayDO` Durable Object and a `*/1 * * * *` cron. Budget mode (`READ_CHAT=false`) never starts the gateway.

## v0.1.0 (2026-11-20): Phase 1, Worker skeleton

- Bounty Board Worker: `GET /health` and the Discord `/interactions` endpoint, with Ed25519 signature checks. The server allowlist is checked first, so other servers never cause database, storage or AI work.
- Slash commands: `/bl ping`, `/bl version`, `/bl setup` (admins; issues a unique 4-character board tag, safe to re-run), `/bl status` (admins).
- D1 schema (`worker/migrations/0001_init.sql`); every table is keyed by Discord server.
- Deployment config is rendered from `worker/wrangler.template.jsonc`; no deployment values live in the repo.
- `Deploy Worker` workflow: migrations, deploy, slash command registration. It skips in forks that haven't configured Variables and Secrets.

### Deployer notes

- **GitHub Variables:** `WORKER_NAME`, `D1_NAME`, `D1_ID`, `R2_BUCKET`, `ALLOWED_GUILD_IDS`. **Secrets:** `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `DISCORD_TOKEN`, `DISCORD_APP_ID`.
- **API token permissions:** Workers Edit, Workers Scripts Edit, D1 Edit, Workers R2 Storage Edit, scoped to your account, with no zone policy.
- **Before the first deploy,** run `npx wrangler secret put` for `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID` and `DISCORD_TOKEN` (with `--name <WORKER_NAME>`). This creates the Worker; the API token can update Workers but not create them.
- **Order:** set the Interactions Endpoint URL, then invite the bot (scopes `bot` + `applications.commands`, permissions `2252126231317568`), then re-run the deploy so commands register in your server.

## v0.0.0 (2026-11-20): Phase 0, repo and codec

- BL1 code format ([Compendium 02](docs/compendium/02-Code-Format-Spec.md)): bounty (`B`), kill (`K`), link (`L`) and pack (`P`) codes, with compact GUIDs, zlib-compressed multi-part packs and CRC-16 checks.
- TypeScript reference codec (`worker/src/codec.ts`) and Lua port (`addon/BountyLine/Codec.lua`), both passing the frozen vectors in `shared/test-vectors.json`.
- CI: luacheck, Lua 5.1 + LuaJIT codec tests, Worker typecheck and tests.

### Deployer notes

- Nothing to deploy yet. The Worker arrives in Phase 1.
