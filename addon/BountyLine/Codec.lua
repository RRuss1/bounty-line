-- Bounty Line code codec, format BL1.
--
-- Port of the reference implementation worker/src/codec.ts. The contract is
-- docs/compendium/02-Code-Format-Spec.md, and both must pass
-- shared/test-vectors.json (run: lua addon/tests/run.lua). Keep the two files
-- structurally parallel: same schemas, same check order, same error codes.
--
-- Pure Lua 5.1 arithmetic, no bit library, so it behaves the same in the WoW
-- client, stock Lua 5.1 and LuaJIT. Pack decompression uses LibDeflate.
--
-- API:
--   Codec.Encode(codeType, fields) -> code                     | nil, "INVALID", message   (B, K, L)
--   Codec.Decode(text)             -> { type, fields, code }   | nil, errorCode, message
--   Codec.DecodePack(text)         -> { fields, codes }        | nil, errorCode, message, received, total
--
-- Error codes: FORMAT VERSION TYPE CHECKSUM SCHEMA PAYLOAD FACTION PARTS INCOMPLETE

local _, ns = ...

local Codec = {}

local PREFIX = "BL1"
local SCHEMA = 1
local ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
local MAX_PARTS = 8
local MAX_PACK_BYTES = 262144

Codec.PREFIX = PREFIX
Codec.SCHEMA = SCHEMA
Codec.ALPHABET = ALPHABET
Codec.FACTION = { Alliance = 1, Horde = 2 }

local floor, byte, char, concat = math.floor, string.byte, string.char, table.concat

-- ---------------------------------------------------------------- errors

local CodecError = {}

local function fail(code, message, received, total)
  error(setmetatable({ code = code, message = message, received = received, total = total }, CodecError), 0)
end

-- Runs fn(...) and turns a CodecError into nil, code, message, received, total. Real bugs re-raise.
local function catch(fn, ...)
  local ok, res = pcall(fn, ...)
  if ok then return res end
  if getmetatable(res) == CodecError then return nil, res.code, res.message, res.received, res.total end
  error(res, 0)
end

-- ---------------------------------------------------------------- schemas

local PACK_ENTRY = {
  { "bountyId", "u32" },
  { "targetGUID", "vstr", 255 },
  { "targetName", "vstr", 255 },
  { "targetClassID", "u8" },
  { "targetFaction", "faction" },
  { "rewardGold", "u32" },
  { "posterName", "vstr", 255 },
  { "expiresAt", "u32" },
}

-- Field layouts after the leading u8 schema byte (Compendium 02 Section 3).
local SCHEMAS = {
  B = {
    { "boardTag", "tag" },
    { "targetGUID", "vstr", 255 },
    { "targetName", "vstr", 255 },
    { "targetClassID", "u8" },
    { "targetRaceID", "u8" },
    { "targetLevel", "u8" },
    { "targetFaction", "faction" },
    { "posterFaction", "faction" },
    { "rewardGold", "u32" },
    { "posterGUID", "vstr", 255 },
    { "posterName", "vstr", 255 },
    { "mapID", "u16" },
    { "createdAt", "u32" },
    { "nonce", "u16" },
    { "note", "vstr", 80 },
    { "mode", "u8" },
    { "existingBountyId", "u32" },
  },
  K = {
    { "boardTag", "tag" },
    { "bountyId", "u32" },
    { "victimGUID", "vstr", 255 },
    { "victimName", "vstr", 255 },
    { "killerGUID", "vstr", 255 },
    { "killerName", "vstr", 255 },
    { "killerFaction", "faction" },
    { "killedAt", "u32" },
    { "mapID", "u16" },
    { "flags", "u8" },
    { "nonce", "u16" },
  },
  L = {
    { "boardTag", "tag" },
    { "charGUID", "vstr", 255 },
    { "charName", "vstr", 255 },
    { "faction", "faction" },
    { "guildName", "vstr", 255 },
    { "createdAt", "u32" },
    { "nonce", "u16" },
  },
  P = {
    { "boardTag", "tag" },
    { "packVersion", "u32" },
    { "minAddonVersion", "u16" },
    { "discordDisplayName", "vstr", 255 },
    { "rewardMin", "u32" },
    { "rewardMax", "u32" },
    { "bounties", "list", PACK_ENTRY },
  },
}

local SIZE = { u8 = 1, u16 = 2, u32 = 4 }
local MAX = { u8 = 255, u16 = 65535, u32 = 4294967295 }

-- Cross-field rules. strict is true for the schema this codec knows; newer
-- schemas only get the rules that can't change. Returns code, message or nil.
local function crossCheck(codeType, f, strict)
  if codeType == "B" then
    if f.targetFaction == f.posterFaction then return "FACTION", "bounties must be on the opposite faction" end
    if strict then
      if f.mode ~= 0 and f.mode ~= 1 then return "PAYLOAD", "invalid mode" end
      if f.mode == 0 and f.existingBountyId ~= 0 then return "PAYLOAD", "existingBountyId must be 0 for a new bounty" end
      if f.mode == 1 and f.existingBountyId == 0 then return "PAYLOAD", "existingBountyId is required to add to a bounty" end
    end
  elseif codeType == "K" then
    if strict and f.flags > 3 then return "PAYLOAD", "unknown flag bits" end
  elseif codeType == "P" then
    if f.rewardMin > f.rewardMax then return "PAYLOAD", "rewardMin is above rewardMax" end
  end
  return nil
end

-- ---------------------------------------------------------------- CRC-16/CCITT-FALSE

local function bxor(a, b)
  local r, p = 0, 1
  while a > 0 or b > 0 do
    local x, y = a % 2, b % 2
    if x ~= y then r = r + p end
    a, b, p = (a - x) / 2, (b - y) / 2, p * 2
  end
  return r
end

local CRC_TABLE = {}
for i = 0, 255 do
  local crc = i * 256
  for _ = 1, 8 do
    if crc >= 32768 then crc = bxor((crc - 32768) * 2, 0x1021) else crc = crc * 2 end
  end
  CRC_TABLE[i] = crc
end

-- CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) over an ASCII string.
local function crc16(s)
  local crc = 0xFFFF
  for i = 1, #s do
    local idx = bxor(floor(crc / 256), byte(s, i))
    crc = bxor((crc % 256) * 256, CRC_TABLE[idx])
  end
  return crc
end

-- ---------------------------------------------------------------- Adler-32 (zlib trailer)

local function adler32(s)
  local a, b = 1, 0
  for i = 1, #s do
    a = (a + byte(s, i)) % 65521
    b = (b + a) % 65521
  end
  return b * 65536 + a
end

-- ---------------------------------------------------------------- Crockford base32

local ENC, DEC = {}, {}
for i = 1, 32 do
  local c = ALPHABET:sub(i, i)
  ENC[i - 1] = c
  DEC[c] = i - 1
end

local function checkChars(crc)
  return ENC[floor(crc / 32768)] .. ENC[floor(crc / 1024) % 32] .. ENC[floor(crc / 32) % 32] .. ENC[crc % 32]
end

-- bytes: a Lua string of raw bytes
local function base32Encode(bytes)
  local out, buf, bits = {}, 0, 0
  for i = 1, #bytes do
    buf = buf * 256 + byte(bytes, i)
    bits = bits + 8
    while bits >= 5 do
      bits = bits - 5
      local p = 2 ^ bits
      local idx = floor(buf / p)
      out[#out + 1] = ENC[idx]
      buf = buf - idx * p
    end
  end
  if bits > 0 then out[#out + 1] = ENC[buf * 2 ^ (5 - bits)] end
  return concat(out)
end

-- Decodes canonical base32. Rejects impossible lengths and non-zero pad bits.
local function base32Decode(text)
  local out, buf, bits = {}, 0, 0
  for i = 1, #text do
    local ch = text:sub(i, i)
    local v = DEC[ch]
    if not v then fail("FORMAT", 'invalid character "' .. ch .. '"') end
    buf = buf * 32 + v
    bits = bits + 5
    if bits >= 8 then
      bits = bits - 8
      local p = 2 ^ bits
      local b = floor(buf / p)
      out[#out + 1] = char(b)
      buf = buf - b * p
    end
  end
  if bits >= 5 or buf ~= 0 then fail("FORMAT", "payload has an invalid length or padding") end
  return concat(out)
end

-- ---------------------------------------------------------------- UTF-8 (strict, Unicode Table 3-7)

local function isCont(x) return x ~= nil and x >= 0x80 and x <= 0xBF end

local function validUtf8(s)
  local i, n = 1, #s
  while i <= n do
    local c = byte(s, i)
    if c < 0x80 then
      i = i + 1
    elseif c >= 0xC2 and c <= 0xDF then
      if not isCont(byte(s, i + 1)) then return false end
      i = i + 2
    elseif c >= 0xE0 and c <= 0xEF then
      local lo, hi = 0x80, 0xBF
      if c == 0xE0 then lo = 0xA0 elseif c == 0xED then hi = 0x9F end
      local c2, c3 = byte(s, i + 1, i + 2)
      if c2 == nil or c2 < lo or c2 > hi or not isCont(c3) then return false end
      i = i + 3
    elseif c >= 0xF0 and c <= 0xF4 then
      local lo, hi = 0x80, 0xBF
      if c == 0xF0 then lo = 0x90 elseif c == 0xF4 then hi = 0x8F end
      local c2, c3, c4 = byte(s, i + 1, i + 3)
      if c2 == nil or c2 < lo or c2 > hi or not isCont(c3) or not isCont(c4) then return false end
      i = i + 4
    else
      return false
    end
  end
  return true
end

-- Cuts a UTF-8 string to at most max bytes, never splitting a character.
local function truncateUtf8(s, max)
  if #s <= max then return s end
  local cut = max
  while cut > 0 and isCont(byte(s, cut + 1)) do cut = cut - 1 end
  return s:sub(1, cut)
end

-- ---------------------------------------------------------------- byte writer / reader

local function newWriter() return { n = 0 } end

local function put(w, v)
  w.n = w.n + 1
  w[w.n] = char(v)
end

local function putUint(w, v, size)
  for i = size - 1, 0, -1 do put(w, floor(v / 256 ^ i) % 256) end
end

local function putBytes(w, s)
  w.n = w.n + 1
  w[w.n] = s
end

local function writerBytes(w) return concat(w, "", 1, w.n) end

local Reader = {}
Reader.__index = Reader

local function newReader(bytes) return setmetatable({ s = bytes, pos = 1 }, Reader) end

function Reader:done() return self.pos == #self.s + 1 end

function Reader:bytes(n)
  if self.pos + n - 1 > #self.s then fail("PAYLOAD", "payload is truncated") end
  local out = self.s:sub(self.pos, self.pos + n - 1)
  self.pos = self.pos + n
  return out
end

function Reader:uint(size)
  local s, n = self:bytes(size), 0
  for i = 1, size do n = n * 256 + byte(s, i) end
  return n
end

local function isTag(s)
  if #s ~= 4 then return false end
  for i = 1, 4 do
    if not DEC[s:sub(i, i)] then return false end
  end
  return true
end

-- ---------------------------------------------------------------- field encode / decode

local function checkUint(v, path, max)
  if type(v) ~= "number" or v ~= floor(v) or v < 0 or v > max then
    fail("INVALID", ("%s must be an integer from 0 to %.0f"):format(path, max))
  end
  return v
end

local function writeFields(w, fields, obj, path)
  if type(obj) ~= "table" then fail("INVALID", (path ~= "" and path or "fields") .. " must be a table") end
  for _, f in ipairs(fields) do
    local name, kind = f[1], f[2]
    local v = obj[name]
    local p = path ~= "" and (path .. "." .. name) or name
    if SIZE[kind] then
      putUint(w, checkUint(v, p, MAX[kind]), SIZE[kind])
    elseif kind == "tag" then
      if type(v) ~= "string" or not isTag(v) then fail("INVALID", p .. " must be 4 Crockford base32 characters") end
      putBytes(w, v)
    elseif kind == "faction" then
      if v ~= 1 and v ~= 2 then fail("INVALID", p .. " must be 1 (Alliance) or 2 (Horde)") end
      put(w, v)
    elseif kind == "vstr" then
      if type(v) ~= "string" then fail("INVALID", p .. " must be a string") end
      if not validUtf8(v) then fail("INVALID", p .. " is not valid UTF-8") end
      local s = truncateUtf8(v, f[3])
      put(w, #s)
      putBytes(w, s)
    elseif kind == "list" then
      if type(v) ~= "table" then fail("INVALID", p .. " must be an array") end
      putUint(w, checkUint(#v, p .. ".length", 65535), 2)
      for i = 1, #v do writeFields(w, f[3], v[i], p .. "[" .. (i - 1) .. "]") end
    end
  end
end

local function readFields(r, fields)
  local out = {}
  for _, f in ipairs(fields) do
    local name, kind = f[1], f[2]
    if SIZE[kind] then
      out[name] = r:uint(SIZE[kind])
    elseif kind == "tag" then
      local s = r:bytes(4)
      if not isTag(s) then fail("PAYLOAD", "invalid board tag") end
      out[name] = s
    elseif kind == "faction" then
      local v = r:uint(1)
      if v ~= 1 and v ~= 2 then fail("FACTION", "invalid faction") end
      out[name] = v
    elseif kind == "vstr" then
      local n = r:uint(1)
      if n > f[3] then fail("PAYLOAD", name .. " is longer than " .. f[3] .. " bytes") end
      local s = r:bytes(n)
      if not validUtf8(s) then fail("PAYLOAD", name .. " is not valid UTF-8") end
      out[name] = s
    elseif kind == "list" then
      local n = r:uint(2)
      local items = {}
      for i = 1, n do items[i] = readFields(r, f[3]) end
      out[name] = items
    end
  end
  return out
end

local function writePayload(codeType, fields)
  if type(fields) ~= "table" then fail("INVALID", "fields must be a table") end
  local schema = fields.schema == nil and SCHEMA or fields.schema
  if schema ~= SCHEMA then fail("INVALID", "schema must be " .. SCHEMA) end
  local w = newWriter()
  put(w, schema)
  writeFields(w, SCHEMAS[codeType], fields, "")
  local bad, msg = crossCheck(codeType, fields, true)
  if bad then fail("INVALID", msg) end
  return writerBytes(w)
end

local function readPayload(codeType, bytes)
  local r = newReader(bytes)
  local schema = r:uint(1)
  if schema == 0 then fail("SCHEMA", "unknown schema 0") end
  -- A newer schema appends fields: read the ones we know, ignore the rest (Compendium 01 Section 5.2).
  local strict = schema == SCHEMA
  local fields = readFields(r, SCHEMAS[codeType])
  fields.schema = schema
  local bad, msg = crossCheck(codeType, fields, strict)
  if bad then fail(bad, msg) end
  if strict and not r:done() then fail("PAYLOAD", "unexpected trailing bytes") end
  return fields
end

-- ---------------------------------------------------------------- pack container (zlib = header + raw deflate + Adler-32)

local function getLibDeflate()
  local lib = Codec.LibDeflate or (LibStub and LibStub:GetLibrary("LibDeflate", true))
  if not lib then error("Bounty Line: LibDeflate is not loaded", 0) end
  return lib
end

local function unpackBytes(b)
  local n = #b
  if n < 6 then fail("PAYLOAD", "pack is too short") end
  local cmf, flg = byte(b, 1, 2)
  if cmf % 16 ~= 8 or cmf >= 128 or (cmf * 256 + flg) % 31 ~= 0 or floor(flg / 32) % 2 == 1 then
    fail("PAYLOAD", "pack has an invalid zlib header")
  end
  local out = getLibDeflate():DecompressDeflate(b:sub(3, n - 4))
  if not out then fail("PAYLOAD", "pack data is corrupt") end
  if #out > MAX_PACK_BYTES then fail("PAYLOAD", "pack is too large") end
  local b1, b2, b3, b4 = byte(b, n - 3, n)
  if adler32(out) ~= b1 * 16777216 + b2 * 65536 + b3 * 256 + b4 then
    fail("PAYLOAD", "pack data is corrupt (Adler-32 mismatch)")
  end
  return out
end

-- ---------------------------------------------------------------- text form

-- Builds BL1-<type>-[<part>-]<payload>-<check> from base32 payload text.
local function wrapPayload(codeType, payloadText, partToken)
  local body = PREFIX .. "-" .. codeType .. "-" .. (partToken and (partToken .. "-") or "") .. payloadText
  return body .. "-" .. checkChars(crc16(body))
end

-- Compendium 02 Section 1.1: drop ASCII whitespace and backticks, uppercase ASCII.
local function normalize(input)
  return (input:gsub("[ \t\n\r\v\f`]", ""):gsub("[a-z]", string.upper))
end

-- In PAYLOAD and CHECK only: I,L -> 1 and O -> 0. Anything else outside the alphabet is FORMAT.
local function crockford(text)
  local s = text:gsub("[IL]", "1"):gsub("O", "0")
  for i = 1, #s do
    local ch = s:sub(i, i)
    if not DEC[ch] then fail("FORMAT", 'invalid character "' .. ch .. '"') end
  end
  return s
end

local function split(s, sep)
  local parts, start = {}, 1
  while true do
    local i = s:find(sep, start, true)
    if not i then
      parts[#parts + 1] = s:sub(start)
      return parts
    end
    parts[#parts + 1] = s:sub(start, i - 1)
    start = i + 1
  end
end

-- Parses and checksums one normalized code. Does not look inside the payload.
local function parseCode(s)
  local version, rest = s:match("^BL([0-9]+)%-(.*)$")
  if not version then fail("FORMAT", "not a Bounty Line code") end
  if version ~= "1" then fail("VERSION", "unsupported code version BL" .. version) end
  local parts = split(rest, "-")
  local codeType = parts[1]
  if not SCHEMAS[codeType] then fail("TYPE", 'unknown code type "' .. codeType .. '"') end
  local partToken, part, rawPayload, rawCheck
  if #parts == 3 then
    rawPayload, rawCheck = parts[2], parts[3]
  elseif #parts == 4 and codeType == "P" then
    partToken, rawPayload, rawCheck = parts[2], parts[3], parts[4]
    local index, total = partToken:match("^([1-9][0-9]?)OF([1-9][0-9]?)$")
    if not index then fail("FORMAT", "invalid part marker") end
    part = { index = tonumber(index), total = tonumber(total) }
    if part.total < 2 or part.total > MAX_PARTS or part.index > part.total then
      fail("PARTS", ("invalid part %d of %d"):format(part.index, part.total))
    end
  else
    fail("FORMAT", "code must have the form BL1-<type>-<payload>-<check>")
  end
  if rawPayload == "" or #rawCheck ~= 4 then fail("FORMAT", "code is missing its payload or check") end
  local payload = crockford(rawPayload)
  local check = crockford(rawCheck)
  local body = PREFIX .. "-" .. codeType .. "-" .. (partToken and (partToken .. "-") or "") .. payload
  if check ~= checkChars(crc16(body)) then fail("CHECKSUM", "checksum mismatch: the code is cut off or changed") end
  return { type = codeType, part = part, payload = payload, code = body .. "-" .. check }
end

-- ---------------------------------------------------------------- public API

local function encode(codeType, fields)
  if codeType == "P" then fail("INVALID", "packs are generated by the Bounty Board") end
  if type(codeType) ~= "string" or not SCHEMAS[codeType] then
    fail("INVALID", 'unknown code type "' .. tostring(codeType) .. '"')
  end
  return wrapPayload(codeType, base32Encode(writePayload(codeType, fields)))
end

local function decode(input)
  if type(input) ~= "string" then fail("FORMAT", "code must be a string") end
  local c = parseCode(normalize(input))
  if c.part then fail("PARTS", "this is one part of a multi-part Bounty Pack; paste all parts into /bl import") end
  local bytes = base32Decode(c.payload)
  if c.type == "P" then bytes = unpackBytes(bytes) end
  return { type = c.type, fields = readPayload(c.type, bytes), code = c.code }
end

-- Start offsets of every BL<digits>- in normalized text.
local function codeStarts(s)
  local starts = {}
  for i = 1, #s do
    if s:find("^BL[0-9]+%-", i) then starts[#starts + 1] = i end
  end
  return starts
end

local function decodePack(text)
  if type(text) ~= "string" then fail("FORMAT", "pack must be a string") end
  local s = normalize(text)
  local starts = codeStarts(s)
  if starts[1] ~= 1 then fail("FORMAT", "not a Bounty Line code") end
  local codes = {}
  for i, start in ipairs(starts) do
    local stop = starts[i + 1] and (starts[i + 1] - 1) or #s
    codes[i] = parseCode(s:sub(start, stop))
  end
  for _, c in ipairs(codes) do
    if c.type ~= "P" then fail("TYPE", "that's not a Bounty Pack code") end
  end
  local payload
  local ordered = {}
  if #codes == 1 and not codes[1].part then
    payload = codes[1].payload
    ordered[1] = codes[1].code
  else
    for _, c in ipairs(codes) do
      if not c.part then fail("PARTS", "a whole pack was mixed with pack parts") end
    end
    local total = codes[1].part.total
    local chunks, chunkCodes, count = {}, {}, 0
    for _, c in ipairs(codes) do
      if c.part.total ~= total then fail("PARTS", "parts come from different packs") end
      local seen = chunks[c.part.index]
      if seen and seen ~= c.payload then
        fail("PARTS", "two different versions of part " .. c.part.index)
      end
      if not seen then count = count + 1 end
      chunks[c.part.index] = c.payload
      chunkCodes[c.part.index] = c.code
    end
    if count < total then
      local received = {}
      for i = 1, total do
        if chunks[i] then received[#received + 1] = i end
      end
      fail("INCOMPLETE", ("%d of %d parts received"):format(#received, total), received, total)
    end
    local all = {}
    for i = 1, total do
      all[i] = chunks[i]
      ordered[i] = chunkCodes[i]
    end
    payload = concat(all)
  end
  local fields = readPayload("P", unpackBytes(base32Decode(payload)))
  return { fields = fields, codes = ordered }
end

function Codec.Encode(codeType, fields)
  return catch(encode, codeType, fields)
end

function Codec.Decode(text)
  return catch(decode, text)
end

function Codec.DecodePack(text)
  return catch(decodePack, text)
end

-- Internals exposed for the test suite only.
Codec._test = {
  crc16 = crc16,
  adler32 = adler32,
  normalize = normalize,
  base32Encode = base32Encode,
  base32Decode = function(text) return catch(base32Decode, text) end,
}

if ns then ns.Codec = Codec end
return Codec
