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
| `<T>` | One char: `B` bounty post, `K` kill claim, `P` bounty pack, `L` character link |
| `<PAYLOAD>` | Crockford Base32 of the payload bytes (Section 3) |
| `<CHECK>` | 4 Crockford Base32 chars = CRC-16/CCITT-FALSE (Section 4), left-padded |

**Regex (case-insensitive):**
```
BL1-[BKPL]-[0-9A-HJKMNP-TV-Z]+-[0-9A-HJKMNP-TV-Z]{4}
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

## 3. Payload layouts (schema 1)

Every payload starts with **`u8 schema`**. Schema `0` is invalid. For a **newer** schema than the reader knows, it reads the fields it knows and ignores trailing bytes (forward compatibility). For the schema it knows, trailing bytes are an error, so every code has exactly one valid form (needed for duplicate detection).

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

No victim name: the Worker already has it on the bounty (matched by `victimGUID`), and the proof stamp prints it separately. Leaving it out keeps K codes short for the stamp OCR.

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
