# Compendium 02: Code Format Specification (BL1)
### The exact wire format shared by the addon (Lua) and the Worker (TypeScript)

The addon and the Worker are written in different languages and never talk directly. **This document is the contract between them.** Both implementations must pass `shared/test-vectors.json`.

---

## 1. String format

```
BL1-<T>-<PAYLOAD>-<CHECK>
```

| Part | Definition |
|---|---|
| `BL1` | Magic + format generation. Literal. |
| `<T>` | One char: `B` bounty post, `K` kill claim, `P` bounty pack, `L` character link, `S` Open Season, `W` sightings |
| `<PAYLOAD>` | Crockford Base32 of the payload bytes (Section 3) |
| `<CHECK>` | 4 Crockford Base32 chars = CRC-16/CCITT-FALSE (Section 4), left-padded |

**Regex (case-insensitive):**
```
BL1-[BKPLSW]-[0-9A-HJKMNP-TV-Z]+-[0-9A-HJKMNP-TV-Z]{4}
```

### 1.1 Normalization before decoding (both sides)
1. Trim whitespace; remove all internal whitespace and line breaks (Discord may wrap long codes).
2. Remove backticks (Discord code formatting). All of them: a backtick is never part of a code.
3. Uppercase.
4. In PAYLOAD and CHECK only: map `O`→`0`, `I`→`1`, `L`→`1`. (Crockford aliases.)

### 1.2 Multi-part codes (packs only)
Discord messages max out at 2,000 characters (4,096 in an embed description). Packs that exceed **3,800** characters are split:
```
BL1-P-<part>of<total>-<PAYLOAD_CHUNK>-<CHECK_OF_CHUNK>
```
e.g. `BL1-P-1of3-....-ABCD` (canonical form `1OF3`; the CRC covers `BL1-P-1OF3-<chunk>`). `total` is 2–8 and `part` ≤ `total`, with no leading zeros. The addon's import box accepts parts pasted one after another (in any order, duplicates fine), shows "2 of 3 parts received," and decodes when complete. The full payload is the concatenation of the chunk texts in part order, then Base32-decoded. The zlib Adler-32 (Section 3.3) catches parts mixed from two different packs.

---

## 2. Primitive types

All multi-byte integers are **big-endian, unsigned**.

| Type | Bytes | Notes |
|---|---|---|
| `u8` | 1 | |
| `u16` | 2 | |
| `u32` | 4 | Unix seconds fit until 2106 |
| `str4` | 4 | Fixed ASCII, e.g. board tag. `"0000"` = none |
| `vstr` | 1 + n | `u8` length then UTF-8 bytes. Max 255 bytes. Writers truncate on a UTF-8 boundary |
| `guid` | 7, or 2 + n | `u8` form. **Form 0 (compact):** `u16` serverID + `u32` low, meaning `Player-<serverID>-<8 uppercase hex>`. **Form 1 (raw):** `u8` length + UTF-8 bytes, for any other shape. Writers use form 0 **iff** the GUID round-trips exactly (decimal serverID ≤ 65535 with no leading zeros, exactly 8 uppercase hex digits); readers reject a form-1 GUID that could have been form 0, an empty GUID, and any other form byte. GUIDs are **never truncated**: a GUID over 255 bytes is a writer error |

Enums:

| Field | Values |
|---|---|
| faction | `1` Alliance, `2` Horde (anything else = invalid) |
| classID / raceID | Blizzard numeric IDs (`UnitClassBase` / `UnitRace` third return) |
| mapID | `C_Map.GetBestMapForUnit("player")` |

---

## 3. Payload layouts

Every payload starts with **`u8 schema`**. Schema `0` is invalid. For a **newer** schema than the reader knows, it reads the fields it knows and ignores trailing bytes (forward compatibility). For a schema it knows, trailing bytes are an error, so every code has exactly one valid form (needed for duplicate detection).

**Schemas are per code type.** `L` and `W` have schema 1. `B` and `S` have schemas 1 and 2; `K` and `P` have schemas 1, 2 and 3. A later schema is the one before with fields appended (Open Season: K2, P2, S2; bounty terms: B2, K3, P3). A writer uses the lowest schema that holds what it needs, so codes for ordinary bounties are unchanged and older addons keep reading packs.

### 3.1 `B`: bounty post (addon → Discord)
| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | targetGUID | guid |
| 4 | targetName | vstr |
| 5 | targetClassID | u8 |
| 6 | targetRaceID | u8 |
| 7 | targetLevel | u8 |
| 8 | targetFaction | u8 |
| 9 | posterFaction | u8 |
| 10 | rewardGold | u32 |
| 11 | posterGUID | guid |
| 12 | posterName | vstr |
| 13 | mapID | u16 |
| 14 | createdAt | u32 |
| 15 | nonce | u16 |
| 16 | note | vstr (≤ 80 bytes) |
| 17 | mode | u8: `0` new bounty, `1` add to existing |
| 18 | existingBountyId | u32 (0 when mode=0) |

**Schema 2 (bounty terms, design spec 5.4c)** appends:
| # | Field | Type |
|---|---|---|
| 19 | kills | u8: 1 to 10, how many kills the reward buys |
| 20 | payout | u8: `0` each kill pays its share, `1` one hunter must land every kill (needs kills ≥ 2) |
| 21 | days | u8: `0` the server's default length, or `7`, `14`, `28` |
| 22 | terms | `u16` count (≤ 8), then that many: kind u8, value u16, gold u32 |

Term kinds (each at most once). Bonuses (gold ≥ 1, extra gold on top):
| Kind | Bonus | value |
|---|---|---|
| 1 | killed in a zone | mapID ≥ 1 |
| 2 | the hunter is of a class | classID 1–30 |
| 3 | the hunter is not in a group | 0 |
| 4 | the hunter is a lower level than the target | 0 |
| 5 | killed within N hours of the bounty | 1–168 |
| 6 | the hunter `/lol`s within 10 seconds of the kill | 0 |

Restrictions (gold = 0; a kill that breaks one doesn't count): `65` only in a zone (mapID), `66` only a class (classID), `67` solo only (0).

Schema 2 is only for a new bounty (`mode = 0`); Add to Bounty is always schema 1. Writers use schema 2 only when something is set (more than one kill, any term, or a length).

**Writer validation (addon):** targetFaction ≠ posterFaction, both ∈ {1,2}; `reward_min ≤ rewardGold ≤ reward_max`.
**Reader validation (Worker):** same, plus tenant reward limits, plus target not already `paid`.

### 3.2 `K`: kill claim (addon → Discord)
| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | bountyId | u32 |
| 4 | victimGUID | guid |
| 5 | killerGUID | guid |
| 6 | killerName | vstr |
| 7 | killerFaction | u8 |
| 8 | killedAt | u32 |
| 9 | mapID | u16 |
| 10 | flags | u8: bit0 honorCorroborated, bit1 petKill |
| 11 | nonce | u16 |

**`bountyId = 0`** means "the bounty on `victimGUID`": the hunter's addon learned of the bounty from guild sync before any pack gave it a number (design spec 5.8, pending bounties). The Worker then looks up the open bounty by victim. No layout change; schema stays 1.

No victim name: the Worker already has it on the bounty (matched by `victimGUID`), and the proof stamp prints it separately. Leaving it out keeps K codes short for the stamp OCR.

**Schema 2 (Open Season kill)** appends:
| # | Field | Type |
|---|---|---|
| 12 | seasonId | u32: the Open Season the victim's guild is under; `0` = none matched |
| 13 | victimName | vstr: the Worker has no bounty row to take it from |
| 14 | guildName | vstr: the victim's guild as the addon saw it, `""` if never seen. The Worker finds the open season by it, so a kill made before the season had a number (declared moments ago) or with an old number still lands on the right season |
| 15 | guildSeen | u8: `1` the addon saw the victim in that guild; `0` guild unknown (officer review) |

`bountyId` and `seasonId` may both be set: the victim has a personal bounty and is in a guild under Open Season, and one code claims both.

**Schema 3 (a kill on a bounty with terms)** appends, after the schema 2 fields:
| # | Field | Type |
|---|---|---|
| 16 | killerClassID | u8 (`0` unknown) |
| 17 | killerLevel | u8 (`0` unknown) |
| 18 | victimLevel | u8 (`0` unknown: the victim wasn't the target, mouseover or focus) |
| 19 | facts | u8: bit0 not in a group, bit1 `/lol` within 10 seconds of the kill; other bits must be 0 |

The addon writes schema 3 for a bounty whose pack entry has terms, and for a bounty set by name (design spec 5.12), with the victim's name in `victimName` so the Worker can match it. With no Open Season the schema 2 fields are `seasonId = 0`, `victimName = ""`, `guildName = ""`, `guildSeen = 0`; the Worker treats a schema 3 code with no season number, no guild and a bounty number as a plain bounty claim. Both `0` with `guildSeen = 0` is a kill of an enemy whose guild the addon never saw while a season was open.

### 3.3 `P`: bounty pack (Discord → addon)
The payload bytes below are **zlib-compressed** before Base32: 2-byte zlib header (`78 DA`), raw DEFLATE, then the big-endian **Adler-32** of the uncompressed bytes. Readers verify the header (CM=8, FCHECK, no preset dictionary) and the Adler-32. Worker: `fflate` (pinned version); addon: LibDeflate `DecompressDeflate`. Only the Worker writes packs.

| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | packVersion | u32 (unix seconds when generated) |
| 4 | minAddonVersion | u16 (`major*1000 + minor`) |
| 5 | discordDisplayName | vstr |
| 6 | rewardMin | u32 |
| 7 | rewardMax | u32 |
| 8 | count | u16 |
| 9… | entries × count | see below |

Pack entry:
| Field | Type |
|---|---|
| bountyId | u32 |
| targetGUID | guid |
| targetName | vstr |
| targetClassID | u8 |
| targetFaction | u8 |
| rewardGold | u32 (stacked total) |
| posterName | vstr |
| expiresAt | u32 |

**Schema 2** appends, after the entries, a `u16` count and that many Open Season entries. The Worker writes schema 2 only when at least one season is open.

**Schema 3** appends, after the seasons (an empty list when none), a `u16` count and that many bounty terms entries: bountyId u32, kills u8, killsLeft u8 (each-kill bounties: kills not yet approved; all or nothing: the whole count), payout u8, terms (as in B schema 2). Only bounties with terms are listed. The Worker writes schema 3 only when at least one open bounty has terms.

**Schema 4** appends, after the bounty terms (an empty list when none), a `u16` count and that many **wanted-by-name** entries (design spec 5.12): bounties set from Discord with `/bl wanted`, known only by name until a kill locks them to a GUID. They are not in the main list (they have no GUID). The Worker writes schema 4 only when at least one is open.

| Field | Type |
|---|---|
| bountyId | u32 |
| targetName | vstr (full name as typed, "First Surname") |
| targetFaction | u8 |
| rewardGold | u32 |
| posterName | vstr |
| expiresAt | u32 |
| Field | Type |
|---|---|
| seasonId | u32 |
| guildName | vstr |
| guildFaction | u8 |
| kind | u8 (Section 3.5) |
| perKillGold | u32 (`0` for a prize pool) |
| remainingGold | u32: pot left (kind 1), the pool (kind 2), `0` (kind 3) |
| posterName | vstr |
| expiresAt | u32 |

### 3.4 `L`: character link (addon → Discord)
Links a Discord user to a WoW character. Pasted once with `/bl link`.
| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | charGUID | guid |
| 4 | charName | vstr |
| 5 | faction | u8 |
| 6 | guildName | vstr |
| 7 | createdAt | u32 |
| 8 | nonce | u16 |

### 3.5 `S`: Open Season (addon → Discord)
Declares a bounty on every member of an enemy guild, or adds gold to one (design spec 5.11).
| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | guildName | vstr (not empty) |
| 4 | guildFaction | u8 |
| 5 | posterFaction | u8 |
| 6 | kind | u8: `1` per head + pot, `2` prize pool, `3` per head with no ceiling |
| 7 | perKillGold | u32 |
| 8 | totalGold | u32 |
| 9 | days | u8: `7`, `14` or `28` |
| 10 | posterGUID | guid |
| 11 | posterName | vstr |
| 12 | createdAt | u32 |
| 13 | nonce | u16 |
| 14 | mode | u8: `0` new season, `1` add gold to an existing one |
| 15 | existingSeasonId | u32 (0 when mode=0) |

**Schema 2** appends `minKills` (u16): a prize pool (kind 2) pays out only if the season reaches that many approved kills in total, so one lucky kill can't take the whole pool. It must be ≥ 1 for a prize pool and `0` for every other kind and for adding gold. Writers use schema 2 only when `minKills` is set; schema 1 codes mean "no minimum".

**Validation (both sides):** guildFaction ≠ posterFaction. For `mode = 0`: kind 1 needs `perKillGold ≥ 1` and `totalGold ≥ perKillGold`; kind 2 needs `perKillGold = 0` and `totalGold ≥ 1`; kind 3 needs `perKillGold ≥ 1` and `totalGold = 0`. For `mode = 1`: `kind`, `perKillGold` and `days` are `0`, `totalGold ≥ 1` is the gold added, and `existingSeasonId ≠ 0`. The Worker also applies the tenant reward limits to `perKillGold` and `totalGold`.

### 3.6 `W`: sightings (addon → relay → Worker)
The latest sightings of wanted players, for "last seen" on the wanted posters (design spec 5.10). Only a relay officer's addon writes them, as a QR screenshot the relay program reads; players never paste them, and the bot ignores one pasted in chat.
| # | Field | Type |
|---|---|---|
| 1 | schema (=1) | u8 |
| 2 | boardTag | str4 |
| 3 | sentAt | u32 |
| 4 | nonce | u16 |
| 5 | sightings | `u16` count, then that many entries |

Sighting entry:
| Field | Type |
|---|---|
| bountyId | u32 (≠ 0: only numbered bounties) |
| mapID | u16 (`0` = unknown) |
| seenAt | u32 |
| spotterName | vstr (`""` = unknown) |

**Validation (both sides):** 1 to 8 sightings, no `bountyId` of 0. The addon puts the newest first and stops adding once the code would pass ~170 characters (a QR code that size reads reliably from a screenshot); the rest wait for the next report. **Worker:** the board tag must be the tenant's; a `seenAt` ahead of the Worker's clock counts as now; sightings over 6 hours old are dropped; only open or under-review bounties of that tenant take them, and only if newer than the one stored.

---

## 4. Checksum

- Algorithm: **CRC-16/CCITT-FALSE** (poly `0x1021`, init `0xFFFF`, no reflection, xorout `0x0000`).
- Input: the ASCII bytes of the normalized string **up to but not including** the final `-` (i.e. `BL1-T-PAYLOAD`).
- Output: 16-bit value → Base32 (5-bit groups, MSB first, 20 bits with 4 leading zero bits) → exactly 4 chars.
- Check value for test: CRC of ASCII `"123456789"` = `0x29B1`.

---

## 5. Crockford Base32

- Alphabet: `0123456789ABCDEFGHJKMNPQRSTVWXYZ`
- Encode: process bytes MSB-first in 5-bit groups; pad the final group with zero bits; **no `=` padding**.
- Decode: reverse; discard leftover bits (< 8) at the end. They must be zero, otherwise reject.
- Lua note: implemented with plain arithmetic (`math.floor`, `%`) instead of the `bit` library, so the same code runs in WoW, stock Lua 5.1 and LuaJIT without a shim.

---

## 6. Limits

| Item | Limit |
|---|---|
| B code length | ~120 chars typical (more with a note) |
| K code length | ~90–100 chars typical; ~150 if GUIDs fall back to raw form |
| W code length | ≤ ~170 chars as the addon writes them (63 for one sighting) |
| P code inline | ≤ 3,800 chars, else multi-part (max 8 parts) |
| Decompressed pack | ≤ 256 KB (deflate-bomb guard) |
| Addon EditBox | `SetMaxLetters(0)` (unlimited) on import box |
| Note | 80 bytes |
| Names | 255 bytes (truncate on UTF-8 boundary) |

---

## 7. Test vectors (`shared/test-vectors.json`)

Structure:
```json
{
  "crc16": [{ "input": "123456789", "crc": "29B1" }],
  "base32": [
    { "hex": "", "b32": "" },
    { "hex": "00", "b32": "00" },
    { "hex": "FF", "b32": "ZW" },
    { "hex": "48656C6C6F", "b32": "91JPRV3F" }
  ],
  "codes": [
    {
      "name": "B basic",
      "type": "B",
      "fields": { "schema": 1, "boardTag": "K7QF", "targetGUID": "Player-0000-0A1B2C3D",
                  "targetName": "Grimlok Ashveil", "targetClassID": 1, "targetRaceID": 2,
                  "targetLevel": 42, "targetFaction": 2, "posterFaction": 1, "rewardGold": 500,
                  "posterGUID": "Player-0000-00FFEE11", "posterName": "Slac Jaw",
                  "mapID": 1434, "createdAt": 1795200000, "nonce": 4242, "note": "",
                  "mode": 0, "existingBountyId": 0 },
      "code": "<generated once by the TS reference implementation, then frozen>"
    }
  ],
  "invalid": [
    { "name": "bad checksum", "code": "<valid code with last char changed>", "error": "CHECKSUM" },
    { "name": "truncated", "code": "<valid code missing 5 middle chars>", "error": "CHECKSUM" },
    { "name": "same faction B", "code": "<B with target=poster faction>", "error": "FACTION" },
    { "name": "unknown type", "code": "BL1-X-00-0000", "error": "TYPE" }
  ],
  "normalization": [
    { "input": "  `bl1-k-...-4r7d`  ", "normalized": "BL1-K-...-4R7D" }
  ]
}
```

**Process:** the TypeScript implementation is the **reference**. It generates the `code` values once; they are committed and frozen. The Lua implementation must then decode every vector to identical fields and re-encode to the identical string. Run both in CI:
- TS: `vitest`
- Lua: `addon/tests/run.lua` on stock Lua 5.1 and LuaJIT (loads LibStub → LibDeflate → Codec in TOC order, like the client)

Packs are decode-only in Lua; their frozen codes are byte-exact only for the pinned `fflate` version. The actual file also has `adler32`, `forwardCompat`, `packs` (multi-part cases) and `encodeErrors` sections.

`forwardCompat` holds codes from a schema newer than any shipped one. When `K` schema 2 became real (Open Season), its entry moved from a made-up "K schema 2" to "K schema 3"; when K and P schema 3 became real (bounty terms), the entries moved to schema 4, and a B schema 3 entry was added; when P schema 4 became real (bounties by name), the P entry moved to schema 5. No shipped code changed meaning: no addon ever wrote those schemas before.

The Base32 vectors above other than the empty and single-byte cases should be double-checked by the reference implementation before freezing.

---

## 8. Error messages (shown to players by the bot)

| Error | Bot reply |
|---|---|
| CHECKSUM | "That code looks cut off or changed. Copy it again in game with `/bl last`." |
| TYPE / VERSION | "I don't recognize that code. Is your Bounty Line addon up to date?" |
| BOARD | "That code belongs to a different Bounty Board." |
| FACTION | "Bounties must be on the opposite faction." |
| LIMITS | "Reward must be between {min}g and {max}g." |
| NO_IMAGE | "Kill codes need your screenshot attached in the same message." |
| DUPLICATE | "That code was already used." |
| EXPIRED / CLOSED | "Bounty #{id} is no longer open." |
| SELF | "You can't claim your own bounty." |
