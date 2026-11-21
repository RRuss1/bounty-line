# Compendium 03: Build Phases & Claude Code Playbook
### Phase-by-phase tasks, acceptance criteria and ready-to-paste prompts

Use with `CLAUDE.md`, the main spec, Compendium 01 (Deployment) and Compendium 02 (Code Format).
**Rule:** finish a phase, pass its acceptance checks, commit/tag, then start the next.

---

## Overview

| Phase | Goal | Ends with |
|---|---|---|
| 0 | Repo + codec | Public repo, codec passes shared vectors in Lua and TS |
| 1 | Worker skeleton | Deployed Worker answers `/bl ping`, allowlist enforced |
| 2 | Bounty posting | Paste a B code in #bounty-line → wanted poster in #bounty-board |
| 3 | Addon core | Right-click → Set Bounty… → amount box → code popup with copy button |
| 4 | Packs & kill flow | Pinned pack → `/bl import` → targets highlighted; real kill → stamp → screenshot → K code → officer approves in Discord |
| 5 | Guild sync & hunting UI | Guild-wide pack sync, banners, last-seen, in-game board |

> **Reordered 2026-11-21 (Rich):** pack generation, `/bl import` and target highlighting moved from Phase 5 into Phase 4, because a kill code needs the bounty number, which the addon only learns from the pack. Guild sync stays in Phase 5.
| 6 | Automation | AI proof check, trust, Paid/Received, leaderboard, cron jobs |
| 7 | Release pipeline | CurseForge beta via tag; "Deploy your own" docs + bootstrap workflow |
| 8 | Guild beta | Officers → guild → Release |

Tag each phase `v0.<phase>.0` (e.g. `v0.2.0`).

---

## Phase 0: Repo & codec

**Deliverables**
- Repo layout per spec Section 15 and Compendium 01 Section 4.1 (`.gitignore` includes `worker/wrangler.jsonc`, `worker/.deploy.env`, `worker/.dev.vars`, `.wrangler/`).
- Public GitHub repo `bounty-line` (MIT). Secret scanning + push protection on.
- `worker/src/codec.ts` (reference), `addon/BountyLine/Codec.lua`.
- `shared/test-vectors.json` per Compendium 02 Section 7.
- CI: `ci.yml` runs vitest + Lua tests + luacheck on every PR.

**Acceptance**
- [ ] TS and Lua both pass all vectors (round-trip identical strings).
- [ ] CRC check value `123456789 → 29B1`.
- [ ] Normalization cases pass (backticks, whitespace, lowercase, O/I/L aliases).
- [ ] CI green on GitHub.

**Prompt**
> Read CLAUDE.md, docs/Bounty-Line-Design-Spec.md and docs/compendium/*. Do Phase 0 from Compendium 03. Create the repo structure, init git, create the public GitHub repo `bounty-line` with gh (MIT). Implement the TS reference codec first per Compendium 02, generate and freeze test vectors, then implement Codec.lua to pass the same vectors in plain Lua 5.1 with a `bit` shim. Add ci.yml. Show me the test output before committing.

---

## Phase 1: Worker skeleton

**Deliverables**
- `wrangler.template.jsonc` + `scripts/render-config.ts` (Compendium 01 Section 3.1).
- `migrations/0001_init.sql` (spec Section 12, all tables with `tenant_id`).
- `src/index.ts`: `/health`, `/interactions` with Ed25519 verification, **allowlist check first**.
- Slash commands: `/bl ping`, `/bl version`, `/bl setup` (channels, officer role, guild name, generates board tag), `/bl status`.
- `scripts/register-commands.ts`.
- `worker-deploy.yml`: render config → migrations → deploy; **skips if vars missing**.

**Acceptance**
- [ ] `GET /health` returns version + db ok.
- [ ] Discord portal accepts the Interactions Endpoint URL.
- [ ] `/bl ping` works in your server.
- [ ] Interaction from a non-allowlisted server is rejected before any DB call (unit test).
- [ ] `/bl setup` stores settings in D1 and replies with the board tag.
- [ ] No IDs or secrets in committed files (`git grep` for your server ID returns nothing).

**Prompt**
> Do Phase 1 from Compendium 03. Follow Compendium 01's config model exactly: template + render script, nothing deployment-specific committed. Walk me through creating D1, R2, the Discord app and secrets step by step, pausing for me to run each command. I'll provide IDs; I'll enter tokens myself with wrangler secret put.

---

## Phase 2: Bounty posting (chat reading)

**Deliverables**
- `src/gateway.ts`: `GatewayDO` (identify with GUILDS + GUILD_MESSAGES + MESSAGE_CONTENT intents, heartbeat, resume, reconnect).
- Cron `*/1` heartbeat → DO keep-alive/reconnect.
- Message handler for `#bounty-line`: extract codes → decode → validate → **B** creates forum thread with wanted-poster embed, forum tags, ✅ reaction.
- `/bl submit code:` fallback (same pipeline).
- Budget mode: `READ_CHAT=false` disables the DO entirely.
- Error replies per Compendium 02 Section 8, auto-deleted after 60s.

**Acceptance**
- [ ] Paste a test B code (generate with a TS script) → poster appears with the right tag.
- [ ] Same-faction B code rejected with the FACTION message.
- [ ] Reward 0g and 10,001g rejected; 1g accepted.
- [ ] Kill the DO (redeploy) → reconnects within 2 minutes.
- [ ] Normal chat in #bounty-line is ignored.

**Prompt**
> Do Phase 2 from Compendium 03. Implement the Gateway Durable Object and the #bounty-line message pipeline for B codes, plus /bl submit as the fallback. Include a dev script that generates valid test B codes so I can test before the addon exists.

---

## Phase 3: Addon core (posting from the game)

**Deliverables**
- `BountyLine_Forever.toc` (Interface 16001) + fallback `.toc`.
- Core, SavedVariables, slash commands (`/bl`, `/bl mark`, `/bl last`, `/bl debug`, `/bl debugmenu`).
- Right-click menu via `Menu.ModifyMenu` (spec 5.4b): **Set Bounty…** opens the **amount entry box** (always typed; 1–10,000g default).
- Opposite-faction gate; target snapshot at box open.
- Code popup with **[⧉] copy button**, read-only box, "✔ Selected! Press Ctrl+C" (spec 5.7b).
- `/bl link` → L code popup.

**In-game tests**
- [ ] `/bl debugmenu` prints the menu tags on Forever; confirm which ones fire for enemy players.
- [ ] Right-click same-faction player: no Bounty Line section.
- [ ] Right-click opposite-faction player: section present; entering 1 → code popup.
- [ ] Copy button selects all; Ctrl+C → paste into Discord → poster created (end-to-end with Phase 2).
- [ ] Typing in the code box doesn't change it.
- [ ] Combat: menu behavior noted (works / disabled with tooltip). Record the result in spec Section 23.

**Prompt**
> Do Phase 3 from Compendium 03. Build the addon core for WoW: Forever (Interface 16001, modern Menu API, Midnight restrictions). Include /bl debug and /bl debugmenu so I can verify API behavior in game. Give me a test checklist I can run on my character.

---

## Phase 4: Packs & the kill

**Deliverables**
- Worker: generate **P** packs (deflate, multi-part when needed), keep a pinned pack message updated on every change, `/bl pack`.
- Addon: `/bl import` (multi-part aware, accepts the whole pinned message), `/bl list`; highlighting: nameplate skull, tooltip WANTED line, first-sighting alert + sound; "View Bounty" in the right-click menu.
- `Kills.lua`: `PARTY_KILL` handling (you or your pet), honor-gain corroboration, **duel guard**, **faction guard**.
- Proof stamp frame (spec 9.2) → `Screenshot()` → `SCREENSHOT_SUCCEEDED/FAILED` handling.
- Kill popup with copy button + screenshot folder hint; `/bl last`; `/bl test` (simulated kill).
- Worker: **K** handling: image required, store to R2, image hash, duplicate checks, post proof in the bounty thread with **Approve/Deny** (officer role only).
- `/bl link` handling (L codes) so kills map to Discord users.

**In-game tests**
- [ ] `/bl import` the pinned pack → `/bl list` shows the open bounties; a bounty target shows the skull and WANTED tooltip.
- [ ] `/bl test` → stamp → screenshot file appears → popup.
- [ ] Real kill on an opposite-faction bounty target (1g test bounty) → full flow → officer approves.
- [ ] Duel the same target and "win" → nothing happens.
- [ ] Assist (someone else lands the killing blow) → no code.
- [ ] K code without image → NO_IMAGE reply.
- [ ] Same K code twice → DUPLICATE.

**Prompt**
> Do Phase 4 from Compendium 03: kill detection with duel and faction guards, proof stamp, auto-screenshot, kill popup, and the Worker side for K codes with R2 storage and officer Approve/Deny. Keep the stamp readable for OCR later (plain font, dark backing, full code shown).

---

## Phase 5: Guild sync, hunting UI

**Deliverables**
- Addon: **guild sync** of the imported pack via AceComm (`HELLO`/`PACK`/`NEWB`/`SEEN`/`KILL`), newest pack wins, outgoing queue when comms are restricted.
- Last-seen sharing; nameplate glow (the skull and tooltip shipped in Phase 4).
- Banners: new bounty ("…go check the {name} Bounty Board!"), bounty collected.
- In-game board window (`/bl`).
- Optional "Announce to Guild" button (test whether allowed; remove if blocked).

**Acceptance**
- [ ] One player imports → a second online guildie gets the pack automatically.
- [ ] Late login receives the newest pack via HELLO.
- [ ] Bounty target nameplate shows skull/glow; tooltip shows WANTED.
- [ ] Banners appear for all online guildies with the addon.
- [ ] Out-of-date addon shows the update warning (raise `minAddonVersion` in a test pack).

**Prompt**
> Do Phase 5 from Compendium 03: Bounty Pack generation and pinning on the Worker, pack import and guild sync in the addon (AceComm), target highlighting, banners and the in-game board window. Test with two characters in the guild if possible.

---

## Phase 6: Automation & polish

> Split for delivery (2026-11-21): **6a** = AI check, verdicts and trust, leaderboard / me / cancel, expiry + weekly recap crons. **6b** = stacking, `/bl config`, `/bl forget-me`, R2 lifecycle. (Paid / Received shipped early, in Phase 4.)

**Deliverables**
- Workers AI stamp reader (vision model) → structured fields → compare to code; `AI_DAILY_CAP`; checks recorded in `kills.checks_json`.
- Verdicts: auto-approve / officer review per `auto_approve` setting and trust levels.
- Paid / Received buttons; PAID stamp; thread archive.
- Leaderboard (`/bl leaderboard`, `/bl me`), weekly recap cron, expiry sweep cron, unpaid nudges.
- Stacking ("Add to Bounty…").
- R2 lifecycle rule; `/bl forget-me`.

**Acceptance**
- [ ] 10 sample screenshots (clean, cropped, dark, wrong code) → expected verdicts.
- [ ] AI cap reached → falls back to officer review.
- [ ] Trusted hunter's clean claim auto-approves.
- [ ] Expired bounties move to Expired tag on schedule.

---

## Phase 7: Release pipeline & "Deploy your own"

**Deliverables**
- CurseForge project created (spec Section 19); `X-Curse-Project-ID` in TOC; `CF_API_TOKEN` secret.
- `addon-release.yml` with BigWigs packager; tags `v*-beta*` → Beta, `v*` → Release.
- `bootstrap.yml` (manual): create D1/R2 if missing, migrate, deploy, register commands. Works in any fork. ✅ Built 2026-11-21 with a dry-run mode and plain-English fixes for every check (`worker/scripts/bootstrap.ts`, `docs/deploy-your-own.md`).
- README: features, GIF, install, **Deploy your own Bounty Board** (Compendium 01 Section 9), compatibility matrix, privacy.
- CHANGELOG with "Deployer notes."

**Acceptance**
- [ ] `git tag v0.7.0-beta1 && git push --tags` → file on CurseForge (Under Review → Beta).
- [ ] A **second test Discord server + a second Cloudflare account** (or a friend's) deploys from a fork using only the README. This is the real proof that other guilds can tie their own Worker to their own Discord.

---

## Phase 8: Guild beta → release

Follow spec Section 20. Track bugs as GitHub Issues with labels `addon`, `worker`, `forever-api`, `ux`. Promote to `v1.0.0` once a week passes with no blocker issues.

---

## Working agreements for Claude Code sessions

- Start every session: *"Read CLAUDE.md and the compendiums. We're on Phase N."*
- Ask Claude Code to **list the files it will touch** before big changes.
- Anything uncertain about Forever's API → `/bl debug` tool + spec Section 23 entry, not a guess.
- Never paste tokens into the chat. Use `wrangler secret put` and GitHub secrets.
- End every phase with: tests green → commit → tag → short note in CHANGELOG.
