# Wanted-poster art

The bot draws each bounty's wanted poster as a PNG and attaches it to the forum post, so it
becomes the card's cover in `#bounty-board` (design spec 8.2). This folder holds the blank
parchment it draws on. The Worker bundles `parchment.png` directly
(`worker/src/poster-assets.ts`); the layout is in `worker/src/poster-image.ts`.

## Files

| File | What it is |
|---|---|
| `parchment.png` | **The blank poster the bot uses** (1376 × 768, 700 KB, optimized 256-colour PNG) |
| `source/parchment-original.jpg` | Full-quality original of `parchment.png`. Re-export from this, not from the PNG |
| `source/` | Originals and layered source files (`.psd`, `.kra`, `.xcf`, `.afphoto`…) |

## How it's shown

Discord crops gallery-card covers to **3:2**. The bot puts the 1376 × 768 parchment on a
1376 × 917 canvas with a dark band above and below, so the whole sheet, torn edges included,
fits the card. The forum's tag pill covers the bottom-left corner of the band.

The bot draws, top to bottom: **WANTED**, the target's name (shrunk to fit), race/class/level/
faction, **REWARD**, who pays, where it was marked, bounty # and expiry, and the board tag. A
red status stamp (OPEN / CLAIMED / PAID / EXPIRED) sits top right, clear of the wax seal and
blood spatter.

To see it: `cd worker && npm run poster-preview` writes `worker/poster-preview.png` (gitignored).
Add a name and reward to test long text: `npm run poster-preview -- "Very Long Name" 10000`.

## Replacing the parchment

| | |
|---|---|
| Format | **PNG**, 8-bit RGB or RGBA, sRGB |
| Size | **1376 × 768** (the layout is placed for this size and this sheet's seal position) |
| File size | **Under 1 MB** (it ships inside the Worker). Run it through a PNG optimizer if it's bigger |
| Text area | Keep the middle plain and light so dark text stays readable |

A different size or a moved seal needs a layout change in `poster-image.ts`. Preview before
committing.

## Rules

- **Original or CC0/CC-BY art only.** Never Blizzard textures or screenshots (design spec 11.2),
  even ones that look like the in-game parchment.
- If you use a CC asset, credit it below and in the main README.

## Credits

- `parchment.png`: original AI-generated art by Slac Jaw from RP-PVP (Google Gemini / Nano Banana), released under the repo's MIT licence.
- Fonts in `worker/assets/fonts/`: **Rye** (Sorkin Type Co) and **IM FELL English** (Igino Marini), both SIL Open Font License 1.1 (licence files alongside).
