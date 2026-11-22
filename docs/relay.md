# Bounty Line Relay (optional, for officers)

The game doesn't let addons use the internet, so normally every bounty code is pasted into Discord by hand and the Bounty Pack is imported by hand. The **relay** is a small program an officer leaves running on their PC while they play. While it runs:

- **Bounty Packs arrive by themselves.** The relay fetches the newest pack every minute. Your next login or `/reload` loads it, and guild sync passes it to everyone online. Nobody types `/bl import`.
- **Guildies' bounties post themselves.** When a guildie sets a bounty, your addon briefly shows a QR code and takes a screenshot. The relay reads it and sends the bounty to the Bounty Board. The guildie pastes nothing.

Everything still works without it. With no relay online, people paste codes and import the pack as before.

## What it does and doesn't do

- It **reads** new files in your Screenshots folder and **writes** one small data file in `Interface\AddOns\BountyLine_Relay`.
- It **never** types, clicks or pastes into the game, and it never reads your game memory. It works the same way as the TradeSkillMaster and Raider.IO companion apps.
- It deletes only the QR screenshots it made for bounties. Your own screenshots and kill proofs are left alone.
- Kill claims are not relayed: the proof screenshot is on the hunter's PC, and they drop it into `#bounty-line` themselves.

## Before you start

1. You are an officer or admin in the Discord server (the role chosen in `/bl setup`).
2. You have the Bounty Line addon installed and working.
3. You have **Node.js 20 or newer**: get the LTS installer from <https://nodejs.org>. To check, open PowerShell and run `node --version`.
4. You have this repository on your PC (green **Code** button on GitHub → **Download ZIP**, then unzip; or `git clone`).

## Set it up (once)

1. In Discord, run `/bl relay action: enable`. The bot replies privately with a **relay setup code** that starts with `BLR1`. Click the spoiler to reveal it and copy it.
   - Treat it like a password. Anyone who has it can post bounties as a relay.
   - It is shown once. If you lose it, run the command again; the old one stops working.
2. Open PowerShell in the `relay` folder of this repository and run:

   ```powershell
   npm.cmd install
   npm.cmd start
   ```

3. Paste the setup code when asked.
4. If your game isn't in `C:\Program Files (x86)\World of Warcraft\_forever_`, type the folder when asked (the one that contains `Interface` and `Screenshots`).
5. The first time, it creates `Interface\AddOns\BountyLine_Relay`. **Restart WoW once** so the game sees the new folder. After that a `/reload` is enough.

## Every time you play

1. Start the relay: in the `relay` folder, run `npm.cmd start`. Leave the window open.
2. Start WoW (or `/reload` if it was already running). Bounty Line says "Relay: on" in chat when it sees the relay.
3. When the relay window says **Bounty Pack changed**, type `/reload` in game to load it. The relay is silent: it prints a new line only when the bounties change. The **Last checked** line at the bottom updates every minute, so you can see it's still running.
4. To stop, press Ctrl+C in the relay window.

## For guildies

- Nothing to install. Set a bounty as usual; if a relay officer is online, the popup says a relay picked it up and the poster shows up in `#bounty-board` within a minute.
- **Link your character once**: in game type `/bl link` and paste that code in `#bounty-line`. The relay needs it to know which Discord user owns the bounty. Until then the bot reminds you in `#bounty-line` and you paste the bounty code yourself.
- If nothing appears after a minute, paste the code from the popup as before. Pasting a code the relay already posted is harmless: the bot says it was already used.

## If something goes wrong

| What you see | What to do |
|---|---|
| "The Bounty Board refused the relay token" | Run `/bl relay action: enable` again, delete `relay\config.json`, start the relay again and paste the new code. |
| "Couldn't reach the Bounty Board" | Your internet or the bot is down. The relay keeps trying every minute. |
| "I can't find Interface\AddOns in there" | You typed the wrong game folder. It must contain `Interface` and `Screenshots`. |
| Game doesn't say "Relay: on" | Start the relay *before* logging in or `/reload`. The very first time, restart WoW completely. |
| "A relayed bounty was refused: …" | The reason is shown. The usual one is an unlinked character (see *For guildies*). |
| A "Screen Captured" message every time a guildie sets a bounty | That's the relay's QR screenshot. It's how the code leaves the game; it can't be silenced. |

## Turning it off

- Stop the program with Ctrl+C. Bounty Line notices the relay is gone at your next login or `/reload`.
- To make your setup code useless, run `/bl relay action: revoke` in Discord.
- To remove it completely, delete `Interface\AddOns\BountyLine_Relay` and the `relay\config.json` file.

## Where your setup code is kept

In `relay\config.json` on your PC, in plain text. The file is ignored by git, so it can't be committed by accident. Don't share it or screenshot it.
