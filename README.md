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
3. In game: `/bl import`, paste, done. It syncs to everyone else in your guild automatically.
4. Optional: `/bl link` and paste the code in `#bounty-line` so your kills are credited to your Discord name.

| Command | Does |
|---|---|
| `/bl` | Open the in-game board |
| `/bl mark` | Set a bounty on your target (same as right-click → Set Bounty…) |
| `/bl import` | Paste a Bounty Pack from Discord |
| `/bl last` | Re-open your last kill code |
| `/bl link` | Link your character to your Discord account |
| `/bl test` | Practice run: fake kill, stamp, screenshot, popup |
| `/bl options` | Settings |

Screenshots are saved to `World of Warcraft\_forever_\Screenshots` (newest file).

> **Why copy/paste?** WoW addons can't connect to the internet or write to your clipboard. Codes are the bridge, so you only install the addon.

---

## For guild admins: deploy your own Bounty Board

Every guild ties **its own Worker to its own Discord**. You host it on your Cloudflare account; your data stays yours.

### You'll need
- A **Cloudflare** account. The Free plan works in *budget mode*; **Workers Paid** is recommended for chat reading + AI proof checks.
- A **Discord server** where you're an admin, with Developer Mode on.
- A **GitHub** account.

### Steps (about 30 minutes)
1. **Fork** this repo.
2. **Create a Discord application** at discord.com/developers:
   - Bot → copy the token, turn **Public Bot OFF**, turn **Message Content Intent ON** (skip in budget mode).
   - Copy the **Application ID** and **Public Key**.
3. **Create a Cloudflare API token** ("Edit Cloudflare Workers" template; make sure **Workers: Edit**, **Workers Scripts: Edit**, **D1: Edit** and **Workers R2 Storage: Edit** are ticked; remove the zone policy; limit it to your account).
4. In **your fork** → Settings → Secrets and variables → Actions:

   | Type | Name | Value |
   |---|---|---|
   | Secret | `CLOUDFLARE_API_TOKEN` | your API token |
   | Secret | `CLOUDFLARE_ACCOUNT_ID` | your account ID |
   | Secret | `DISCORD_TOKEN` | bot token |
   | Secret | `DISCORD_PUBLIC_KEY` | public key |
   | Secret | `DISCORD_APP_ID` | application ID |
   | Variable | `WORKER_NAME` | e.g. `bounty-board-myguild` |
   | Variable | `D1_NAME` / `R2_BUCKET` | e.g. `bounty-board-myguild` / `bounty-proofs-myguild` |
   | Variable | `ALLOWED_GUILD_IDS` | your Discord server ID |
   | Variable (optional) | `READ_CHAT`, `AI_CHECK`, `POSTER_IMAGE`, `AI_DAILY_CAP` | `false`/`false`/`false` for budget mode |

5. Actions → **Bootstrap deployment** → *Run workflow*. It creates the database and bucket, deploys, and registers commands.
6. Discord portal → **Interactions Endpoint URL** = `https://<WORKER_NAME>.<your-subdomain>.workers.dev/interactions`
7. Invite your bot (OAuth2 URL with `bot` + `applications.commands`), then run **`/bl setup`** in your server.
8. Tell your guild to install Bounty Line and `/bl import` the pinned pack.

### Staying up to date
Click **Sync fork** on GitHub. Your deploy workflow applies database migrations and redeploys automatically. Check [CHANGELOG.md](CHANGELOG.md) → *Deployer notes* for anything that needs action.

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
