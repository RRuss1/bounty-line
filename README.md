# ☠ Bounty Line

**Guild PvP bounties for World of Warcraft: Forever.**
Put a price on an enemy's head in game, hunt them down, auto-screenshot the killing blow, and prove it on your guild's Discord **Bounty Board**.

> Bounty Line (the addon) feeds the Bounty Board (your Discord). Every guild runs its **own** Bounty Board on its **own** Cloudflare account. Nothing is shared, nothing phones home.

---

## How it works

1. **Mark a target.** Right-click an opposite-faction player's portrait → **Set Bounty…** → type the gold amount.
2. **Post it.** Bounty Line shows a code. Click **[⧉]**, press **Ctrl+C**, and paste it in your Discord's `#bounty-line` channel. A wanted poster appears on the **Bounty Board**.
3. **Hunt.** Guildies running Bounty Line get a banner (*"New bounty… go check the Discord Bounty Board!"*). Targets glow on nameplates and show **WANTED** in tooltips.
4. **Kill.** Land the killing blow. Bounty Line stamps the kill on screen, takes a screenshot, and gives you a kill code.
5. **Prove it.** Paste the kill code **with your screenshot** in `#bounty-line`. The bot checks it (and can read the stamp with AI), then officers approve if needed.
6. **Get paid.** The poster pays you in game (honor system). Both click **Paid / Received** and the bounty gets its **PAID** stamp.

### Rules
- **Opposite faction only.** No duels, ever.
- **Killing blow only** (your pet's counts).
- Rewards are real gold, paid player to player, **1g–10,000g** by default (each guild can change this).
- Any guild member can post a bounty.

---

## For players: install the addon

1. Install **Bounty Line** from **CurseForge** (filter: *WoW Forever*), or download the zip from [Releases](../../releases) and unzip it into
   `World of Warcraft\_forever_\Interface\AddOns\`
2. In your guild's Discord, copy the pinned **Bounty Pack** from `#bounty-line`.
3. In game: `/bl import`, paste, done. It's shared with everyone in your guild running Bounty Line, and guildies who log in later get it automatically. Wanted players show a skull and a WANTED tooltip.
4. Optional: `/bl link` and paste the code in `#bounty-line` so your kills are credited to your Discord name.

| Command | Does |
|---|---|
| *(minimap button)* | **Left-click:** Bounty Board. **Right-click:** a menu with every command below |
| `/bl` | Open the in-game Bounty Board |
| `/bl options` | Settings (alerts, sounds, skull, sync and more) |
| `/bl mark` | Set a bounty on your target (same as right-click → Set Bounty…) |
| `/bl import` | Paste a Bounty Pack from Discord |
| `/bl list` | Print the open bounties |
| `/bl last` | Re-open your last kill code |
| `/bl link` | Link your character to your Discord account |
| `/bl test` | Practice run: fake kill, stamp, screenshot, popup |
| `/bl sync` | Share your Bounty Pack with the guild right now |
| `/bl banners` | Turn guild banners on or off |
| `/bl minimap` | Show or hide the minimap button |

**Claiming a kill:** drop the kill screenshot into the Discord Bounty Line chat. The bot reads the kill code from the QR code on the proof stamp, so there is nothing to paste (pasting the code with the screenshot still works). Screenshots are saved to `World of Warcraft\_forever_\Screenshots` (newest file); the kill popup has that folder as a line you can copy into the upload window in Discord.

> **Why copy/paste?** WoW addons can't connect to the internet or write to your clipboard. Codes are the bridge, so you only install the addon.

---

## For guild admins: deploy your own Bounty Board

Every guild ties **its own Worker to its own Discord**. You host it on your Cloudflare account; your data stays yours.

### You'll need
- A **Cloudflare** account. The Free plan works in *budget mode*; **Workers Paid** is recommended for chat reading + AI proof checks.
- A **Discord server** where you're an admin, with Developer Mode on.
- A **GitHub** account.

### Steps (about 30–45 minutes)

**👉 Follow the step-by-step guide: [docs/deploy-your-own.md](docs/deploy-your-own.md).** It assumes no experience. The short version:

1. **Fork** this repo and enable Actions in your fork.
2. Collect seven values from Cloudflare and Discord (the guide shows exactly where) and add them to your fork → Settings → Secrets and variables → Actions:

   | Type | Name | Value |
   |---|---|---|
   | Secret | `CLOUDFLARE_API_TOKEN` | API token (Workers Scripts, D1, Workers R2 Storage: Edit; Workers AI: Read) |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | your account ID |
   | Secret | `DISCORD_TOKEN` | bot token |
   | Secret | `DISCORD_PUBLIC_KEY` | public key |
   | Secret | `DISCORD_APP_ID` | application ID |
   | Variable | `WORKER_NAME` | e.g. `bounty-board-myguild` |
   | Variable | `ALLOWED_GUILD_IDS` | your Discord server ID |
   | Variable (optional) | `READ_CHAT`, `AI_CHECK`, `POSTER_IMAGE` | `false` each for budget mode (Cloudflare Free plan) |

3. Actions → **Bootstrap deployment** → *Run workflow* with **Dry run** ticked. It checks every value and account and tells you how to fix anything wrong. Changes nothing.
4. Run it again with **Dry run** unticked. It creates the database and screenshot storage, deploys the bot, stores its secrets, sets Discord's Interactions Endpoint URL and checks the bot is up. Safe to re-run; it never deletes anything.
5. Follow the run summary's next steps: invite the bot, run **Deploy Worker** once, then **`/bl setup`** in your server.

### Staying up to date
Click **Sync fork** on GitHub. Your deploy workflow applies database migrations and redeploys automatically. Check [CHANGELOG.md](CHANGELOG.md) → *Deployer notes* for anything that needs action.

### Discord commands

| Command | Who | Does |
|---|---|---|
| `/bl submit` | Anyone | Paste a code (and attach the screenshot for kills) if chat pasting doesn't work |
| `/bl pack` | Anyone | Refresh the pinned Bounty Pack and link to it |
| `/bl leaderboard` | Anyone | Top hunters, most wanted, biggest payers |
| `/bl me` | Anyone | Your kills, trust level, open bounties and payments |
| `/bl cancel` | Poster or officer | Cancel an open bounty |
| `/bl forget-me` | Anyone | Delete your links and stats from this board |
| `/bl relay` | Officers | Get a setup code for the optional [relay program](docs/relay.md): packs reach the game and bounties reach Discord without pasting |
| `/bl config` | Admins | Rewards, expiry, auto-approve, stacking, weekly recap |
| `/bl setup`, `/bl status` | Admins | Connect channels and roles; deployment status |

Clean kill claims from **trusted** hunters (5 approved kills in a row) are approved automatically once the AI has read the screenshot's stamp; everything else goes to your officers.

### Less pasting
- **Kill claims:** hunters drop the kill screenshot into the Bounty Line channel. The bot reads the kill code from the QR code on the proof stamp; no code to paste.
- **Relay (optional):** an officer can run a small program while playing that delivers the Bounty Pack into the game and posts guildies' bounties to Discord. See [docs/relay.md](docs/relay.md).

### Budget mode
Set `READ_CHAT=false`, `AI_CHECK=false` and `POSTER_IMAGE=false`. Players submit with `/bl submit` instead of pasting in chat, officers approve every claim, and wanted posters are text-only (drawing the parchment picture needs more CPU time than the Free plan allows). No Durable Object, no AI, so it fits a free account.

### Costs & safety
- Your bot only works in servers listed in `ALLOWED_GUILD_IDS`. It leaves any other server, and the check runs before anything that costs money.
- Turn on Cloudflare billing notifications.
- Proof screenshots are deleted 180 days after a bounty closes (configurable).

---

## Compatibility

| Addon \ Bounty Board | 1.x |
|---|---|
| 1.x | ✅ |

Codes are versioned (`BL1-…`). Newer Bounty Boards keep accepting older codes, and outdated addons are told to update.

---

## Privacy

Each Bounty Board stores only: Discord user IDs, linked WoW character names/GUIDs, bounties, and screenshots submitted as proof. Data never leaves that guild's own Cloudflare account. Players can run `/bl forget-me` at any time.

---

## Developers

| Doc | What's in it |
|---|---|
| [docs/Bounty-Line-Design-Spec.md](docs/Bounty-Line-Design-Spec.md) | Full design |
| [docs/compendium/01-Deployment-Architecture.md](docs/compendium/01-Deployment-Architecture.md) | One Discord ↔ one Worker, config, upgrades |
| [docs/compendium/02-Code-Format-Spec.md](docs/compendium/02-Code-Format-Spec.md) | The BL1 code format (addon ↔ Worker contract) |
| [docs/compendium/03-Build-Phases.md](docs/compendium/03-Build-Phases.md) | Build phases and acceptance checks |

```
addon/BountyLine/   WoW: Forever addon (Lua, Interface 16001)
worker/             Cloudflare Worker (TypeScript): Discord bot, D1, R2, AI
shared/             Test vectors shared by the Lua and TS codecs
```

Contributions welcome. See [CONTRIBUTING.md](CONTRIBUTING.md). Never commit tokens; the repo is public.

---

## License & policy

MIT. Bounty Line is free, open source and ad-free, in line with Blizzard's UI Add-On Development Policy. World of Warcraft is a trademark of Blizzard Entertainment; this project is not affiliated with or endorsed by Blizzard.
