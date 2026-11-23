# Bounty Line — Project Instructions

The full design lives in `docs/Bounty-Line-Design-Spec.md`. Read it before any work. It is the source of truth; if the code and the spec disagree, ask before changing either.

Build compendiums (also binding):
- `docs/compendium/01-Deployment-Architecture.md`: one Discord ↔ one Worker; config model; nothing deployment-specific committed
- `docs/compendium/02-Code-Format-Spec.md`: exact BL1 code format; TS codec is the reference
- `docs/compendium/03-Build-Phases.md`: phases, acceptance checks, prompts

`README.md` is user-facing (players + guild admins). Keep it in sync when behavior or setup steps change.

## What this is
- `addon/BountyLine/`: WoW: Forever addon (Lua). Interface 16001, `BountyLine_Forever.toc`.
- `worker/`: Cloudflare Worker (TypeScript): Discord bot, Gateway Durable Object, D1, R2, Workers AI, cron.
- `shared/test-vectors.json`: code samples that BOTH the Lua and TS codecs must decode identically.

## Hard rules
- **Never commit secrets.** Tokens go in `wrangler secret put`, `.dev.vars` (gitignored) or GitHub Actions secrets. The repo is PUBLIC.
- **Forever addon API = modern Midnight client with restrictions:**
  - No `COMBAT_LOG_EVENT_UNFILTERED` (forbidden). Kills come from `PARTY_KILL` + `CHAT_MSG_COMBAT_HONOR_GAIN`.
  - No realms: key players by GUID.
  - Addons can't make network requests or write to the clipboard (select text + Ctrl+C only).
  - Secret values may hide unit data in combat; degrade gracefully.
  - Addon comms (`SendAddonMessage`) are restricted during instance encounters; queue and flush.
- **Game rules:** opposite faction only, open world only (no battleground, arena or dungeon kills), no duels, killing blow only, reward 1g–10,000g (default), always typed by hand.
- **Costs:** Rich's bot is private (`ALLOWED_GUILD_IDS` allowlist checked FIRST, before any D1/R2/AI work). Other guilds self-host.
- Keep the addon free, unobfuscated and ad-free (Blizzard UI Add-On Development Policy).

## How to work
- Build in the phases in spec Section 22. Finish and test one phase before starting the next.
- Small commits with short, clean messages. **No `Co-Authored-By` or other AI attribution lines** in commits or PR descriptions.
- Branch protection is ON: work on a branch, open a PR, wait for CI (both jobs), rebase-merge. Merging changes under `worker/` auto-deploys the live bot.
- Track progress in `CHANGELOG.md` (one entry per phase, with Deployer notes). Tag each finished phase `v0.<phase>.0`.
- Live deployment config lives only in this repo's GitHub Actions Variables/Secrets and Worker secrets, never in files. Read it with `gh variable list`, `gh secret list` and `npx wrangler secret list --name bounty-board`. Setting secrets/variables is done by Rich: hand him the exact commands.
- When an API behavior on Forever is uncertain, add it to spec Section 23 instead of guessing, and add a `/bl debug` command to test it in game.
- Write the codec tests first (Lua + TS against `shared/test-vectors.json`).
