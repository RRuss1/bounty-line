# Changelog

## v0.5.0 (unreleased): Phase 5, guild sync and the board

- **Guild sync.** Import the Bounty Pack once and everyone in your guild running Bounty Line gets it. Guildies who log in later ask for it ("HELLO") and anyone with a newer pack answers; the newest pack wins. `/bl sync` shares yours right away.
- **Banners.** When a guildie makes a bounty code, everyone online sees "*X put a bounty on Y for 500g*". New bounties arriving by sync and kills ("*X collected the bounty on Y!*") get a banner too. `/bl banners` turns them off.
- **Last seen.** Spotting a wanted player tells the guild where and when; the board shows the latest sighting from anyone.
- **The in-game Bounty Board.** `/bl` (or click the minimap button) lists open bounties: target (class-coloured), reward, poster, last seen and expiry, biggest reward first. Shift-click the minimap button for your last code.
- Addon messages are paced and retried when the game blocks them (e.g. during dungeon or raid encounters).

### Deployer notes

- Nothing to change: Phase 5 is addon-only.

## v0.4.0 (2026-11-21): Phase 4, packs and the kill

- **Bounty Pack.** The bot keeps a pinned **Bounty Pack** in `#bounty-line` with every open bounty, and updates it whenever one opens or closes (big packs split into parts). `/bl pack` refreshes it and links to it.
- **See bounties in game.** `/bl import` takes the pinned pack (paste the whole message, or every part). Wanted players get a skull over their nameplate, a **WANTED** line in their tooltip, a "spotted nearby" alert the first time you see them, and **View Bounty** in the right-click menu. `/bl list` prints the open bounties.
- **The kill.** Land the killing blow (or your pet does) on a bounty target: a proof stamp flashes up, Bounty Line takes a screenshot and gives you a kill code. Duels and same-faction kills never count. `/bl test` runs a practice kill.
- **Claims in Discord.** Paste the kill code **with the screenshot** (or `/bl submit` with the image). The bot checks it, keeps the screenshot, posts the proof in the bounty's thread with **Approve / Deny** for officers, and tags the bounty *Claimed – Review*. Approve → *Awaiting Payment*; Deny → open again. The poster's stamp changes to match.
- **Getting paid.** When a kill is approved, the thread gets **Paid** (poster) and **Received** (hunter) buttons. Both clicked → the bounty is **PAID**: tag, PAID stamp on the poster, gold added to the hunter's total, thread closed. Officers can **Force close**.
- **Tidier pastes.** The addon now copies a short line with the code hidden in a Discord spoiler, e.g. `WANTED: **Grimlok Ashveil** · 500g ||BL1-B-…||`. `/bl submit` accepts the whole line too.
- **Character links.** `/bl link` codes now link your character to your Discord account; kill claims show whether the character is linked.
- Forever's Skyborne races (High Order and Windshaper) show by name on posters.
- Windows: classic metal border, a pulsing red glow, textured backgrounds, a minimap button (drag it around; `/bl minimap` hides it) and the Bounty Line logo as the addon icon.
- The copy box hides the code behind a tidy label; Ctrl+C still copies it.
- On CurseForge: https://www.curseforge.com/wow/addons (project 1820212).

### Deployer notes

- New D1 migration (`0002_kill_review.sql`); the deploy workflow applies it.
- Re-run `/bl setup` once so the pinned Bounty Pack and the new how-to are posted.
- Slash commands changed (`/bl pack`, an image option on `/bl submit`); the deploy re-registers them.

## v0.3.0 (2026-11-21): Phase 3, addon core

- **Set a bounty from the game.** Right-click an opposite-faction player's portrait → **Set Bounty…**, type the gold (`500`, `500g`, `1.5k`) and an optional note. Or target them and use `/bl mark [gold] [note]`.
- The code popup opens with the code already selected: press **Ctrl+C**, then paste it in `#bounty-line`. The copy button re-selects it, and the box can't be edited by accident.
- `/bl last` shows your last code again. `/bl link` makes a code that links your character to your Discord account (the Bounty Board reads it in a later update).
- `/bl debug` and `/bl debugmenu` print what the game tells the addon, for bug reports and for checking Forever's API.
- Same-faction players, NPCs and yourself never get the menu item. Mid-combat, if the game hides the target's details, the item shows disabled: "Set bounties out of combat."
- Bounty Board: targets too far above you to see their level show as "Level ??".

### Deployer notes

- Nothing to change. The Worker update (the "Level ??" display) deploys as usual.

## v0.2.0 (2026-11-20): Phase 2, bounty posting

- The bot reads `#bounty-line` through a Discord Gateway connection (a Durable Object, kept alive by a once-a-minute cron). Pasted bounty codes become wanted posters in `#bounty-board` with the **Open** tag; the bot reacts ✅ or ❌, and error replies delete themselves after a minute.
- Rules: board tag must match (or be blank), opposite faction, reward within the server's limits (1g to 10,000g by default), one code per bounty, one open bounty per target for now.
- `/bl submit code:` does the same from a slash command, for when pasting doesn't work (and for budget mode).
- `/bl setup` now also creates the forum tags and posts and pins a how-to in `#bounty-line`. It stays safe to re-run.
- The bot leaves any server that isn't on the allowlist as soon as it joins.
- `npm run test-code` prints valid bounty codes for testing before the addon exists.
- Wanted posters are drawn as a parchment picture (WANTED, name, reward, bounty #, expiry, status stamp) and attached to the forum post, so the card on `#bounty-board` shows the poster. `npm run poster-preview` renders a sample.

### Deployer notes

- **Discord:** keep **Message Content Intent** on (Bot tab). Without it the gateway stops with close code 4014 and `/bl status` shows chat reading as `error`.
- **Forum permission:** give the bot **Manage Channels on the `#bounty-board` forum only** (forum settings → Permissions → add the bot's role), then run `/bl setup` again to create the tags and the pinned how-to.
- New config (automatic): a `GatewayDO` Durable Object and a `*/1 * * * *` cron. Budget mode (`READ_CHAT=false`) never starts the gateway.
- **Forum layout:** set `#bounty-board` to **Gallery view** (forum settings → Default Layout) so the poster pictures show as big cards.
- **Free plan:** set the Actions Variable `POSTER_IMAGE=false`. Drawing a poster takes about 150 ms of CPU, more than the Free plan allows; posters then stay text-only.

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
