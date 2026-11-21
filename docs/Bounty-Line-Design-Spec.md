# Bounty Line & the Bounty Board
### Design Spec, Build Plan & Distribution Guide

**Project:** Bounty Line (WoW: Forever addon) → feeds → the Bounty Board (Discord)
**Owner:** Rich Russell
**Status:** Design complete, ready to build (v0.1)
**Last updated:** 2026-11-20

---

## Table of Contents

1. [Overview](#1-overview)
2. [Locked Decisions](#2-locked-decisions)
3. [How It Works: The Full Loop](#3-how-it-works-the-full-loop)
4. [Platform Facts & Constraints (WoW: Forever)](#4-platform-facts--constraints-wow-forever)
5. [Component 1: Bounty Line (the Addon)](#5-component-1-bounty-line-the-addon)
6. [Component 2: The Codes](#6-component-2-the-codes)
7. [Component 3: The Bounty Board Backend (Cloudflare)](#7-component-3-the-bounty-board-backend-cloudflare)
8. [Component 4: Discord Server Layout & Bot Behavior](#8-component-4-discord-server-layout--bot-behavior)
9. [Screenshot Proof & Automated Verification](#9-screenshot-proof--automated-verification)
10. [Rules Engine](#10-rules-engine)
11. [Graphics, Sound & Branding](#11-graphics-sound--branding)
12. [Data Model](#12-data-model)
13. [Security, Anti-Cheat & Honest Limits](#13-security-anti-cheat--honest-limits)
14. [Making It Generic: Multi-Guild Support](#14-making-it-generic-multi-guild-support)
15. [Repository Layout](#15-repository-layout)
16. [Guide: Setting Up the Public GitHub Repo](#16-guide-setting-up-the-public-github-repo)
17. [Guide: Discord App Setup](#17-guide-discord-app-setup)
18. [Guide: Cloudflare Setup](#18-guide-cloudflare-setup)
19. [Guide: CurseForge Submission & Release Pipeline](#19-guide-curseforge-submission--release-pipeline)
20. [Rolling It Out to the Guild](#20-rolling-it-out-to-the-guild)
21. [QA & Test Plan](#21-qa--test-plan)
22. [Roadmap](#22-roadmap)
23. [Open Items & Things to Verify on Day One](#23-open-items--things-to-verify-on-day-one)
24. [Appendix: Sources](#24-appendix-sources)

---

## 1. Overview

**Bounty Line** is a World of Warcraft: Forever addon that lets guild members put bounties on enemy players, highlights those targets in the world, detects when a guild member lands the killing blow, auto-screenshots the kill with a proof stamp, and hands the player a short **code** to paste into Discord.

**The Bounty Board** is the Discord side: a bot (hosted on Cloudflare) that reads those codes from a `#bounty-line` chat channel, creates wanted posters in a `#bounty-board` forum channel, verifies kill proof (including AI reading of the screenshot), tracks honor-system gold payouts, and runs leaderboards.

**Design principle: "Tier 1" only.** Players install **one thing**, the addon from CurseForge. No desktop companion app. All data moves between the game and Discord by **copy/paste of codes** plus **drag-and-drop of one screenshot**.

**Social principle: intra-guild.** Bounties are posted, hunted, and paid within one guild. Guildies running Bounty Line see in-game banners like:

> 🟥 **New bounty:** Grimlok Ashveil — 500g. Go check the Discord Bounty Board!

---

## 2. Locked Decisions

| Decision | Choice |
|---|---|
| Addon name | **Bounty Line** |
| Discord feature name | **Bounty Board** |
| Bounty type | PvP player bounties |
| Kill credit | **Killing blow only** |
| Reward | **Real in-game gold, honor system** (poster pays hunter player-to-player) |
| Who can post bounties | **Any guild member** |
| Valid targets | **Opposite faction only.** No same-faction targets, **no duel kills** |
| Other guilds | **Self-host on their own Cloudflare account.** Rich's bot is private and allowlisted to his server only, so other guilds never touch his Worker costs |
| Distribution | CurseForge (addon), public GitHub repo (all code) |
| Install tiers | **Tier 1 only** (addon only, copy/paste codes) |
| Hosting | Rich's **paid** Cloudflare account (Workers, D1, R2, Durable Objects, Workers AI, Cron) |
| Proof | Auto-screenshot with on-screen proof stamp + AI verification + officer fallback |
| Future | Generic, multi-guild version (Section 14) |

---

## 3. How It Works: The Full Loop

```
 IN GAME (Bounty Line)                         DISCORD (Bounty Board)
 ─────────────────────                         ──────────────────────
 1. Target enemy → /bl mark 500g
    Popup: "Post this in the Discord
    Bounty Line chat: BL1-B-...."  ─── paste ──▶ #bounty-line
                                                 Bot validates code →
                                                 creates wanted poster
                                                 thread in #bounty-board
 2. Guildies see banner:                         Bot posts updated
    "New bounty... check the Board"              "Bounty Pack" code
                                                 (pinned in #bounty-line)
 3. An officer/any member pastes the  ◀── copy ──
    pack: /bl import <pack>
    Addon shares pack to all guildies
    running Bounty Line (guild addon channel)

 4. Hunters see the target glow (nameplate,
    tooltip, sound, banner)

 5. Killing blow on target →
    Proof stamp flashes on screen →
    Auto-screenshot →
    Popup: "Post this in the Discord Bounty
    Line chat, with your screenshot:
    BL1-K-...."                   ─── paste + ─▶ #bounty-line
    Guild banner: "Rich collected      drag      Bot: decode, match GUID,
    the bounty on Grimlok!"           screenshot  AI-read stamp, time window
                                                 → auto-approve or flag
                                                 → proof posted in thread
                                                 → poster pays gold in game
                                                 → "Paid" + "Received" buttons
                                                 → PAID stamp, leaderboard
```

---

## 4. Platform Facts & Constraints (WoW: Forever)

These facts shape every design choice. **Forever is NOT a Classic client.**

| Fact | Impact on Bounty Line |
|---|---|
| Forever runs on the modern (Midnight) client with Midnight's addon restrictions. Interface number **16001**, patch 1.60.1. | Build against the modern API. Classic-era code patterns won't work. |
| `.toc` suffix: `_Forever.toc` (Blizzard accepts "Forever" as an alias for "Camelot"); project constant `WOW_PROJECT_CAMELOT`. | Ship `BountyLine_Forever.toc` with `## Interface: 16001`. |
| AddOns folder: `World of Warcraft\_forever_\Interface\AddOns`. Screenshots: `World of Warcraft\_forever_\Screenshots`. | Tell players exactly where screenshots land. |
| **Combat log is closed to addons.** Registering `COMBAT_LOG_EVENT_UNFILTERED` is forbidden. | Kill detection must use other events (below). No combat-log "proof line." |
| Kill signals available: **`PARTY_KILL`** (your killing blow, with victim GUID), **`CHAT_MSG_COMBAT_HONOR_GAIN`** (names the victim), `PLAYER_PVP_KILLS_CHANGED` (HK credit with no victim, i.e. assists). | `PARTY_KILL` + GUID match = killing blow. Honor message as corroboration. Assists ignored (killing blow only). |
| **No realms.** Characters have a first name + surname; addons key players by **GUID**. | Every bounty is locked to a GUID → no name collisions or typos. |
| Enemy detection via **nameplates, target, focus, mouseover** (how Spy works on Forever). | Highlight logic hooks those units. |
| **Secret values**: some unit data is hidden from addons during combat. | Cache target GUIDs when seen out of combat; degrade gracefully (see Section 23). |
| **Addons cannot make network requests.** Only SavedVariables + Screenshots touch disk. | That's why codes are copy/paste. |
| Addon comms (`C_ChatInfo.SendAddonMessage`) work on the **GUILD** channel; restricted only during active instance encounters. | Guild-wide pack sync and banners work great in open-world PvP. |
| **Macros can no longer send chat to non-group channels** (guild, communities). | Don't depend on auto guild-chat. Banners go through the addon channel. Optional "Announce to Guild" button is click-driven and verified on day one. |

---

## 5. Component 1: Bounty Line (the Addon)

### 5.1 Files

```
addon/BountyLine/
├── BountyLine_Forever.toc
├── BountyLine.toc                 # fallback (same contents) for retail testing
├── Core.lua                       # init, SavedVariables, event bus, slash commands
├── Codec.lua                      # code encode/decode, base32, checksum
├── Bounties.lua                   # bounty store, pack import, lookups by GUID
├── Detect.lua                     # nameplate/target/mouseover/tooltip highlighting
├── Kills.lua                      # PARTY_KILL handling, proof stamp, screenshot
├── Comms.lua                      # guild addon-channel sync (AceComm/ChatThrottleLib)
├── UI/
│   ├── Popup.lua                  # "Post this in the Discord Bounty Line chat" box
│   ├── Banner.lua                 # guild banners, WANTED alert, proof stamp
│   ├── BoardWindow.lua            # in-game list of open bounties
│   └── Options.lua                # Settings panel
├── Locales/enUS.lua               # all strings (ready for translation)
├── Media/                         # custom textures (.tga/.blp), Bounty Line logo
├── UI/Minimap.lua                 # minimap button (self-contained, no LibDBIcon) + addon compartment entry
└── Libs/                          # LibStub, LibDeflate (+ AceComm in Phase 5)
```

### 5.2 TOC

```toc
## Interface: 16001
## Title: Bounty Line
## Notes: Guild PvP bounties: mark targets, hunt them, prove the kill on your Discord Bounty Board.
## Author: Slac Jaw from RP-PVP
## Version: @project-version@
## SavedVariables: BountyLineDB
## SavedVariablesPerCharacter: BountyLineCharDB
## X-Curse-Project-ID: <filled in after CurseForge project is created>
## IconTexture: Interface\AddOns\BountyLine\Media\icon

Libs\LibStub\LibStub.lua
...
Core.lua
Codec.lua
...
```

### 5.3 Slash commands

| Command | What it does |
|---|---|
| `/bl` | Opens the in-game Bounty Board window |
| `/bl mark [gold] [note]` | With an enemy player targeted: opens the amount entry box (or skips it if you typed an amount), then shows the copy popup with the **bounty post code** (`BL1-B-…`) |
| `/bl import` | Opens a paste box for the **Bounty Pack** from Discord; then shares it to guildies |
| `/bl list` | Prints open bounties to chat |
| `/bl show <id>` | Details for one bounty (target, reward, last seen) |
| `/bl last` | Re-opens the last kill code popup (in case you closed it) |
| `/bl announce` | Sends a real guild-chat line about the latest bounty or kill (click/hardware-driven; see Section 23) |
| `/bl test` | Simulates a kill on a fake target: stamp, screenshot, popup. For setup testing |
| `/bl options` | Settings panel |

### 5.4 Marking a bounty (`/bl mark`)

1. Validate the target: `UnitIsPlayer("target")` and **opposite faction**: `UnitFactionGroup("target") ~= UnitFactionGroup("player")` (both must be "Alliance"/"Horde"). Same-faction players are rejected with "Bounties must be on the opposite faction." This also covers guildmates. The target's faction is stored in the code, and the server re-checks it against the poster's faction.
2. Capture: GUID, full name (first + surname), class, race, level, faction, current zone (map ID + name), timestamp.
3. Get the reward from the amount entry box (5.4b), or from the typed shortcut (`500g`, `500`, `1k`), and enforce the min/max limits.
4. Build the **B code** (Section 6) and show the popup:

```
┌──────────────────────────────────────────────────┐
│  [skull]  BOUNTY READY                            │
│  Grimlok Ashveil  ·  Orc Warrior 42  ·  500g      │
│                                                   │
│  Post this in the Discord Bounty Line chat:       │
│  ┌──────────────────────────────────────────────┐ │
│  │ BL1-B-7Q4KM2PX9TR3W8YH6N1ZC5V0FJ...-X9   [⧉] │ │  ← EditBox + copy icon
│  └──────────────────────────────────────────────┘ │
│  ✔ Selected! Press Ctrl+C       ·  [Close]        │
└──────────────────────────────────────────────────┘
```

The EditBox is auto-focused with text highlighted so **Ctrl+C** works immediately. The **[⧉] copy button** behaves exactly like the kill popup's (see 5.7b).

### 5.4b Right-click menu: "Set Bounty"

Primary way to post a bounty. Right-click an enemy player's **target frame, focus frame, or party/raid frame** to get a **Bounty Line** section in the standard unit menu.

**Menu (enemy, opposite-faction player):**
```
──────────── Bounty Line ────────────
☠ Set Bounty...                      → opens the amount entry box
👁 View Bounty (#12 · 500g)          (only if one exists)
➕ Add to Bounty...                  → same entry box, stacks gold on the existing bounty
```

**Amount is always entered by hand. No preset amounts.** Clicking **Set Bounty...** opens:

```
┌──────────────────────────────────────────┐
│  [skull]  SET BOUNTY                      │
│  Grimlok Ashveil · Orc Warrior 42 · Horde │
│                                           │
│  Reward (gold):  [ ______ ] g             │  ← EditBox, auto-focused, numbers only
│  Note (optional): [ ____________________ ]│
│                                           │
│  Min 1g · Max 10,000g                     │
│        [ Set Bounty ]   [ Cancel ]        │
└──────────────────────────────────────────┘
```

**Rules:**
- Shown only when the unit is a **player** of the **opposite faction**. For same-faction players, NPCs and yourself, the section is hidden.
- The reward box accepts whole gold only. It also accepts `1k`/`2.5k` shorthand and ignores a trailing `g`. Enter submits, Escape cancels.
- **Set Bounty** stays disabled until the amount is within the min/max limits (configurable in options and per guild on the Discord side).
- The target is snapshotted (GUID, name, class, faction) **when the box opens**. Changing targets while typing doesn't change who the bounty is on.
- Submitting opens the normal **"Post this in the Discord Bounty Line chat"** code popup (5.4).
- `/bl mark` with no amount opens this same box; `/bl mark 500` still works as a shortcut for slash-command users.

**Implementation (modern Menu API, 11.0+/Midnight-era client):**
```lua
local function AddBountyLineMenu(owner, rootDescription, contextData)
  local unit = contextData and contextData.unit
  if not unit or not UnitIsPlayer(unit) then return end
  if UnitFactionGroup(unit) == UnitFactionGroup("player") then return end

  local snapshot = BountyLine:SnapshotUnit(unit)   -- GUID, name, class, race, level, faction, zone
  rootDescription:CreateDivider()
  rootDescription:CreateTitle("Bounty Line")
  rootDescription:CreateButton("|TInterface\\TargetingFrame\\UI-RaidTargetingIcon_8:14|t Set Bounty...",
    function() BountyLine:OpenAmountEntry(snapshot, "new") end)

  local existing = BountyLine:GetBountyByGUID(snapshot.guid)
  if existing then
    rootDescription:CreateButton(("View Bounty (#%d · %sg)"):format(existing.id, BreakUpLargeNumbers(existing.reward)),
      function() BountyLine:ShowBounty(existing.id) end)
    rootDescription:CreateButton("Add to Bounty...",
      function() BountyLine:OpenAmountEntry(snapshot, "stack", existing.id) end)
  end
end

for _, tag in ipairs({ "MENU_UNIT_ENEMY_PLAYER", "MENU_UNIT_TARGET", "MENU_UNIT_FOCUS", "MENU_UNIT_PLAYER" }) do
  Menu.ModifyMenu(tag, AddBountyLineMenu)
end
```

**Verify on day one:** the exact menu tags the Forever client uses for enemy players (use `/bl debugmenu` to print each opened menu's tag), and that `UnitGUID`/`UnitFactionGroup` aren't secret values when the menu opens mid-combat. If they are, the item is disabled in combat with the tooltip "Set bounties out of combat."

**Not supported:** right-clicking a name in **chat**. Chat menus carry a name but no unit, so the addon can't read the GUID or faction. Players must target the enemy instead.

### 5.5 The Bounty Pack (`/bl import`)

- The bot keeps a pinned message in `#bounty-line` with the current **Bounty Pack** code (`BL1-P-…`): all open bounties (id, GUID, name, class, reward, poster, expiry) + board tag + pack version + Discord server name for banners.
- Any guild member pastes it once with `/bl import`. The addon:
  1. Decodes and validates it (checksum, version, board tag).
  2. Stores it in `BountyLineDB` (account-wide).
  3. **Broadcasts it to the guild** over the addon channel. Every guildie running Bounty Line receives it automatically. **Newest pack version wins.**
- Guildies who log in later request the latest pack with a `HELLO <packVersion>` message; anyone online with a newer pack replies.

### 5.6 Hunting: highlighting targets

Events: `NAME_PLATE_UNIT_ADDED`, `NAME_PLATE_UNIT_REMOVED`, `PLAYER_TARGET_CHANGED`, `PLAYER_FOCUS_CHANGED`, `UPDATE_MOUSEOVER_UNIT`, plus a tooltip post-call hook (`TooltipDataProcessor`).

When a unit's GUID matches an open bounty:
- **Nameplate:** skull marker + red glow texture anchored to the nameplate.
- **Tooltip:** `WANTED — 500g (Bounty #12, posted by Rich)` in red/gold.
- **Alert (first sighting per session/zone):** raid-warning style banner + sound:
  > ☠ **WANTED: Grimlok Ashveil — 500g** spotted nearby!
- **Last-seen update:** stores zone + time locally. It's shared to guildies via the addon channel (throttled) so the in-game board shows "Last seen: Stranglethorn, 3m ago."

### 5.7 The kill

1. `PARTY_KILL` fires → `attackerGUID == UnitGUID("player")` (or your pet's GUID) and `targetGUID` matches an open bounty → **killing blow confirmed**.
   - **Duel guard:** the addon tracks duel state (`DUEL_REQUESTED` / `DUEL_INBOUNDS` / `DUEL_FINISHED`) and ignores everything while a duel is active or for 10s after it ends. Duels end at 1 HP and shouldn't produce a `PARTY_KILL` anyway, so this is belt-and-suspenders.
   - **Faction guard:** the bounty's stored faction must be opposite yours. A same-faction "kill" (arena, odd edge cases) never produces a code.
2. Corroborate with `CHAT_MSG_COMBAT_HONOR_GAIN` naming the victim within ~2 seconds (logged as `honor=1/0`; not required, since some kills award no honor).
3. **Proof stamp** (Section 9) is drawn full-width at screen center.
4. Next frame: `Screenshot()`. Listen for `SCREENSHOT_SUCCEEDED` / `SCREENSHOT_FAILED`.
5. Hide the stamp, then show the **kill popup**:

```
┌──────────────────────────────────────────────────┐
│  [coin]  BOUNTY COLLECTED!                        │
│  Grimlok Ashveil  ·  500g  ·  Bounty #12          │
│                                                   │
│  Post this in the Discord Bounty Line chat,       │
│  WITH your screenshot:                            │
│  ┌──────────────────────────────────────────────┐ │
│  │ BL1-K-M2PL8QX4...-4R                     [⧉] │ │  ← copy icon button
│  └──────────────────────────────────────────────┘ │
│  ✔ Selected! Press Ctrl+C                         │
│  Screenshot saved to:                             │
│  World of Warcraft\_forever_\Screenshots (newest) │
│  [Announce to Guild]  [Close]                     │
└──────────────────────────────────────────────────┘
```

#### 5.7b The copy button [⧉]

**Platform limit:** WoW addons **cannot write to the system clipboard**. No addon API does it, so every addon that "copies" text actually selects it and has the player press Ctrl+C. The copy button gets as close to one click as WoW allows:

- **Icon:** a clipboard/copy icon button docked inside the right edge of the code box, with the tooltip "Copy code".
- **On click:** focus the box, highlight the whole code, and change the hint line to **"✔ Selected! Press Ctrl+C"** (green, with a soft pulse). Play a small UI click sound.
- **On popup open:** same as clicking. The code is already selected, so the fastest path is just **Ctrl+C**.
- **Read-only box:** if the player types into it, the code is restored and re-selected, so it can't be accidentally edited.
- **Readable paste:** the box holds a short line with the code in a Discord spoiler, e.g. `WANTED: **Grimlok Ashveil** · 500g ||BL1-B-…||` (kills: `CLAIMED: … · Bounty #12 ||…||`, links: `LINK: … ||…||`). In `#bounty-line` it shows as one tidy line with a black bar; the bot finds the code inside. The proof stamp still shows the bare code for the screenshot reader.
- **Clicking anywhere in the box** re-selects the full code (no partial selections).
- **Escape** closes the popup; `/bl last` re-opens it.

```lua
copyBtn:SetScript("OnClick", function()
  box:SetFocus(); box:HighlightText()
  hint:SetText("|cff33ff33✔ Selected! Press Ctrl+C|r"); PlaySound(SOUNDKIT.IG_MAINMENU_OPTION_CHECKBOX_ON)
end)
box:SetScript("OnTextChanged", function(self, userInput)
  if userInput then self:SetText(code); self:HighlightText() end   -- read-only
end)
box:SetScript("OnMouseUp", function(self) self:HighlightText() end)
box:SetScript("OnEscapePressed", function() popup:Hide() end)
```

The same component is used for the bounty-post popup (5.4), the kill popup (5.7), and `/bl link`.

6. Guild banner to all Bounty Line users:
   > 💰 **Rich Russell collected the bounty on Grimlok Ashveil!** Proof incoming on the Discord Bounty Board.
7. Kill record saved to `BountyLineCharDB.kills` (so `/bl last` can re-show it).

### 5.8 Guild comms protocol (addon channel)

Prefix: `BountyLine` (≤16 chars). Messages are serialized and chunked with **AceComm** (which uses ChatThrottleLib) to avoid server throttling.

| Message | Payload | Who sends |
|---|---|---|
| `HELLO` | my pack version | Every client on login/reload |
| `PACK` | full pack (chunked) | Anyone with a newer pack than the `HELLO` sender |
| `NEWB` | new bounty summary (from local `/bl mark`) | The poster (shown as a "pending, confirm on Discord" banner) |
| `SEEN` | bounty id, zone, timestamp | Whoever spots a target (throttled: 1 per bounty per 60s) |
| `KILL` | bounty id, killer name | The killer |

**Trust rule:** only process messages arriving on `GUILD`. Optional setting: only accept `PACK` from guild ranks ≥ X (officer-only pack distribution).
**Instance rule:** queue outgoing messages while addon comms are restricted (active instance encounters) and flush afterward.

### 5.9 SavedVariables

```lua
BountyLineDB = {
  version = 1,
  boardTag = "K7QF",
  discordName = "WoW Forever",        -- for "check the Discord Bounty Board" banners
  pack = { version = 1732120000, bounties = { [12] = {...}, ... } },
  lastSeen = { [12] = { zone = "Stranglethorn Vale", t = 1732120345 } },
  settings = { sound = true, glow = true, banners = true, minimapIcon = {...} },
}
BountyLineCharDB = {
  kills = { { code = "BL1-K-...", bountyId = 12, t = 1732120400, shot = true } },
}
```

---

## 6. Component 2: The Codes

> **Exact wire format:** [Compendium 02: Code Format Spec](compendium/02-Code-Format-Spec.md) is the binding byte-level contract and supersedes the field lists below, which give the overview.

Codes are the bridge between game and Discord. They must be **short, copy-safe, typo-resistant, and versioned.**

### 6.1 Format

```
BL1-<TYPE>-<BASE32 PAYLOAD>-<CHECK>
```

- `BL1`: Bounty Line code, format version 1
- `TYPE`: `B` (bounty post), `K` (kill claim), `P` (bounty pack, Discord → game)
- `PAYLOAD`: binary-packed fields, encoded in **Crockford Base32** (no I/L/O/U, case-insensitive, safe in chat)
- `CHECK`: CRC-16 of version+type+payload, 4 base32 chars. Catches truncated or mistyped pastes.

### 6.2 B code (bounty post) fields

| Field | Notes |
|---|---|
| boardTag | 4 chars, from the imported pack (blank if none yet; server infers from channel) |
| target GUID | the key field |
| target name | first + surname |
| class, race, level, faction | display |
| reward (gold) | integer |
| poster GUID + name | |
| zone mapID | where marked |
| unix timestamp | |
| nonce | 2 bytes, prevents identical duplicate codes |

### 6.3 K code (kill claim) fields

| Field | Notes |
|---|---|
| boardTag | |
| bountyId | |
| victim GUID | must equal bounty's GUID |
| killer GUID + name | must be a guild member, must not equal poster |
| unix timestamp | kill time; also printed on the proof stamp |
| zone mapID | |
| honorCorroborated | 0/1 |
| nonce | |

### 6.4 P code (bounty pack)

Generated by the bot. Contains board tag, pack version (unix time), Discord server display name, and the list of open bounties. If it gets long, the bot compresses it (deflate + base32). Long strings are fine in WoW EditBoxes, same as WeakAuras/Plater import strings.

### 6.5 Example (illustrative)

```
BL1-K-0K7QF0C3M2PL8QX4YH6N1ZC5V0FJ2T9R8W1E-4R7D
```

---

## 7. Component 3: The Bounty Board Backend (Cloudflare)

### 7.1 Architecture

```
                 ┌─────────────────────────────────────────────┐
 Discord Gateway │  Durable Object: GatewayDO                  │
 (WebSocket) ◀──▶│  holds the bot's live connection; receives  │
                 │  MESSAGE_CREATE in #bounty-line             │
                 └───────────────┬─────────────────────────────┘
                                 │ internal call
 Discord HTTP    ┌───────────────▼─────────────────────────────┐
 Interactions ──▶│  Worker: bounty-board                       │
 (slash cmds,    │  • /interactions (verify Ed25519 signature) │
  buttons)       │  • code parser + rules engine               │
                 │  • proof pipeline (R2 + Workers AI)         │
                 │  • Discord REST client                      │
                 │  • cron handlers                            │
                 └──┬──────────┬──────────┬──────────┬─────────┘
                    │          │          │          │
                  D1 (SQL)   R2 (images) Workers AI  Cron Triggers
```

### 7.2 Why a Durable Object?

Players paste codes as **normal chat messages**. Reading normal messages requires the bot to hold a live Gateway (WebSocket) connection. Workers alone can't, but a **Durable Object** can: as of June 2026, Durable Objects stay alive for the duration of active outbound WebSocket connections. A cron "heartbeat" every minute pings the DO and reconnects it if it dropped. One gateway connection covers all servers the bot is in (single shard handles thousands of guilds).

### 7.3 Cloudflare resources

| Resource | Binding | Purpose |
|---|---|---|
| Worker | `bounty-board` | Everything |
| D1 | `DB` | Bounties, kills, hunters, tenants, audit log |
| R2 bucket | `PROOFS` | Proof screenshots (permanent copy, independent of Discord CDN) |
| Durable Object | `GATEWAY` | Discord Gateway connection |
| Workers AI | `AI` | Screenshot stamp reading (vision model, e.g. Llama 4 Scout) |
| Cron | `*/1 * * * *` heartbeat; `0 * * * *` expiry sweep; weekly Most Wanted post | Scheduled jobs |
| Secrets | `DISCORD_TOKEN`, `DISCORD_PUBLIC_KEY`, `DISCORD_APP_ID` | Set via `wrangler secret put`, **never committed** |

### 7.4 Message handling in `#bounty-line`

```
on MESSAGE_CREATE (channel == tenant.bountyLineChannel, author not a bot):
  codes = extract all /BL1-[BKP]-[0-9A-Z]+-[0-9A-Z]{4}/i
  if none: ignore (normal chatter allowed)
  for each code:
    decode → checksum fail? reply "That code looks cut off. Copy it again with /bl last"
    B → createBounty()
    K → requires an image attachment → submitKill()
    P → ignore (packs flow Discord → game only)
  react ✅ on success / ❌ on failure, reply with details (auto-delete error replies after 60s)
```

### 7.5 Slash commands (HTTP interactions)

| Command | Who | Purpose |
|---|---|---|
| `/bl setup` | Server admin | Pick #bounty-line channel, #bounty-board forum, officer role, link in-game guild name |
| `/bl pack` | Anyone | Post the current Bounty Pack code (ephemeral or in channel) |
| `/bl submit code: image:` | Anyone | **Fallback** if pasting doesn't work (same pipeline as chat paste) |
| `/bl cancel id:` | Poster or officer | Cancel an open bounty |
| `/bl leaderboard` | Anyone | Top hunters, most wanted, biggest payers |
| `/bl me` | Anyone | Your stats, trust level, pending payments |
| `/bl config` | Admin | Expiry days, min/max reward, auto-approve threshold, AI check on/off |

### 7.6 Buttons on bounty threads

- **Approve / Deny** (officer role): for flagged kill claims
- **Paid** (poster only): "I sent the gold in game"
- **Received** (hunter only): "I got the gold"
- Both Paid + Received → thread gets the **PAID** stamp and is closed/archived

---

## 8. Component 4: Discord Server Layout & Bot Behavior

### 8.1 Channels

| Channel | Type | Purpose |
|---|---|---|
| `#bounty-line` | Text | Where players paste codes + screenshots. Pinned: how-to + current Bounty Pack |
| `#bounty-board` | **Forum** | One thread per bounty (the wanted poster). Bot-managed |
| (optional) `#bounty-hall-of-fame` | Text | Bot posts PAID bounties + weekly Most Wanted recap |

**Forum tags:** `Open`, `Claimed – Review`, `Awaiting Payment`, `Paid`, `Expired`, `Cancelled`.

### 8.2 Wanted poster (thread starter embed)

```
☠  WANTED: GRIMLOK ASHVEIL
Orc Warrior · Level 42 · Horde
Reward: 500g (honor system, paid by Rich Russell)
Marked in: Stranglethorn Vale · Nov 20, 1:32 PM
Bounty #12 · Expires Dec 4
Status: OPEN
[parchment wanted-poster image]
```

### 8.3 Kill proof post (in the bounty's thread)

```
💰 BOUNTY CLAIMED by Hunter McHunterface
Killing blow · Stranglethorn Vale · Nov 21, 9:14 PM
✅ GUID match  ✅ Stamp read: matches code  ✅ Posted 6 min after kill
Verdict: AUTO-APPROVED (trusted hunter) / NEEDS OFFICER REVIEW
[screenshot]
[Approve] [Deny]   → then → [Paid] [Received]
```

### 8.4 Guild nudges

- Pinned how-to in `#bounty-line` (with screenshot-folder tip).
- In game, all banners point to the board: *"…go check the Discord Bounty Board"* (server name from pack).
- Weekly cron post: **Most Wanted** (top gold on heads), **Top Hunters**, **Unpaid bounties** (gentle honor-system nudge).

---

## 9. Screenshot Proof & Automated Verification

### 9.1 Hard limit

An addon can take a screenshot but **cannot read or upload it**. With Tier 1, the player drags **one file** into Discord. Everything else is automated.

### 9.2 The proof stamp (in-game)

Drawn for ~0.5s around the auto-screenshot, centered, high contrast, large font:

```
████████████████████████████████████████████████████
  BOUNTY LINE · KILL CONFIRMED
  Grimlok Ashveil · 500g · Bounty #12
  Stranglethorn Vale · 2026-11-21 21:14:07
  BL1-K-M2PL8QX4...-4R
████████████████████████████████████████████████████
```

- Shows the **full K code**, so screenshot and pasted code must agree.
- Victim's corpse and nameplate remain visible in the background.
- Designed for OCR: plain font, dark backing panel, no overlap with UI.

### 9.3 Automated checks (bot)

| # | Check | Pass condition |
|---|---|---|
| 1 | Code integrity | Checksum OK, version known, board tag matches tenant |
| 2 | Bounty state | Bounty exists, is `Open`, not expired |
| 3 | Identity | Victim GUID == bounty GUID; killer ≠ poster; killer is a guild member (linked Discord ↔ character, or first claim prompts a link) |
| 4 | Attachment | Exactly one image, PNG/JPG, < 25 MB; stored to R2 |
| 5 | **AI stamp read** | Workers AI vision model extracts stamp text → code, target name, bounty #, timestamp all match |
| 6 | Time window | Discord post within N hours of kill timestamp (default 24h) |
| 7 | Duplicates | Image hash not seen before; code not used before |

**Verdict:**
- All pass + hunter is **trusted** → **auto-approve**
- All pass + not trusted → **auto-approve** if the tenant allows it, otherwise officer queue with "all checks green"
- Any fail → **officer review** with the failing checks listed

### 9.4 Trust levels

- **New hunter:** officer approves.
- **Trusted:** ≥ 5 approved kills, 0 denials in last 30 days → clean matches auto-approve.
- A denied claim resets trust to New.

### 9.5 Making the drag-and-drop painless

- Kill popup shows the folder path.
- Pinned tip: pin `World of Warcraft\_forever_\Screenshots` to Windows Explorer Quick Access; sort by Date modified; drag the top file into Discord.
- Tip: set screenshot format to PNG for best OCR (JPG also works).

### 9.6 Future option (not Tier 1)

A tiny opt-in companion app could auto-upload. It's parked; Tier 1 never depends on it.

---

## 10. Rules Engine

| Rule | Default | Configurable |
|---|---|---|
| Kill credit | Killing blow only (`PARTY_KILL` attacker == you or your pet) | Pet kills count: on |
| Who can post | Any guild member | Min guild rank |
| Target faction | **Opposite faction only** (addon + server check) | No |
| Duels | **Never count.** Duel kills are ignored; no "duel bounties" | No |
| Bounties on guildmates | Blocked (implied by opposite-faction rule) | No |
| Claim own bounty | Blocked | No |
| One bounty per target | Multiple posters can **stack** gold on the same GUID (shows total) | Stacking on/off |
| Closing | First approved kill closes the bounty | "Repeatable ×N" option |
| Expiry | 14 days | 1–60 days |
| Reward min/max | **1g / 10,000g** (1g allowed so test bounties cost almost nothing) | Yes |
| Proof window | 24h from kill to Discord post | Yes |
| Payment | Poster clicks Paid, hunter clicks Received | Officer can force-close |
| Unpaid nudge | Weekly list of approved-but-unpaid | On/off |
| Cooldown | Same hunter can't claim the same target's new bounty within 1h | Yes |

---

## 11. Graphics, Sound & Branding

### 11.1 In-game (use the client's own assets)

Addons may reference textures, atlases, icons, fonts and sounds already in the client. Nothing is redistributed.

| Use | Asset (verify exact names in-game with a texture/atlas browser) |
|---|---|
| Target marker | Raid target skull: `Interface\TargetingFrame\UI-RaidTargetingIcon_8` |
| Poster/popup background | Parchment / quest-frame textures and atlases |
| Gold | Coin icons (gold/silver/copper) |
| Faction | PvP faction crest icons |
| Headers | Friz Quadrata (`Fonts\FRIZQT__.TTF`) |
| Alert sound | `SOUNDKIT.RAID_WARNING` |
| Kill sound | Coin/loot "cha-ching" sound kit |

Plus our own `Media/` textures (TGA/BLP, power-of-two sizes): **Bounty Line logo**, glow ring, stamp backing.

### 11.2 Discord & CurseForge (original art only)

Don't rip Blizzard art for out-of-game use. Make original:
- Bounty Line logo (CurseForge needs a project logo)
- Parchment **wanted-poster** template (bot fills name/class/reward)
- **PAID**, **CLAIMED**, **EXPIRED** stamps
- CC-licensed icons (e.g. game-icons.net, CC BY 3.0) with attribution in the README and pinned post

### 11.3 Voice & copy

Short, flavorful, readable mid-fight: "WANTED", "Bounty collected!", "Go check the Discord Bounty Board."

---

## 12. Data Model

D1 (SQLite) schema, multi-tenant from day one:

```sql
CREATE TABLE tenants (
  id                 TEXT PRIMARY KEY,          -- Discord guild (server) ID
  board_tag          TEXT UNIQUE NOT NULL,      -- 4-char code tag
  wow_guild_name     TEXT,
  bounty_line_ch     TEXT, bounty_board_forum TEXT, hall_of_fame_ch TEXT,
  officer_role_id    TEXT,
  config_json        TEXT NOT NULL DEFAULT '{}',
  created_at         INTEGER NOT NULL
);

CREATE TABLE characters (                      -- Discord user ↔ WoW character link
  tenant_id TEXT, guid TEXT, name TEXT, discord_user_id TEXT,
  PRIMARY KEY (tenant_id, guid)
);

CREATE TABLE bounties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT NOT NULL,
  target_guid TEXT NOT NULL, target_name TEXT, class TEXT, race TEXT, level INTEGER, faction TEXT,
  reward_gold INTEGER NOT NULL,
  poster_guid TEXT, poster_name TEXT, poster_discord_id TEXT,
  zone_map_id INTEGER, created_at INTEGER, expires_at INTEGER,
  status TEXT NOT NULL,           -- open|review|awaiting_payment|paid|expired|cancelled
  thread_id TEXT, source_code TEXT UNIQUE
);
CREATE INDEX idx_bounties_tenant_status ON bounties(tenant_id, status);
CREATE INDEX idx_bounties_target ON bounties(tenant_id, target_guid);

CREATE TABLE kills (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT, bounty_id INTEGER,
  killer_guid TEXT, killer_name TEXT, killer_discord_id TEXT,
  victim_guid TEXT, killed_at INTEGER, zone_map_id INTEGER,
  code TEXT UNIQUE, image_r2_key TEXT, image_hash TEXT,
  checks_json TEXT,               -- per-check pass/fail + AI read text
  verdict TEXT,                   -- auto|approved|denied|pending
  reviewed_by TEXT, paid_at INTEGER, received_at INTEGER
);

CREATE TABLE hunters (
  tenant_id TEXT, discord_user_id TEXT,
  approved INTEGER DEFAULT 0, denied INTEGER DEFAULT 0, gold_earned INTEGER DEFAULT 0,
  trust TEXT DEFAULT 'new',
  PRIMARY KEY (tenant_id, discord_user_id)
);

CREATE TABLE audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tenant_id TEXT, at INTEGER, actor TEXT, action TEXT, detail_json TEXT
);
```

---

## 13. Security, Anti-Cheat & Honest Limits

**What we protect against well**
- Wrong-target claims → GUID match
- Typos/truncation → checksum
- Reused codes/screenshots → uniqueness + image hash
- Self-dealing → poster ≠ killer; no guildmate bounties
- Stale claims → time window
- Forged Discord interactions → Ed25519 signature verification on every request

**What we can't fully prevent**
- A determined cheater can forge a code and a fake stamp, because nothing inside an addon is secret (Blizzard requires addon code to be readable). Defense: AI check + officer spot checks + trust resets + the social stakes of honor-system gold.

**Operational security (public repo!)**
- No tokens in the repo, ever. Use `wrangler secret put` and GitHub Actions secrets.
- Enable **GitHub secret scanning + push protection**.
- Least-privilege Cloudflare API token for CI (Workers + D1 + R2 edit on one account).
- Bot permissions: only what's needed (View Channel, Send Messages, Send Messages in Threads, Embed Links, Attach Files, Add Reactions, Manage Threads, Create Public Threads, Read Message History, Pin Messages in the two channels; invite permission integer `2252126231317568`). Never Administrator, Manage Server, Manage Roles or Manage Messages. Manage Channels (to create forum tags) is granted only on the `#bounty-board` forum through a channel override, not server-wide.

**Privacy**
- Store only: Discord user IDs, WoW character names/GUIDs, screenshots submitted as proof.
- `/bl forget-me` deletes a user's links and stats (screenshots in already-closed bounties are anonymized).
- Simple Privacy note in the README (each guild runs its own bot and holds its own data).

---

## 14. Making It Generic: Multi-Guild Support

Goal: **any guild** can use Bounty Line + the Bounty Board with no code changes.

### 14.1 Cost rule: other guilds never run on Rich's Worker

**Decision:** there is **no shared hosted bot.** The addon is public on CurseForge (free for everyone, costs Rich nothing). The **backend is self-hosted**: each guild deploys its own copy of the Worker on **its own Cloudflare account** with **its own Discord app**.

| Who | Runs | Pays |
|---|---|---|
| Rich's guild | Rich's Discord app + Rich's Worker | Rich (paid Cloudflare) |
| Any other guild | Their own Discord app + their own Worker (forked/cloned from the public repo) | That guild's Cloudflare account |
| Everyone | The same Bounty Line addon from CurseForge | Free |

**How Rich's bot stays private (defense in depth):**
1. **Discord Developer Portal → Bot → "Public Bot" OFF.** Only Rich can add it to servers.
2. **Server allowlist:** `ALLOWED_GUILD_IDS` env var. On `GUILD_CREATE` for any other server, the bot leaves immediately, and all interactions/messages from non-allowlisted servers are dropped before any D1, R2 or AI work happens.
3. **Spend guards:** per-day caps on AI checks and code submissions, plus a Cloudflare billing alert on the account.
4. **Interactions endpoint:** signature-verified, so random traffic to the Worker URL is rejected in microseconds.

**The addon is backend-agnostic.** It never talks to a server; it only makes and reads codes. Any guild's self-hosted Bounty Board reads the same codes, and the **board tag** keeps one guild's codes from being accepted by another guild's bot.

### 14.1b What self-hosting costs another guild

- Cloudflare's free plan likely covers a small guild's Worker, D1 and R2 usage. The always-on gateway Durable Object and the Workers AI proof check may push them onto **Workers Paid** (starts at $5/month). Confirm current plan limits before promising "free."
- **Budget mode** for guilds that want $0: config flag `READ_CHAT=false` + `AI_CHECK=false`. The bot runs purely on HTTP interactions (players use `/bl submit code: image:` instead of pasting), with no Durable Object and no AI, and officers approve every claim. Slightly clunkier, but it fits a free account.

### 14.2 What makes it tenant-safe

- **Tenant = Discord server ID.** Every table row carries `tenant_id`. Every query filters by it.
- **Board tag:** `/bl setup` assigns a unique 4-char tag (e.g. `K7QF`). It's embedded in every pack and code. A code pasted into the wrong server is rejected with a friendly message.
- **In-game scoping:** the addon only syncs over the `GUILD` channel, so packs never leak across guilds. Board tag + in-game guild name are both stored and shown.
- **Nothing hardcoded:** channel names, server display name, officer role, rules, reward limits, expiry, AI check, banner wording are all per-tenant config.
- **Neutral branding:** default copy says "your Discord Bounty Board"; the server name comes from the pack.

### 14.2b The "Deploy your own Bounty Board" guide (README)

The README walks another guild's tech person through Sections 17 and 18 in about 30 minutes:
1. Fork/clone the repo.
2. Create their own Discord app (Section 17), with Public Bot OFF and their server ID in `ALLOWED_GUILD_IDS`.
3. `wrangler login` to **their** Cloudflare account, then create D1 + R2, set secrets, and deploy (Section 18).
4. Choose full mode or budget mode.
5. Invite their bot, run `/bl setup`, pin the pack, and tell guildies to install Bounty Line from CurseForge.

Later, optionally, a **"Deploy to Cloudflare" button** in the README can automate step 3.

### 14.3 `/bl setup` flow (inside each guild's own deployment)

1. Admin runs `/bl setup`.
2. Bot asks (select menus): Bounty Line text channel, Bounty Board forum channel (or "create them for me"), officer role, in-game guild name.
3. Bot creates forum tags, posts + pins the how-to and the first (empty) Bounty Pack.
4. Bot replies: "You're live! Tell your guild to install **Bounty Line** from CurseForge and run `/bl import` with the pinned pack."

### 14.4 Cost controls (every deployment, including Rich's)

- Allowlist check runs **first**, before any paid work.
- Rate limits (codes per user per minute) and a daily AI check cap, falling back to officer review when exceeded.
- R2 lifecycle rule: delete proof images 180 days after a bounty closes (configurable).
- Cloudflare usage/billing notifications turned on.
- The data model stays tenant-keyed anyway, so an alliance of a few friendly guilds *could* share one deployment if its owner chooses. It's off by default.

### 14.5 Discord's privileged-intent threshold

Reading pasted codes needs the **Message Content** intent. As of June 10, 2026, Discord's review threshold is based on **users, not servers**, and apps under **10,000 users** aren't affected. Since every guild runs its **own** private bot, each bot stays far under that threshold, so it's just a toggle in the developer portal. `/bl submit` remains as a fallback that needs no privileged intent.

### 14.6 Policy guardrails for a public addon

Follow Blizzard's UI Add-On Development Policy (read the current version before launch). In practice:
- The addon is **free**, with **no paywalled features** tied to it.
- Code is **readable** (no obfuscation). It's in a public repo anyway.
- No ads or donation asks inside the game UI.
- If you ever offer paid hosting to other guilds, keep the addon and core bot free; check policy first.

### 14.7 Localization

All strings live in `Locales/`. Ship enUS first; accept community translations (deDE, frFR, ruRU, esES are big Forever communities) via pull requests or CurseForge's localization tool.

### 14.8 Forever rulesets

Works on Normal, PvP, RP and Hardcore rulesets. **Hardcore note:** a bounty kill is permanent for the victim, so expect higher stakes and higher rewards. Consider a "Hardcore" tag on posters.

---

## 15. Repository Layout

```
bounty-line/
├── README.md                    # what it is, screenshots, install, "Deploy your own"
├── LICENSE                      # MIT (recommended)
├── CONTRIBUTING.md
├── SECURITY.md                  # how to report vulnerabilities
├── PRIVACY.md                   # what each self-hosted bot stores
├── .gitignore                   # node_modules, .wrangler, .dev.vars, *.log
├── .github/
│   ├── workflows/
│   │   ├── addon-release.yml    # on tag: package + upload to CurseForge (+ GitHub Release)
│   │   ├── worker-deploy.yml    # on push to main (worker/**): wrangler deploy
│   │   └── ci.yml               # lint Lua (luacheck), typecheck + test worker
│   └── ISSUE_TEMPLATE/
├── .pkgmeta                     # packager config (libs, ignores)
├── addon/BountyLine/            # Section 5
├── worker/
│   ├── wrangler.jsonc
│   ├── migrations/0001_init.sql
│   ├── src/
│   │   ├── index.ts             # fetch + scheduled handlers
│   │   ├── gateway.ts           # GatewayDO
│   │   ├── interactions.ts      # slash commands, buttons
│   │   ├── codec.ts             # mirrors addon Codec.lua (shared test vectors!)
│   │   ├── rules.ts
│   │   ├── proof.ts             # R2 + Workers AI checks
│   │   └── discord.ts           # REST helpers, embeds
│   ├── scripts/register-commands.ts
│   └── test/
├── shared/test-vectors.json     # same codes decoded by Lua and TS: guarantees compatibility
└── art/                         # logo, poster template, stamps (source files)
```

---

## 16. Guide: Setting Up the Public GitHub Repo

### 16.1 One-time tools
1. Install **Git** and the **GitHub CLI** (`gh`), then run `gh auth login`.
2. Install **Node.js LTS** (for the Worker) and **VS Code**.

### 16.2 Create the repo
```bash
gh repo create bounty-line --public --description "Guild PvP bounties for WoW: Forever — in-game addon + Discord Bounty Board" --license mit --gitignore Node --clone
cd bounty-line
```
(Or on github.com: New repository → name `bounty-line` → Public → add MIT license + Node .gitignore.)

### 16.3 Lock it down (Settings tab)
- **Code security → Secret scanning: ON, Push protection: ON.**
- **Branches → protect `main`:** require pull request + passing CI (even solo, this prevents accidental pushes from breaking the live bot).
- **Actions → secrets** (add as you reach each step):
  - `CLOUDFLARE_API_TOKEN`, `CLOUDFLARE_ACCOUNT_ID` (Section 18)
  - `CF_API_KEY` (CurseForge upload token, Section 19)
  - `DISCORD_TOKEN`, `DISCORD_APP_ID` (only for the command-registration workflow)
- Add a `.dev.vars` file locally for Worker secrets. It's in `.gitignore` and **never committed**.

### 16.4 Add the code and push
```bash
# after the scaffold is generated into this folder
git add .
git commit -m "Bounty Line v0.1 scaffold"
git push -u origin main
```

### 16.5 Make it look legit
- README with a GIF of the kill → stamp → popup flow, install steps, and "Deploy your own."
- Topics: `world-of-warcraft`, `wow-addon`, `wow-forever`, `discord-bot`, `cloudflare-workers`.
- Releases: tag `v0.1.0`; the release workflow builds the zip.

---

## 17. Guide: Discord App Setup

1. **discord.com/developers/applications → New Application** → "Bounty Line."
2. **General Information:** copy **Application ID** and **Public Key**. Add the app icon (Bounty Line logo).
3. **Bot tab:** Reset/copy **Token** (store as a secret only). Enable **Message Content Intent**. Turn **Public Bot OFF** so only you can invite it. Then set `ALLOWED_GUILD_IDS` (your Discord server ID: Developer Mode → right-click server → Copy Server ID) as a GitHub Actions **Variable** (Compendium 01 Section 4.2), not a Worker secret: the deploy writes it into the Worker's vars, and a secret with the same name would conflict. Slash commands are registered only in the servers it lists.
4. **Installation / OAuth2:** scopes `bot` + `applications.commands`; permissions from Section 13. Copy the invite URL.
5. After the Worker is deployed: set **Interactions Endpoint URL** = `https://bounty-board.<your-subdomain>.workers.dev/interactions` (or your custom domain). Discord pings it to verify.
6. Run `npm run register-commands` to publish slash commands.
7. Invite the bot to your server and run `/bl setup`.

---

## 18. Guide: Cloudflare Setup

```bash
npm i -g wrangler
wrangler login

cd worker
npm install
wrangler d1 create bounty-board            # paste database_id into wrangler.jsonc
wrangler r2 bucket create bounty-proofs
wrangler d1 migrations apply bounty-board --remote

wrangler secret put DISCORD_TOKEN
wrangler secret put DISCORD_PUBLIC_KEY
wrangler secret put DISCORD_APP_ID

wrangler deploy
```

`wrangler.jsonc` (abridged):
```jsonc
{
  "name": "bounty-board",
  "main": "src/index.ts",
  "compatibility_date": "2026-11-01",
  "d1_databases": [{ "binding": "DB", "database_name": "bounty-board", "database_id": "<id>" }],
  "r2_buckets":   [{ "binding": "PROOFS", "bucket_name": "bounty-proofs" }],
  "ai":           { "binding": "AI" },
  "durable_objects": { "bindings": [{ "name": "GATEWAY", "class_name": "GatewayDO" }] },
  "migrations":   [{ "tag": "v1", "new_sqlite_classes": ["GatewayDO"] }],
  "triggers":     { "crons": ["*/1 * * * *", "0 * * * *", "0 17 * * SUN"] }
}
```

**CI token:** Cloudflare dashboard → My Profile → API Tokens → Create → "Edit Cloudflare Workers" template, scoped to your account (+ D1/R2 edit). Save as `CLOUDFLARE_API_TOKEN` in GitHub.

**Optional:** custom domain (e.g. `bounty.<yourdomain>`) for nicer URLs and a public "Wanted" page later.

---

## 19. Guide: CurseForge Submission & Release Pipeline

### 19.1 Create the project (one time)
1. Sign in at **curseforge.com** and open the **author console** (Authors / "Create a project").
2. **Game:** World of Warcraft → **Addons**.
3. Fill in:
   - **Name:** Bounty Line
   - **Author credit:** everything players see (TOC `## Author`, description, screenshots, changelog) names the author as **"Slac Jaw from RP-PVP"**
   - **Summary:** "Guild PvP bounties for WoW: Forever. Mark targets, hunt them, auto-screenshot the kill, and prove it on your Discord Bounty Board."
   - **Categories:** PvP; Chat & Communication (pick what's available)
   - **License:** MIT
   - **Logo:** square PNG (original art)
   - **Description:** what it does, the code workflow, screenshots/GIF, link to GitHub + bot invite + setup guide. Per CurseForge guidelines, keep promo links (Discord, socials) **below** the main description and modestly sized.
   - **Source:** link the GitHub repo.
4. Save and note the **Project ID** → put it in the TOC as `## X-Curse-Project-ID: <id>`.
5. Account settings → **API tokens** → create one → GitHub secret `CF_API_KEY`.

### 19.2 Automated releases with the BigWigs packager
`.github/workflows/addon-release.yml`:
```yaml
name: Release Addon
on:
  push:
    tags: ["v*"]
jobs:
  release:
    runs-on: ubuntu-latest
    env:
      CF_API_KEY: ${{ secrets.CF_API_KEY }}
      GITHUB_OAUTH: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4
        with: { fetch-depth: 0 }
      - uses: BigWigsMods/packager@v2
        with:
          args: -t addon/BountyLine
```
The packager reads the TOC's `## Interface: 16001` to tag the upload with the Forever game version, substitutes `@project-version@`, pulls libraries listed in `.pkgmeta`, uploads to CurseForge, and creates a GitHub Release.

### 19.3 Ship a version
```bash
git tag v0.1.0
git push origin v0.1.0
```
→ Action runs → file appears on CurseForge **Under Review**. Moderation is a mix of automated checks and manual review; first files take longer than later updates. Once approved, it's live.

### 19.4 Release types
- `v0.1.0-beta1` → uploaded as **Beta** (guild testers opt in)
- `v0.1.0` → **Release**
- Use betas for the first guild test week.

### 19.5 Optional extra mirrors
The same packager can upload to **Wago** (`-a <wago-id>`) and **WoWInterface** (`-w <id>`) for players who don't use CurseForge.

---

## 20. Rolling It Out to the Guild

1. **Officer soft launch (week 1):** 3–5 officers install the beta, run `/bl test`, post a few practice bounties.
2. **Discord prep:** create channels (or `/bl setup` creates them), pin the how-to, post the first pack.
3. **Guild announcement:** in Discord and in guild MOTD:
   > Install **Bounty Line** (CurseForge, filter: WoW Forever). Paste the pinned pack from #bounty-line with **/bl import**. Mark enemies with **/bl mark 500g**. Kill them, paste your code + screenshot in #bounty-line. Go check the Discord Bounty Board!
4. **Launch event:** "Opening Night": officers post a slate of bounties on known rivals.
5. **Week 2:** review flagged claims, tune auto-approve, expiry and reward limits.
6. **Then:** flip to Release on CurseForge, and point other guilds to the "Deploy your own Bounty Board" guide (Section 14). They host their own backend.

---

## 21. QA & Test Plan

| Area | Test cases |
|---|---|
| Codec | Lua and TS decode the same `shared/test-vectors.json`; checksum catches 1-char edits and truncation; case-insensitive paste; extra whitespace/newlines tolerated |
| Marking | Same-faction target blocked; NPC blocked; guildmate blocked; reward parsing (`500`, `500g`, `1k`, `0`, negative, huge) |
| Detection | Nameplate on/off; target/focus/mouseover; tooltip; stealth re-appearance; in-combat secret values; 20+ nameplates performance |
| Kill | Your killing blow ✔; pet killing blow ✔ (if enabled); assist ✗; someone else's kill ✗; duel (win, loss, out-of-bounds) ✗; same-faction kill ✗; kill in battleground (decide: allowed?); screenshot failed path |
| Comms | Pack propagation to 5 online clients; late login gets pack; older pack ignored; instance restriction queue/flush; throttle under spam |
| Bot paste | Multiple codes in one message; code without image (K); image without code; wrong server's code; duplicate code; expired bounty |
| AI proof | Clean stamp; blurred/cropped stamp; mismatched stamp; non-WoW image; dark/bright scenes; 4K and 1080p |
| Payments | Paid then Received; Received then Paid; officer force-close; unpaid nudge |
| Multi-tenant | Two test servers; no cross-tenant reads; `/bl setup` idempotent |
| Resilience | Gateway drop → heartbeat reconnect; D1 error → friendly reply; Discord rate limits respected |

---

## 22. Roadmap

| Version | Scope |
|---|---|
| **v0.1** | Worker + bot (gateway DO, paste codes, forum posters, manual officer approval) + addon (mark, import, highlight, kill detect, stamp, screenshot, popups, guild banners) |
| **v0.2** | AI stamp verification, trust levels, Paid/Received flow, leaderboard, weekly recap |
| **v0.3** | In-game board window with last-seen, stacked bounties, options panel polish, art pass |
| **v1.0** | Public CurseForge release, private allowlisted bot for Rich's guild, `/bl setup`, budget mode, README "Deploy your own Bounty Board" for other guilds |
| **v1.x** | Localization, public "Wanted" web page (Cloudflare Pages), repeatable bounties, Hardcore tag, seasonal leaderboards |
| **Later (optional)** | Tier 2 companion uploader (opt-in only) |

---

## 23. Open Items & Things to Verify on Day One

1. **`Screenshot()` on Forever:** confirm it works from addon code and that `SCREENSHOT_SUCCEEDED` fires.
2. **Secret values:** `issecretvalue` exists on Forever (verified 2026-11-21). Still to check: `UnitGUID`/`UnitName` on enemy nameplates during combat. If secret, highlight from out-of-combat cache.
3. **`PARTY_KILL` payload on Forever:** confirm attacker/victim GUIDs as expected; confirm pet kills.
4. **Guild chat from addon:** test whether a button-click `SendChatMessage(..., "GUILD")` is allowed. If blocked, drop "Announce to Guild" and rely on addon banners.
5. **Right-click menu tags** for enemy players on Forever's target/focus/party frames, and whether the unit data is readable mid-combat (Section 5.4b).
6. **Atlas/texture names** on the Forever client (browse in game before finalizing art).
7. **Character linking UX:** first-claim prompt that links a Discord user to a WoW character (`/bl link` code from the addon is the cleanest Tier 1 option).
8. **Battleground/arena kills:** count or not? (Default proposal: open-world only.)
9. **Duplicate posters:** stacking UX when two members mark the same GUID.
10. **Player GUID shape on Forever:** confirm `UnitGUID` returns `Player-<serverID>-<8 hex>` with an unpadded decimal server ID ≤ 65535 (print a few with `/bl debug`). Codes use the 7-byte compact form for that shape; anything else still works through the raw fallback, just ~25 characters longer per GUID (Compendium 02 Section 2).
    - ✅ **Verified 2026-11-21** (client 1.60.1 build 71037): `Player-6935-00156D68`, `Player-6935-007356CE`. Compact form applies.
11. **Zone names on wanted posters:** B codes carry only `mapID`, so posters show "Zone #1434". Print `C_Map.GetBestMapForUnit("player")` and the zone name with `/bl debug` in a few zones, then either ship a verified mapID→name table in the Worker or add the zone name to a schema-2 B code.
    - **Decision:** a verified table in the Worker (`worker/src/wow.ts`); unknown zones are left off the poster. Verified 2026-11-21: all 51 outdoor zones of Eastern Kingdoms, Kalimdor and the Forever additions (1411–1458, 2482 Mount Hyjal, 2521/2665 Zephras Isle, 2548 Riverglades, 2652 Shen'dralas).
12. **Full character names:** ✅ **Verified 2026-11-21:** `UnitName(unit)` returns the first name and the **surname** as its two values ("Slac", "Jaw"); the surname sits where retail has the realm. `GetUnitName(unit, true)` and `UnitPVPName` also give "Slac Jaw"; `UnitFullName` and `UnitNameUnmodified` give the first name only. Codes use `UnitName`'s two values joined with a space.
13. **"??" levels:** `UnitLevel` returns -1 for enemies far above you. B codes carry level 0 for that and the Bounty Board shows "Level ??". Confirm the -1 on Forever.
14. **Copy button icon:** the popup uses `Interface\Buttons\UI-GuildButton-PublicNote-Up`. ✅ Shows on Forever (2026-11-21).
15. **Window art:** the border is the classic `DialogFrame\UI-DialogBox-Border` (the NineSlice `ButtonFrameTemplateNoPortrait` layout sat ~10px off the frame on Forever and was dropped). The client's `FrameGeneral\UI-Background-Rock/Marble` textures did **not** show, so backgrounds ship in `Media/` (dark crops of the poster parchment).
16. **Nameplate skull:** the addon parents a texture to `C_NamePlate.GetNamePlateForUnit(unit)`. Check it appears over enemy players and that forbidden plates are skipped without errors.
17. **Kill debugging:** `/bl debugkills` prints every `PARTY_KILL` (attacker, victim) and honor message, to settle items 1 and 3 on a real kill.
18. **Spoiler copy line:** the code box holds `WANTED: **Name** · 500g ||BL1-B-…||` (Section 5.7b). In a WoW EditBox, `||` is how a literal `|` is stored. ✅ **Verified 2026-11-21:** Ctrl+C copies one `|` per `||` pair, so `||` pasted as single pipes. The addon now writes `||||` around the code, which pastes as `||…||`.

---

## 24. Appendix: Sources

- Warlords Forever (CurseForge): Forever closes the combat log; kill signals (PARTY_KILL, honor gain, PvP kills); GUID keying, no realms. https://www.curseforge.com/wow/addons/warlords-forever
- Spy Forever (CurseForge): detection via nameplates/target/focus/mouseover on Forever. https://www.curseforge.com/wow/addons/spy-forever
- Icy Veins: Forever adopts Midnight's API restrictions. https://www.icy-veins.com/wow-forever/news/addons-in-wow-forever-blizzard-devs-just-addressed-the-big-question/
- Gamertag Mythras: Interface 16001, `_Forever.toc` suffix, `_forever_` folder. https://gamertagmythras.com/blog/world-of-warcraft/wow-forever-addons-guide
- Warcraft Wiki: `C_ChatInfo.SendAddonMessage` (GUILD channel). https://warcraft.wiki.gg/wiki/API_C_ChatInfo.SendAddonMessage
- Midnight addon messaging restrictions in instances. https://wow-midnight-addon-template.vercel.app/midnight/
- Blizzard forums: macros can no longer send chat to guild/communities. https://us.forums.blizzard.com/en/wow/t/2261956/1
- LastRites Talent Dump: addons can't make network requests (desktop companion pattern). https://www.curseforge.com/wow/addons/lastrites-talent-dump
- BigWigs packager. https://github.com/BigWigsMods/packager
- Warcraft Wiki: Using the BigWigs Packager with GitHub Actions. https://warcraft.wiki.gg/wiki/Using_the_BigWigs_Packager_with_GitHub_Actions
- CurseForge moderation tips (promo links below description). https://support.curseforge.com/support/solutions/articles/9000259760
- Cloudflare: outbound connections keep Durable Objects alive (June 2026). https://developers.cloudflare.com/changelog/post/2026-06-19-outbound-connections-keep-dos-alive/
- Cloudflare D1 limits & pricing. https://developers.cloudflare.com/d1/platform/limits / https://developers.cloudflare.com/d1/platform/pricing/
- Cloudflare Workers AI models (vision). https://developers.cloudflare.com/workers-ai/models/
- Discord: privileged intent changes, user-based threshold (June 10, 2026). https://support-dev.discord.com/hc/articles/40281523410967 · https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review
