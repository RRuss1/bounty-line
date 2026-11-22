# Bounty Line

**Put a price on an enemy's head.** Bounty Line brings guild PvP bounties to World of Warcraft: Forever. Mark an enemy player, post the bounty to your guild's Discord, hunt them down, and prove the killing blow with an automatic screenshot. The poster pays the hunter in real gold, player to player.

> **Beta.** Bounty Line is being tested by its first guild. Expect rough edges, and please report bugs (link below).

---

## How it works

1. **Mark a target.** Right-click an opposite-faction player's portrait → **Set Bounty…** → type the gold. Bounty Line gives you a short line to copy.
2. **Post it.** Press **Ctrl+C** and paste it in your guild Discord's `#bounty-line` channel. A **wanted poster** appears on your **Bounty Board**.
3. **Hunt.** Import the pinned **Bounty Pack** with `/bl import`. Wanted players get a **skull over their nameplate**, a **WANTED** line in their tooltip, and an alert the first time you spot them.
4. **Kill.** Land the **killing blow** (your pet counts). A proof stamp flashes on screen, Bounty Line takes a screenshot, and hands you a kill code.
5. **Prove it.** Paste the kill code **with the screenshot** in `#bounty-line`. Your officers approve the claim on Discord.
6. **Get paid.** The poster pays you in game. Both of you click **Paid / Received** and the poster gets its **PAID** stamp.

## Rules

- **Opposite faction only.** Never guildmates, never your own faction.
- **No duels.** Duel "kills" never count.
- **Killing blow only.** Assists don't claim the bounty.
- Rewards are real gold, paid player to player (honor system). **1g to 10,000g** by default; each guild can change the limits.

## Commands

You don't need to remember any of these: **right-click the minimap button** for a menu of everything, and **left-click** it for the Bounty Board (with tabs for your bounties and your kill codes, and a Settings button).

| Command | What it does |
|---|---|
| `/bl mark [gold] [note]` | Set a bounty on your target (same as right-click → Set Bounty…) |
| `/bl import` | Paste the Bounty Pack from your Discord |
| `/bl list` | Show open bounties |
| `/bl last` | Show your last code again |
| `/bl link` | Link your character to your Discord account so kills are credited to you |
| `/bl test` | Practice run: stamp, screenshot and kill code on a pretend target |
| `/bl options` | Settings: alerts, sounds, nameplate skull, guild sync and more |
| `/bl minimap` | Show or hide the minimap button |

## What you need

- **WoW: Forever.** Bounty Line is built for the Forever client.
- **A guild Discord running the Bounty Board bot.** Bounty Line can't reach the internet (no WoW addon can), so codes are the bridge: you copy them in game and paste them in Discord. Your guild's tech person sets up the bot once; the guide is on GitHub (link below). Each guild runs its own bot on its own free or low-cost Cloudflare account, so your data stays with your guild.

## Why copy and paste?

WoW addons can't connect to the internet or write to your clipboard. Bounty Line selects everything for you, so it's always just **Ctrl+C**, then paste in Discord. The code hides behind a spoiler bar, so chat stays tidy.

**Claiming a kill:** drop the kill screenshot into the Discord Bounty Line chat. The bot reads the kill code from the QR code on the proof stamp, so there is nothing to paste (pasting the code with the screenshot still works). Screenshots are saved to `World of Warcraft\_forever_\Screenshots` (newest file); the kill popup has that folder as a line you can copy into the upload window in Discord.

## Privacy & policy

Bounty Line makes no network requests and stores only your bounty list and recent codes in your SavedVariables. It's free, open source (MIT) and ad-free, in line with Blizzard's UI Add-On Development Policy.

---

Made by **Slac Jaw from RP-PVP**.

**Source, bot setup guide and bug reports:** https://github.com/RRuss1/bounty-line

World of Warcraft is a trademark of Blizzard Entertainment. Bounty Line is not affiliated with or endorsed by Blizzard.
