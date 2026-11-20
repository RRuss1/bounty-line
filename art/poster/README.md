# Wanted-poster art

The bot draws each bounty's wanted poster as a PNG and attaches it to the forum post, so it
becomes the card's cover in `#bounty-board` (design spec 8.2). This folder holds the blank
parchment it draws on.

## Files

| File | What it is |
|---|---|
| `parchment.png` | **The blank poster the bot uses** (1376 × 768, 700 KB, optimized 256-colour PNG). |
| `source/parchment-original.jpg` | Full-quality original of `parchment.png`. Re-export from this, not from the PNG |
| `layout-guide.svg` / `layout-guide.png` | Where the bot puts its text. Drawn for the first 1500 × 1000 draft; will be redrawn for the current parchment |
| `source/` | Originals and layered source files (`.psd`, `.kra`, `.xcf`, `.afphoto`…) |

## `parchment.png` spec

| | |
|---|---|
| Format | **PNG**, 8-bit RGB or RGBA, sRGB |
| Size | **About 16:9 landscape** (current art: 1376 × 768). The bot lays its text out relative to the image size |
| File size | **Under 1 MB** (it ships inside the Worker). Run it through a PNG optimizer if it's bigger |
| Transparency | Allowed in the outer 60 px edge band only (torn or burnt edges). Discord shows transparent areas on its dark card background |

## Layout (see `layout-guide.png`)

| Zone | Pixels (y) | Who draws it |
|---|---|---|
| Edge | outer 60 px | You: torn or burnt edges, frame |
| **Header** | 60–260 | **You**: painted "WANTED", a skull, guild crest, anything |
| Name | 280–400 | Bot: target name |
| Details | 420–740, left side | Bot: race/class/level/faction, **reward**, poster, zone |
| Stamp | 420–740, right side | Bot: OPEN / CLAIMED / PAID / EXPIRED stamp |
| Footer | 760–920 | Bot: bounty #, expiry, board tag |

Keep everything from y 280 to 920 **plain and light** (paper texture is fine, no pictures or
dark stains) so the bot's dark text stays readable. If your header already says WANTED, say so
and the bot won't print it again.

Discord crops gallery covers. The dashed blue (16:9) and green (4:3) boxes show the likely
crops; keep anything important inside both. Before painting, drag `layout-guide.png` into a
test post in `#bounty-board` and check what the card shows.

## Rules

- **Original or CC0/CC-BY art only.** Never Blizzard textures or screenshots (design spec 11.2),
  even ones that look like the in-game parchment.
- If you use a CC asset, credit it below and in the main README.

## Credits

- `parchment.png`: original AI-generated art by Rich Russell (Google Gemini / Nano Banana), released under the repo's MIT licence.
