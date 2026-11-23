# Changelog

## Unreleased

- Bounty Board: `/bl setup` no longer makes a second forum tag when an admin renamed one, retyped its dash or gave it an emoji. It keeps the tags it saved, and otherwise matches names ignoring case, dashes, spaces and emoji.

## v0.9.2: Expand (bounty terms), last seen, open world only, Hardcore tag, fair-play rules

- **Expand: bounty terms.** The Set Bounty window has an **Expand ▾** button. Want up to 10 kills (each paid its share, or all by one hunter), pick 7, 14 or 28 days, add bonuses (zone, class, solo, lower level, within N hours, and an insult bonus for a `/lol` at the corpse within 10 seconds) and limits (only in a zone, only a class, solo only). Hunters see the terms in tooltips and on the board; the wanted poster lists them; each kill gets its own payment post with the bonuses it earned. A bounty with terms takes no added gold.
- Code format: bounty codes schema 2 (terms), kill codes schema 3 (the hunter's class and level, the victim's level, solo, the insult) and packs schema 3 (terms for hunters). Plain bounties and kills write the same codes as before, and older addons read the new packs.
- **Last seen on the wanted posters.** With a relay online, the wanted poster on Discord shows where the target was last spotted: *👁 Last seen: Wetlands, 12 minutes ago (by Slac Jaw)*. The relay officer's addon collects guildies' sightings and sends the newest at most every 5 minutes (never in combat) as one QR screenshot. The in-game board's tooltip names who saw them too.
- Fix: a bounty's **note** no longer disappears from its poster when the status changes.
- Code format: new `W` code (sightings, written only for the relay). No other code changed.
- **Totems, guardians and summons count.** A killing blow by your totem, guardian or other summon now gives a kill code, like your pet's, when you're not in a group. (In a group the game can't tell whose totem it was; see spec §23 item 28.)
- **Only kills after the bounty count.** A kill from before the bounty was made in game is refused.
- **One-hour cooldown per target** (as the spec always said): the same hunter can't claim the same player again within 60 minutes of their last kill on them. `/bl config claim_cooldown_minutes`.
- **Trust needs different posters.** The five approved kills that make a hunter trusted must each be on a different poster's bounty, so nobody farms trust off a friend's alt.
- **Pay your debts.** No new bounties (or gold added, or Open Seasons) while you owe on a bounty approved 3 or more days ago. `/bl config unpaid_block_days`.
- **At most 10 open bounties per poster.** `/bl config max_open_per_poster`.
- **`/bl extend id: days:`** gives an open bounty more days (poster, a contributor or an officer; at most 60 days from now). The poster and the Bounty Pack update.
- **Hunters ping.** Pick a role with `/bl config hunter_role`; it's pinged on the wanted poster of every new bounty of 50g or more (`hunter_ping_min_gold`).
- **Hardcore tag.** Bounties of 50g or more get a **Hardcore** forum tag next to their status, so the big ones stand out on the Bounty Board. It stays through Claimed, Awaiting Payment and Paid, and Add to Bounty adds it when the total crosses the line. Admins move the line with `/bl config hardcore_min_gold` (0 turns it off), which re-tags live bounties.
- **Bounties are open world only.** A killing blow in a battleground, arena, dungeon, raid or scenario never makes a kill code, for a bounty or an Open Season; if the victim was wanted, a chat line says the kill doesn't count there. Inside instances wanted players get no skull, target badge, tooltip line, alert or last-seen report. No bounty options inside instances either: no right-click section, `/bl mark`, Add to Bounty or Open Season there, because battlegrounds mix in players from other realms you can never meet in the open world.
- Bounty Board backstop: every kill claim now says where the kill happened ("Killed in Wetlands (open world)"). A kill whose map isn't a known open-world zone is flagged for the officers and is never auto-approved.

### Deployer notes

- Run `/bl setup` again once (same options): it creates the **Hardcore** forum tag and tags the live bounties of 50g or more. The bot needs Manage Channels on the forum for this, as before.
- Migrations `0008_trust_posters.sql`, `0009_last_seen.sql` and `0010_bounty_terms.sql` add columns; the deploy applies them. `/bl extend` is new and `/bl config` has five new options; the deploy registers them.
- Hunters ping: the role must allow being mentioned (Server Settings → Roles → the role → **Allow anyone to @mention this role**), or give the bot **Mention @everyone, @here and All Roles**.
- Relay officers: update the relay (`git pull`, then `npm.cmd ci` in `relay`) for last seen. An older relay keeps working for bounties and packs; the addon just doesn't send it sightings.
- The bot changes deploy when merged; players need the addon update for the in-game part.

## v0.9.1: Open Season window, prize pool minimum

- Open Season window: wider (long guild names fit), glows guild green, the kind and the length are two stacks of tick boxes, and the gold fields sit below them.
- **Prize pool minimum.** A prize pool now has a minimum number of kills for the whole season; if it isn't reached, nobody is paid and the funders keep their gold.

### Deployer notes

- Migration `0007_season_min_kills.sql` adds one column; the deploy applies it.

## v0.9.0: Open Season

- **Open Season in game.** Right-click an enemy → Set Bounty… now offers **This player** or **Their guild**. Pick the kind (per head + pot, prize pool, or per head with no ceiling), type the amounts, pick 7, 14 or 28 days. That guild's members get the skull, a tooltip line and one alert per season; a killing blow on one makes the usual kill screenshot. The addon remembers the guilds of enemies it sees. Open Seasons have their own scrollable table above the bounties on the in-game Bounty Board (and on My Bounties if you declared one), and `/bl seasons` prints them. Guildies see a new season at once through guild sync.
- Bounty Board: **Open Season**, a bounty on every member of an enemy guild. Three kinds (a price per head from a pot, a prize pool shared by kills, or a price per head with no ceiling), 7, 14 or 28 days, the same player counts once a day per hunter, and everyone is paid from one payout sheet when it closes. `/bl season` lists them or ends one early.
- Open Season fixes from an audit before release: kills on a season a guildie had only just declared were lost, and so were kills carrying an old season number (the kill code now names the victim's guild and the bot finds the season by it); the payout sheet could post twice and a kill could be credited twice when two people clicked at once; two approvals could overspend a pot; a claim or payout line without buttons could hold a season forever (officers now have `/bl season action: close`); with two seasons on one side, an unseen-guild claim gets one Approve per guild; no claims on your own faction; kills from before the season don't count; a half-failed double claim (bounty + season) now says so.
- Code format: new `S` code (a bounty on a whole enemy guild) and a second schema of the kill and pack codes that carries seasons. Ordinary bounty codes are unchanged, and older addons still read packs.
- The minimap menu has an **Open Seasons** entry (`/bl seasons`).
- CurseForge description rewritten to cover everything Bounty Line does now.

### Deployer notes

- Migration `0006_seasons.sql` adds the Open Season tables, and `/bl season` is a new subcommand; the deploy applies and registers both as usual.
- Older addons (v0.8.x) still import packs that carry seasons; they just don't see the seasons.

## v0.8.1: dungeon menu fix, class-coloured Set Bounty window, quieter relay

- Relay program: no more beep, and it no longer announces a "changed" pack every minute when nothing changed.
- `/bl debug guild`: prints the guilds of nearby players, to check what Forever lets the addon see (groundwork for Open Season).
- Fixed: right-clicking an enemy NPC inside a dungeon could break the menu's submenus. Bounty Line now stays out of unit menus in dungeons, raids and scenarios.
- Set Bounty window: the glow and the target's name take the target's class colour (red when the class isn't known). Other windows keep the red glow.
- `/bl pack` now posts and pins a fresh Bounty Pack at the bottom of `#bounty-line` and removes the old one, so it's easy to find. Automatic updates after each bounty still edit the pinned one quietly.
- Relay program: a "Last checked" line at the bottom of the window updates in place every minute, so you can see it's still running.

### Deployer notes

Nothing to do. The bot changes deployed when they were merged; relay users should download the relay again for the quiet version.

## v0.8.0: screenshot kill claims, relay, pending bounties, menus and sounds

- **Kill code no longer grabs your keyboard mid-fight.** If you are still in combat, **BOUNTY KILLED** flashes for 3 seconds, then a small shimmering Bounty Line square waits on screen. Click it after the fight to open your kill code (drag it to move it).
- Kills in quick succession each get their own stamp, screenshot and code (they queue).
- A bounty you or a guildie just killed shows as **claimed** and loses its skull until the next Bounty Pack, so nobody double-claims it.
- Bounty Packs dated in the future are refused, so one bad sync can no longer block real packs. Banners are limited to 3 a minute per sender. Optional: accept synced packs from officers only.
- **New bounties are huntable right away.** When a guildie makes a bounty code, everyone online gets it as a *pending* bounty: skull, tooltip and board entry, without waiting for someone to import the pack. A kill on a pending bounty still gives a kill code, and the Bounty Board matches it to the bounty by the victim.
- The board warns when your Bounty Pack is more than a day old.
- **Minimap menu.** Right-click the minimap button for a menu of everything (board, set bounty on target, import, share pack, last code, My Kills, My Bounties, link, practice kill, settings, help, debug), so nobody has to remember slash commands. Left-click opens the Bounty Board.
- **Settings window** (`/bl options`, the board's **Settings** button, or the menu): banners, sighting alerts and how soon they repeat, sounds, nameplate skull and its size, tooltip line, target-frame badge, kill popup in combat, how long the proof stamp stays, who you accept packs from, sharing sightings, minimap button, debug switches.
- **Bounty Board tabs:** *Wanted* (click a column to sort, hover for details, right-click a row to add gold without targeting them), *My Bounties*, and *My Kills* (your saved kill codes; click one to open it again).
- A **WANTED badge** above the target frame when your target has a bounty, and a first-login welcome that says where everything is.
- **Version check.** Bounty Line tells your guildies which version you have. If someone in the guild has a newer one, you get a chat line and a red note on the Bounty Board telling you to update. `/bl version` shows your version and lists guildies on older ones. (Versions before this one can't be told; they need the update first.)
- **Quieter `#bounty-line`.** A pasted code that works now gets only the ✅ reaction: no reply repeating the bounty. A code that fails gets ❌ and a one-line reason that deletes itself after a minute.
- Settings window is wider, so the longest option no longer runs past the edge.
- The minimap menu shows the slash command beside each entry, and gains Guild banners (on/off), Check version and Hide minimap button, so every command is in the menu.
- **Sounds per event** (all the game's own): a voice line when a bounty is created, coins when you add gold, an alarm when a wanted player is in sight, a PvP fanfare when you collect, a short PvP chime when a guildie collects, and a chime when your waiting kill code opens. `/bl debug sounds` plays each one.
- **Claim a kill with just the screenshot.** The proof stamp shows the kill code as a QR code (under the band, on the left). Drop the screenshot into `#bounty-line` and the bot reads the code from it: nothing to paste. Pasting the code with the screenshot still works. Ordinary pictures in the channel are ignored. The kill popup now says so, and has the Screenshots folder as a line you can copy into Discord's upload window.
- Fixed: the proof stamp could stay on screen until you pressed Print Screen. The automatic screenshot is now called safely, the code always appears within 5 seconds, and a chat line tells you if the game refused the screenshot.
- **Relay (optional, for officers).** A small program an officer runs while playing: it delivers Bounty Packs into the game (no more `/bl import`) and posts guildies' bounties to Discord (no more pasting). `/bl relay action: enable` gives the officer a private setup code. Setup: `docs/relay.md`. When a relay officer picks up your bounty, your popup says there is nothing to paste.
- Sighting alerts repeat after you lose sight of a target for 10 minutes, not just once per session.
- **View Bounty** in the right-click menu opens the board on that bounty. `/bl version`.
- Old sightings and expired bounties are cleaned out of saved data.

### Deployer notes

- Nothing to set. The Worker now accepts kill codes with bounty number 0 (matched by victim); it deploys as usual.
- Migration `0005_relay.sql` adds the `relay_tokens` table; the deploy applies it. `/bl relay` is a new subcommand, registered by the deploy as usual.

## v0.7.0 (unreleased): Phase 7, deploy your own

- **Bootstrap deployment** workflow for guilds running their own Bounty Board: a **dry run** checks every Secret and Variable, the Cloudflare token, the Discord app (token, app ID and public key from the same app; Public Bot; Message Content Intent) and the workers.dev subdomain, and explains how to fix each problem. The real run creates the database and screenshot storage if missing, deploys, stores the bot secrets, applies migrations, registers commands, sets Discord's Interactions Endpoint URL, waits for `/health` and lists the next steps with the invite link. It never deletes anything and is safe to re-run.
- **[docs/deploy-your-own.md](docs/deploy-your-own.md)**: a click-by-click guide for people new to this, with a troubleshooting table.
- Addon on **CurseForge** (beta builds upload automatically from tags).

### Deployer notes

- **Deploy Worker** now only needs `WORKER_NAME` and `ALLOWED_GUILD_IDS`: `D1_NAME` defaults to the Worker name, `R2_BUCKET` to `<WORKER_NAME>-proofs`, and `D1_ID` is looked up by name. Existing deployments with these set are unchanged.
- Add the `DISCORD_PUBLIC_KEY` **Secret** to GitHub if it isn't there yet; Bootstrap needs it.

## v0.6.0 (unreleased): Phase 6, automation

- **AI proof check.** Workers AI reads the proof stamp in the kill screenshot and compares it with the kill code (same code, or same bounty number and target). The result is listed on the proof post. Capped at `AI_DAILY_CAP` calls a day; over the cap, switched off or failing, claims simply go to officers.
- **Trust and auto-approve.** Five approved kills in a row make a hunter **trusted** (a denial resets it). With the default `auto_approve = trusted_only`, a trusted hunter's claim with all checks green (stamp matches, posted in time, character not linked to someone else) is approved automatically and goes straight to payment. Officers keep a **Deny** button until it's paid.
- `/bl leaderboard` (top hunters, most wanted, biggest payers), `/bl me` (your record, trust progress, open bounties, what you owe and are owed), `/bl cancel id` (poster or officer).
- **Add to Bounty.** Right-click a wanted player → **Add to Bounty…** to stack your gold on their open bounty. The poster shows the new total ("paid by Slac Jaw +1"), and on payment **each contributor pays their own share** (every one of them clicks **Paid**). Contributors can't claim it. Admins can turn stacking off.
- `/bl config` (admins): rewards, expiry, proof window, auto-approve mode, trust threshold, stacking, weekly recap and its channel. No redeploy needed.
- `/bl forget-me`: deletes your character links and stats; your name comes off closed bounties and your old kill screenshots are deleted. Open bounties and unpaid rewards stay.
- Proof screenshots are deleted from storage `PROOF_RETENTION_DAYS` (180) after their bounty closes.
- **Scheduled jobs.** Hourly: bounties past their expiry move to *Expired*. Sundays 17:00 UTC: a weekly recap in the hall-of-fame channel (or `#bounty-line`) with most wanted, the week's top hunters and a gentle list of unpaid bounties.

### Deployer notes

- New D1 migrations (`0003_ai_and_trust.sql`, `0004_stacking_and_cleanup.sql`); the deploy applies them. Existing bounties get their poster as the first contributor.
- New binding: **Workers AI** (`AI`). It needs Workers AI on your Cloudflare account (Workers Paid). Budget mode: set `AI_CHECK=false`. Optional Variable `AI_MODEL` to try another vision model.
- Two new crons (hourly, and Sundays 17:00 UTC) and five new slash commands; the deploy registers them.
- Your Cloudflare API token needs **Workers AI: Read** if the deploy complains about the AI binding.

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
