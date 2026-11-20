# Contributing

Thanks for helping! A few ground rules:

- **Read the spec first:** [docs/Bounty-Line-Design-Spec.md](docs/Bounty-Line-Design-Spec.md).
  It's the source of truth.
- **Open a pull request** against `main`. CI must pass (luacheck, codec vectors, worker
  typecheck and tests).
- **Code format changes** ([Compendium 02](docs/compendium/02-Code-Format-Spec.md)) must
  update both `Codec.lua` and `worker/src/codec.ts` and keep every existing test vector
  passing. Vectors are frozen: codes that players already have must keep decoding.
- **Never commit secrets.** Tokens belong in `wrangler secret put`, `.dev.vars` (ignored)
  or GitHub Actions secrets.
- **Addon policy:** keep the addon free, readable (no obfuscation) and free of ads, per
  Blizzard's UI Add-On Development Policy.
- **Translations:** add strings to `addon/BountyLine/Locales/`.
