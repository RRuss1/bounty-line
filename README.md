# Bounty Line

Guild PvP bounties for **WoW: Forever**: an in-game addon plus a Discord **Bounty Board**.

Put a bounty on an enemy player, and your guildmates see the target highlighted in the
world. When someone lands the killing blow, the addon screenshots the kill with a proof
stamp and gives them a short code. They paste that code into Discord, and the bot posts
the proof to the bounty's wanted poster. Rewards are real gold, paid player to player on
the honor system.

> **Status:** early development (Phase 0: repo + code format). Not playable yet.

## How it fits together

| Part | Where | What it does |
|---|---|---|
| **Bounty Line** addon | `addon/BountyLine/` | Marks targets, highlights them, detects kills, makes codes |
| **Bounty Board** bot | `worker/` | Cloudflare Worker: reads codes in Discord, wanted posters, proof checks |
| Code format | `shared/CODEC.md` | The `BL1-…` codes that carry data between game and Discord |

The addon never talks to the internet. All data moves by copy/paste of codes plus one
screenshot dragged into Discord.

## Development

```bash
# Codec tests: both implementations against shared/test-vectors.json
luajit addon/tests/run.lua          # any Lua 5.1-compatible interpreter
cd worker && npm install && npm test
```

The full design is in [docs/Bounty-Line-Design-Spec.md](docs/Bounty-Line-Design-Spec.md).

## Deploy your own Bounty Board

Every guild runs its own copy of the bot on its own Cloudflare account and its own
Discord app. A step-by-step guide will be added here before v1.0.

## License

[MIT](LICENSE). The addon is free, unobfuscated and ad-free, per Blizzard's UI Add-On
Development Policy.
