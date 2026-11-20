# BL1 code format

The wire format for Bounty Line codes (design spec Section 6). There are two
implementations, and both must pass `shared/test-vectors.json`:

- Lua: `addon/BountyLine/Codec.lua`, tested by `luajit addon/tests/run.lua`
- TypeScript: `worker/src/codec.ts`, tested by `npm test` in `worker/`

## Text form

```
BL1-<TYPE>-<PAYLOAD>-<CHECK>
```

| Part | Content |
|---|---|
| `BL1` | Format version 1 |
| `TYPE` | `B` bounty post, `K` kill claim, `P` bounty pack |
| `PAYLOAD` | Binary payload (below) in Crockford base32 |
| `CHECK` | CRC-16 as 4 base32 chars |

**Alphabet:** `0123456789ABCDEFGHJKMNPQRSTVWXYZ` (Crockford, no I/L/O/U).

**Base32 packing:** bytes are read as one big-endian bit stream, 5 bits per
character. The last character is zero-padded. There are no `=` pad characters.
A length that can't come from whole bytes, or non-zero pad bits, is rejected,
so every byte string has exactly one text form.

**Checksum:** CRC-16/CCITT-FALSE (poly `0x1021`, init `0xFFFF`, no reflection,
no final XOR; check value of `"123456789"` is `0x29B1`), computed over the
ASCII text `BL1-<TYPE>-<PAYLOAD>` in canonical form. The 16-bit value is
written as 4 base32 digits, most significant first (the first digit is always
`0` or `1`).

## Decoding order

Both implementations check in this order and return the first error:

1. Remove ASCII whitespace (space, tab, CR, LF, VT, FF) and uppercase ASCII
   letters. Nothing else is normalized.
2. Must match `^BL[0-9]+-`, else **format**. The digits must be `1`, else **version**.
3. The rest splits on `-` into exactly 3 parts, else **format**.
4. Type must be `B`, `K` or `P`, else **type**.
5. Payload must be non-empty and check exactly 4 chars, else **format**.
6. In payload and check, map `I`/`L` to `1` and `O` to `0`. Any other character
   outside the alphabet is **format**.
7. Recompute the CRC. A mismatch is **checksum**.
8. Base32-decode: a bad length or pad bits is **format**.
9. Parse the payload by schema. Any problem, including trailing bytes, is **payload**.

The decoder returns the **canonical code** (uppercase, Crockford typos fixed,
whitespace removed). The decoder is strict (minimal varints, canonical GUIDs,
zero pad bits), so re-encoding decoded data always gives back the canonical
code. The bot can store the canonical code for duplicate detection.

## Payload primitives

| Kind | Encoding |
|---|---|
| `uint` | Unsigned LEB128 varint, 0 to 2^32−1, at most 5 bytes, minimal (no trailing `0x80 0x00`) |
| `u16` | 2 bytes, big-endian |
| `str` | `uint` byte length (max 255), then that many bytes of well-formed UTF-8 (Unicode Table 3-7: no overlongs, no surrogates, max U+10FFFF) |
| `tag` | `str` that is empty or exactly 4 alphabet characters (board tag) |
| `faction` | 1 byte: `0` = Alliance, `1` = Horde. Anything else is rejected |
| `bool` | 1 byte: `0` or `1` |
| `guid` | 1 tag byte. `0` = compact: `uint` server id + 4-byte big-endian low part, which decodes to `Player-<serverId>-<8 uppercase hex>`. `1` = raw: `str`. A GUID is compact **iff** it round-trips exactly (decimal id without leading zeros, ≤ 2^32−1, exactly 8 uppercase hex digits). A raw GUID that could have been compact is rejected |
| `list` | `uint` count, then that many records |

## Schemas

Fields appear in this order with no field tags. Adding, removing or reordering
fields needs a new format version (`BL2`), because old codes must keep decoding.

**B: bounty post** (addon → Discord)

| # | Field | Kind | Notes |
|---|---|---|---|
| 1 | boardTag | tag | `""` until a pack has been imported |
| 2 | targetGuid | guid | |
| 3 | targetName | str | first + surname |
| 4 | classId | uint | `UnitClass` class ID |
| 5 | raceId | uint | `UnitRace` race ID |
| 6 | level | uint | |
| 7 | targetFaction | faction | |
| 8 | reward | uint | whole gold; min/max limits are enforced by the rules, not the codec |
| 9 | posterGuid | guid | |
| 10 | posterName | str | |
| 11 | posterFaction | faction | so the server can re-check "opposite faction" (spec 5.4 step 1) |
| 12 | zoneMapId | uint | |
| 13 | timestamp | uint | unix seconds |
| 14 | nonce | u16 | |
| 15 | note | str | optional note from the Set Bounty box (spec 5.4b); `""` if none |

**K: kill claim** (addon → Discord)

| # | Field | Kind |
|---|---|---|
| 1 | boardTag | tag |
| 2 | bountyId | uint |
| 3 | victimGuid | guid |
| 4 | killerGuid | guid |
| 5 | killerName | str |
| 6 | timestamp | uint |
| 7 | zoneMapId | uint |
| 8 | honorCorroborated | bool |
| 9 | nonce | u16 |

**P: bounty pack** (Discord → addon)

| # | Field | Kind |
|---|---|---|
| 1 | boardTag | tag |
| 2 | packVersion | uint (unix seconds) |
| 3 | discordName | str |
| 4 | bounties | list of the record below |

Pack bounty record: `id` uint, `targetGuid` guid, `targetName` str, `classId`
uint, `targetFaction` faction, `reward` uint, `posterGuid` guid, `posterName`
str, `expiresAt` uint.

Packs are not compressed in BL1. If they get too long, compression arrives as
a new format version rather than a flag inside BL1.

## Typical sizes

From the test vectors: a B code is about 125 characters, a K code about 90, and
a pack is about 50 characters plus about 100 per bounty.
