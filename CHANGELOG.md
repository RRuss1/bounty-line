# Changelog

## v0.0.0 (2026-11-20): Phase 0, repo and codec

- BL1 code format ([Compendium 02](docs/compendium/02-Code-Format-Spec.md)): bounty (`B`), kill (`K`), link (`L`) and pack (`P`) codes, with compact GUIDs, zlib-compressed multi-part packs and CRC-16 checks.
- TypeScript reference codec (`worker/src/codec.ts`) and Lua port (`addon/BountyLine/Codec.lua`), both passing the frozen vectors in `shared/test-vectors.json`.
- CI: luacheck, Lua 5.1 + LuaJIT codec tests, Worker typecheck and tests.

### Deployer notes

- Nothing to deploy yet. The Worker arrives in Phase 1.
