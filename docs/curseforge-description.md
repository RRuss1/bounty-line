# Bounty Line

**Put a price on an enemy's head, or on their whole guild.** Bounty Line brings guild PvP bounties to World of Warcraft: Forever. Mark an enemy player, post the bounty to your guild's Discord, hunt them down, and prove the killing blow with an automatic screenshot. The poster pays the hunter in real gold, player to player.

---

## How it works

1. **Mark a target.** Right-click an opposite-faction player (portrait, nameplate or the minimap menu) → **Set Bounty…** → type the gold. Bounty Line gives you a short line to copy.
2. **Post it.** Press **Ctrl+C** and paste it in your guild Discord's `#bounty-line` channel. A **wanted poster** appears on your Discord **Bounty Board**.
3. **Hunt.** Guildies online get the bounty straight away through guild sync. Wanted players get a **skull over their nameplate**, a **WANTED** line in their tooltip, a badge on your target frame, and an alert when you spot them. Sightings are shared with the guild.
4. **Kill.** Land the **killing blow** (your pet counts). A proof stamp flashes on screen and Bounty Line takes the screenshot for you.
5. **Prove it.** Drop that **screenshot** into `#bounty-line`. The bot reads the kill from the QR code on the stamp: nothing to paste. Your officers approve the claim (trusted hunters can be approved automatically).
6. **Get paid.** The poster pays you in game. Both of you click **Paid / Received** and the poster gets its **PAID** stamp.

## Open Season: a bounty on a whole guild

Put a price on **every member of an enemy guild**. Right-click one of them → **Set Bounty…** and pick **Their guild** instead of **This player**. You choose:

- **Per head + pot:** a price per kill and a total pot. It closes when the pot is spent.
- **Prize pool:** one total, shared between the hunters by kill count when it closes.
- **Per head, no ceiling:** a price per kill until the time is up. Your bill has no limit, and the window warns you.

It runs **7, 14 or 28 days**. That guild's members get the skull and an **OPEN SEASON** tooltip line, and a killing blow on one makes the usual kill screenshot. The same player counts **once a day per hunter**. Nobody is paid kill by kill: when the season closes, the Bounty Board posts **one payout sheet** with a line per hunter. Guildies can add gold to a pot or a pool.

Bounty Line learns which guild an enemy is in by seeing them (nameplate, target or mouseover). If it never saw the victim's guild, the claim still goes in and an officer checks the guild on the screenshot.

## Rules

- **Opposite faction only.** Never guildmates, never your own faction.
- **No duels.** Duel "kills" never count.
- **Killing blow only.** Assists don't claim the bounty.
- Rewards are real gold, paid player to player (honor system). **1g to 10,000g** by default; each guild can change the limits.
- Several people can **stack gold** on the same bounty (right-click → **Add to Bounty…**); each pays their own share.

## In game

- **Minimap button.** Left-click opens the **Bounty Board** window; right-click opens a menu with **every command**, each showing its `/bl` shortcut.
- **Bounty Board window.** Two tables: **Open Seasons** on top and **Bounties** below, each scrolling on its own. Click a column to sort, hover for details, right-click a bounty to add gold. Tabs for **My Bounties** and **My Kills** (your saved kill codes, one click to copy again).
- **Never grabs your keyboard mid-fight.** A kill in combat flashes **BOUNTY KILLED** and leaves a small square to click once the fight is over.
- **Sounds for every event**, all the game's own: a voice line when a bounty is posted, coins when gold is added, an alarm when a wanted player is in sight, a fanfare when you collect.
- **Settings** for banners, alerts, sounds, the skull and its size, tooltips, the target badge, guild sync and more.
- **Version check:** if a guildie has a newer Bounty Line, you're told to update.

## Commands

You don't need to remember any of these: **right-click the minimap button** for all of them.

| Command | What it does |
|---|---|
| `/bl` | Open the Bounty Board window |
| `/bl mark [gold] [note]` | Set a bounty on your target, or an Open Season on their guild (same as right-click → Set Bounty…) |
| `/bl import` | Paste the Bounty Pack from your Discord |
| `/bl sync` | Share your Bounty Pack with the guild now |
| `/bl list` | Show open bounties in chat |
| `/bl seasons` | Show the Open Seasons that are running |
| `/bl last` | Show your last code again |
| `/bl link` | Link your character to your Discord account so kills are credited to you |
| `/bl test` | Practice run: stamp, screenshot and kill code on a pretend target |
| `/bl banners` | Turn guild banners on or off |
| `/bl options` | Settings |
| `/bl version` | Show your version |
| `/bl minimap` | Show or hide the minimap button |
| `/bl help` | List the commands |

## On your Discord

Your guild's Bounty Board bot posts a **wanted poster** for every bounty and Open Season, keeps a pinned **Bounty Pack** up to date, reads kill screenshots, checks each claim (and can read the stamp with AI), and runs the **Paid / Received** buttons. Members also get `/bl leaderboard` (top hunters, most wanted, biggest payers), `/bl me` (your kills and payments) and `/bl season`; admins set rewards, expiry and auto-approval with `/bl config`.

**Optional relay for officers:** a small program an officer runs while playing delivers new Bounty Packs into the game and posts guildies' bounties to Discord, so nobody has to paste.

## What you need

- **WoW: Forever.** Bounty Line is built for the Forever client.
- **A guild Discord running the Bounty Board bot.** Bounty Line can't reach the internet (no WoW addon can), so codes and screenshots are the bridge. Your guild's tech person sets up the bot once; the guide is on GitHub (link below). Each guild runs its own bot on its own free or low-cost Cloudflare account, so your data stays with your guild.

## Why copy and paste?

WoW addons can't connect to the internet or write to your clipboard. Bounty Line selects everything for you, so posting a bounty is always just **Ctrl+C**, then paste in Discord. The code hides behind a spoiler bar, so chat stays tidy.

**Claiming a kill** needs no pasting at all: drop the screenshot. Screenshots are saved to `World of Warcraft\_forever_\Screenshots` (newest file); the kill popup has that folder as a line you can copy into Discord's upload window.

## Privacy & policy

Bounty Line makes no network requests. It stores only your bounty list, the guilds of enemy players you've seen (for Open Season, forgotten after two weeks) and your recent codes, in your SavedVariables. It's free, open source (MIT) and ad-free, in line with Blizzard's UI Add-On Development Policy.

---

Made by **Slac Jaw from RP-PVP**.

**Source, bot setup guide and bug reports:** https://github.com/RRuss1/bounty-line

World of Warcraft is a trademark of Blizzard Entertainment. Bounty Line is not affiliated with or endorsed by Blizzard.
