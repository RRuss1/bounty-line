-- Bounty Line code codec, format BL1.
--
-- Mirrors worker/src/codec.ts. The wire format is documented in shared/CODEC.md,
-- and both implementations must pass shared/test-vectors.json (addon/tests/run.lua).
-- Keep the two files structurally parallel: same schemas, same check order, same
-- error codes. Pure Lua 5.1 arithmetic (no bit library), so it behaves the same in
-- the WoW client and in standalone tests.
--
-- API:
--   Codec.Encode(codeType, data)  -> code            | nil, "invalid", message
--   Codec.Decode(text)            -> { type, data, code } | nil, errorCode, message
--     errorCode: "format" | "version" | "type" | "checksum" | "payload"

local _, ns = ...

local Codec = {}

local VERSION = 1
local ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
local MAX_UINT = 4294967295
local MAX_STR_BYTES = 255
local FACTIONS = { [0] = "Alliance", [1] = "Horde" } -- wire value -> name
local FACTION_IDS = { Alliance = 0, Horde = 1 }

Codec.VERSION = VERSION
Codec.ALPHABET = ALPHABET

local floor, byte, char, concat = math.floor, string.byte, string.char, table.concat

-- ---------------------------------------------------------------- errors

local CodecError = {}

local function fail(code, message)
  error(setmetatable({ code = code, message = message }, CodecError), 0)
end

-- Runs fn(...) and converts a CodecError into nil, code, message. Real bugs re-raise.
local function catch(fn, ...)
  local ok, res = pcall(fn, ...)
  if ok then return res end
  if getmetatable(res) == CodecError then return nil, res.code, res.message end
  error(res, 0)
end

-- ---------------------------------------------------------------- schemas

local PACK_BOUNTY = {
  { "id", "uint" },
  { "targetGuid", "guid" },
  { "targetName", "str" },
  { "classId", "uint" },
  { "targetFaction", "faction" },
  { "reward", "uint" },
  { "posterGuid", "guid" },
  { "posterName", "str" },
  { "expiresAt", "uint" },
}

local SCHEMAS = {
  B = {
    { "boardTag", "tag" },
    { "targetGuid", "guid" },
    { "targetName", "str" },
    { "classId", "uint" },
    { "raceId", "uint" },
    { "level", "uint" },
    { "targetFaction", "faction" },
    { "reward", "uint" },
    { "posterGuid", "guid" },
    { "posterName", "str" },
    { "posterFaction", "faction" },
    { "zoneMapId", "uint" },
    { "timestamp", "uint" },
    { "nonce", "u16" },
    { "note", "str" },
  },
  K = {
    { "boardTag", "tag" },
    { "bountyId", "uint" },
    { "victimGuid", "guid" },
    { "killerGuid", "guid" },
    { "killerName", "str" },
    { "timestamp", "uint" },
    { "zoneMapId", "uint" },
    { "honorCorroborated", "bool" },
    { "nonce", "u16" },
  },
  P = {
    { "boardTag", "tag" },
    { "packVersion", "uint" },
    { "discordName", "str" },
    { "bounties", "list", PACK_BOUNTY },
  },
}

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

-- Decodes canonical (already normalized) base32. Rejects impossible lengths and non-zero pad bits.
local function base32Decode(text)
  local out, buf, bits = {}, 0, 0
  for i = 1, #text do
    local ch = text:sub(i, i)
    local v = DEC[ch]
    if not v then fail("format", 'invalid character "' .. ch .. '"') end
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
  if bits >= 5 or buf ~= 0 then fail("format", "payload has an invalid length or padding") end
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

-- ---------------------------------------------------------------- GUIDs

local HEX = "0123456789ABCDEF"

local function hex8(n)
  local t = {}
  for i = 8, 1, -1 do
    local d = n % 16
    t[i] = HEX:sub(d + 1, d + 1)
    n = (n - d) / 16
  end
  return concat(t)
end

-- Returns serverId, low when the GUID round-trips through the compact form exactly.
local function compactGuid(guid)
  local sid, hex = guid:match("^Player%-([0-9]+)%-([0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F][0-9A-F])$")
  if not sid or #sid > 10 then return nil end
  local n = tonumber(sid)
  -- "%.0f" rather than "%d": %d can overflow 32-bit longs on Windows Lua builds.
  if n > MAX_UINT or ("%.0f"):format(n) ~= sid then return nil end
  return n, tonumber(hex, 16)
end

-- ---------------------------------------------------------------- byte writer / reader

local function newWriter() return { n = 0 } end

local function u8(w, v)
  w.n = w.n + 1
  w[w.n] = v
end

local function varint(w, v)
  while v >= 128 do
    u8(w, v % 128 + 128)
    v = floor(v / 128)
  end
  u8(w, v)
end

local function u32(w, v)
  u8(w, floor(v / 16777216))
  u8(w, floor(v / 65536) % 256)
  u8(w, floor(v / 256) % 256)
  u8(w, v % 256)
end

local function str(w, s)
  varint(w, #s)
  for i = 1, #s do u8(w, byte(s, i)) end
end

local function writerBytes(w)
  local t = {}
  for i = 1, w.n do t[i] = char(w[i]) end
  return concat(t)
end

local Reader = {}
Reader.__index = Reader

local function newReader(bytes) return setmetatable({ s = bytes, pos = 1 }, Reader) end

function Reader:done() return self.pos == #self.s + 1 end

function Reader:u8()
  local b = byte(self.s, self.pos)
  if not b then fail("payload", "payload is truncated") end
  self.pos = self.pos + 1
  return b
end

function Reader:varint()
  local result, mult = 0, 1
  for i = 1, 5 do
    local b = self:u8()
    result = result + (b % 128) * mult
    if b < 128 then
      if i > 1 and b == 0 then fail("payload", "non-minimal varint") end
      if result > MAX_UINT then fail("payload", "varint exceeds 32 bits") end
      return result
    end
    mult = mult * 128
  end
  fail("payload", "varint too long")
end

function Reader:bytes(n)
  if self.pos + n - 1 > #self.s then fail("payload", "payload is truncated") end
  local out = self.s:sub(self.pos, self.pos + n - 1)
  self.pos = self.pos + n
  return out
end

function Reader:str()
  local n = self:varint()
  if n > MAX_STR_BYTES then fail("payload", "string too long") end
  local s = self:bytes(n)
  if not validUtf8(s) then fail("payload", "string is not valid UTF-8") end
  return s
end

-- ---------------------------------------------------------------- field encode / decode

local function isTag(s)
  if s == "" then return true end
  if #s ~= 4 then return false end
  for i = 1, 4 do
    if not DEC[s:sub(i, i)] then return false end
  end
  return true
end

local function checkUint(v, path, max)
  if type(v) ~= "number" or v ~= floor(v) or v < 0 or v > max then
    fail("invalid", ("%s must be an integer from 0 to %.0f"):format(path, max))
  end
  return v
end

local function checkStr(v, path)
  if type(v) ~= "string" then fail("invalid", path .. " must be a string") end
  if not validUtf8(v) then fail("invalid", path .. " is not valid UTF-8") end
  if #v > MAX_STR_BYTES then fail("invalid", path .. " is longer than " .. MAX_STR_BYTES .. " bytes") end
  return v
end

local function writeFields(w, fields, obj, path)
  if type(obj) ~= "table" then fail("invalid", (path ~= "" and path or "data") .. " must be a table") end
  for _, f in ipairs(fields) do
    local name, kind = f[1], f[2]
    local v = obj[name]
    local p = path ~= "" and (path .. "." .. name) or name
    if kind == "uint" then
      varint(w, checkUint(v, p, MAX_UINT))
    elseif kind == "u16" then
      local n = checkUint(v, p, 0xFFFF)
      u8(w, floor(n / 256))
      u8(w, n % 256)
    elseif kind == "str" then
      str(w, checkStr(v, p))
    elseif kind == "tag" then
      if type(v) ~= "string" or not isTag(v) then
        fail("invalid", p .. ' must be "" or 4 Crockford base32 characters')
      end
      str(w, v)
    elseif kind == "faction" then
      local id = type(v) == "string" and FACTION_IDS[v]
      if not id then fail("invalid", p .. ' must be "Alliance" or "Horde"') end
      u8(w, id)
    elseif kind == "bool" then
      if type(v) ~= "boolean" then fail("invalid", p .. " must be a boolean") end
      u8(w, v and 1 or 0)
    elseif kind == "guid" then
      if type(v) ~= "string" then fail("invalid", p .. " must be a string") end
      local sid, low = compactGuid(v)
      if sid then
        u8(w, 0)
        varint(w, sid)
        u32(w, low)
      else
        u8(w, 1)
        str(w, checkStr(v, p))
      end
    elseif kind == "list" then
      if type(v) ~= "table" then fail("invalid", p .. " must be an array") end
      varint(w, #v)
      for i = 1, #v do writeFields(w, f[3], v[i], p .. "[" .. (i - 1) .. "]") end
    end
  end
end

local function readFields(r, fields)
  local out = {}
  for _, f in ipairs(fields) do
    local name, kind = f[1], f[2]
    if kind == "uint" then
      out[name] = r:varint()
    elseif kind == "u16" then
      out[name] = r:u8() * 256 + r:u8()
    elseif kind == "str" then
      out[name] = r:str()
    elseif kind == "tag" then
      local s = r:str()
      if not isTag(s) then fail("payload", "invalid board tag") end
      out[name] = s
    elseif kind == "faction" then
      local v = FACTIONS[r:u8()]
      if not v then fail("payload", "invalid faction") end
      out[name] = v
    elseif kind == "bool" then
      local v = r:u8()
      if v > 1 then fail("payload", "invalid boolean") end
      out[name] = v == 1
    elseif kind == "guid" then
      local tag = r:u8()
      if tag == 0 then
        local sid = r:varint()
        local b1, b2, b3, b4 = byte(r:bytes(4), 1, 4)
        out[name] = "Player-" .. ("%.0f"):format(sid) .. "-" .. hex8(b1 * 16777216 + b2 * 65536 + b3 * 256 + b4)
      elseif tag == 1 then
        local s = r:str()
        if compactGuid(s) then fail("payload", "non-canonical GUID encoding") end
        out[name] = s
      else
        fail("payload", "invalid GUID tag")
      end
    elseif kind == "list" then
      local n = r:varint()
      local items = {}
      for i = 1, n do items[i] = readFields(r, f[3]) end
      out[name] = items
    end
  end
  return out
end

-- ---------------------------------------------------------------- public API

-- Builds BL1-<type>-<payload>-<check> from base32 payload text.
local function wrapPayload(codeType, payloadText)
  local body = "BL" .. VERSION .. "-" .. codeType .. "-" .. payloadText
  return body .. "-" .. checkChars(crc16(body))
end

local function encode(codeType, data)
  local schema = SCHEMAS[codeType]
  if not schema then fail("invalid", 'unknown code type "' .. tostring(codeType) .. '"') end
  local w = newWriter()
  writeFields(w, schema, data, "")
  return wrapPayload(codeType, base32Encode(writerBytes(w)))
end

-- Crockford normalization for payload/check text: I,L -> 1, O -> 0; anything else
-- outside the alphabet is a format error.
local function crockford(text)
  local s = text:gsub("[IL]", "1"):gsub("O", "0")
  for i = 1, #s do
    local ch = s:sub(i, i)
    if not DEC[ch] then fail("format", 'invalid character "' .. ch .. '"') end
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

local function decode(input)
  if type(input) ~= "string" then fail("format", "code must be a string") end
  -- ASCII whitespace and ASCII case only, so Lua and TS normalize identically.
  local s = input:gsub("[ \t\n\r\v\f]", ""):gsub("[a-z]", string.upper)
  local version, rest = s:match("^BL([0-9]+)%-(.*)$")
  if not version then fail("format", "not a Bounty Line code") end
  if version ~= tostring(VERSION) then fail("version", "unsupported code version BL" .. version) end
  local parts = split(rest, "-")
  if #parts ~= 3 then fail("format", "code must have the form BL1-<type>-<payload>-<check>") end
  local codeType, rawPayload, rawCheck = parts[1], parts[2], parts[3]
  local schema = SCHEMAS[codeType]
  if not schema then fail("type", 'unknown code type "' .. codeType .. '"') end
  if rawPayload == "" or #rawCheck ~= 4 then fail("format", "code is missing its payload or check") end
  local payload = crockford(rawPayload)
  local check = crockford(rawCheck)
  local body = "BL" .. VERSION .. "-" .. codeType .. "-" .. payload
  if check ~= checkChars(crc16(body)) then
    fail("checksum", "checksum mismatch: the code is cut off or mistyped")
  end
  local r = newReader(base32Decode(payload))
  local data = readFields(r, schema)
  if not r:done() then fail("payload", "unexpected trailing bytes") end
  return { type = codeType, data = data, code = body .. "-" .. check }
end

function Codec.Encode(codeType, data)
  return catch(encode, codeType, data)
end

function Codec.Decode(text)
  return catch(decode, text)
end

-- Internals exposed for the test suite only.
Codec._test = {
  crc16 = crc16,
  base32Encode = base32Encode,
  base32Decode = function(text) return catch(base32Decode, text) end,
  varint = function(n)
    local w = newWriter()
    varint(w, n)
    return writerBytes(w)
  end,
}

if ns then ns.Codec = Codec end
return Codec
