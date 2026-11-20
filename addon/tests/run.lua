-- Runs the codec against shared/test-vectors.json.
--   luajit addon/tests/run.lua        (any Lua 5.1-compatible interpreter)
-- Exits non-zero on failure.

local here = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local root = here .. "/../.."

local function loadLua(path)
  local f = assert(loadfile(path))
  return f()
end

local JSON = loadLua(here .. "/json.lua")
local Codec = loadLua(root .. "/addon/BountyLine/Codec.lua")

local fh = assert(io.open(root .. "/shared/test-vectors.json", "rb"))
local vectors = JSON.decode(fh:read("*a"))
fh:close()

local passed, failed = 0, 0

local function check(name, ok, detail)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    print("FAIL  " .. name .. (detail and ("\n      " .. detail) or ""))
  end
end

local function deepEqual(a, b, path)
  path = path or "data"
  if type(a) ~= type(b) then return false, ("%s: %s vs %s"):format(path, tostring(a), tostring(b)) end
  if type(a) ~= "table" then
    if a == b then return true end
    return false, ("%s: %s vs %s"):format(path, tostring(a), tostring(b))
  end
  for k, v in pairs(a) do
    local ok, why = deepEqual(v, b[k], path .. "." .. tostring(k))
    if not ok then return false, why end
  end
  for k in pairs(b) do
    if a[k] == nil then return false, path .. "." .. tostring(k) .. " missing" end
  end
  return true
end

local function hexToBytes(hex)
  return (hex:gsub("..", function(h) return string.char(tonumber(h, 16)) end))
end

local function bytesToHex(s)
  return (s:gsub(".", function(c) return ("%02X"):format(c:byte()) end))
end

local function show(x) return x == nil and "nil" or tostring(x) end

-- primitives
for _, v in ipairs(vectors.primitives.crc16) do
  local got = Codec._test.crc16(v.ascii)
  check("crc16 " .. v.ascii, got == v.crc, "got " .. got)
end
for _, v in ipairs(vectors.primitives.base32) do
  local enc = Codec._test.base32Encode(hexToBytes(v.hex))
  check("base32 encode " .. v.hex, enc == v.text, "got " .. enc)
  local dec = Codec._test.base32Decode(v.text)
  check("base32 decode " .. v.text, dec and bytesToHex(dec) == v.hex, "got " .. show(dec and bytesToHex(dec)))
end
for _, v in ipairs(vectors.primitives.varint) do
  local got = bytesToHex(Codec._test.varint(v.value))
  check("varint " .. v.value, got == v.hex, "got " .. got)
end

-- valid codes: encode, decode, and canonical round trip
for _, v in ipairs(vectors.valid) do
  local code, err, msg = Codec.Encode(v.type, v.data)
  check(v.name .. ": encodes", code == v.code, "got " .. show(code) .. " " .. show(err) .. " " .. show(msg))

  local res, derr, dmsg = Codec.Decode(v.code)
  if not res then
    check(v.name .. ": decodes", false, show(derr) .. ": " .. show(dmsg))
  else
    check(v.name .. ": decoded type", res.type == v.type, "got " .. show(res.type))
    check(v.name .. ": decoded code", res.code == v.code, "got " .. show(res.code))
    local same, why = deepEqual(res.data, v.data)
    check(v.name .. ": decoded data", same, why)
    check(v.name .. ": re-encodes", Codec.Encode(res.type, res.data) == v.code)
  end
end

for _, v in ipairs(vectors.normalize) do
  local res, err = Codec.Decode(v.input)
  check("normalize " .. v.name, res and res.code == v.code, "got " .. show(res and res.code or err))
end

for _, v in ipairs(vectors.invalid) do
  local res, err, msg = Codec.Decode(v.input)
  check("invalid " .. v.name .. " -> " .. v.error, res == nil and err == v.error,
    "got " .. (res and "ok" or show(err) .. " (" .. show(msg) .. ")"))
end

for _, v in ipairs(vectors.encodeErrors) do
  -- JSON null stands for a missing field.
  local data = v.data
  if type(data) == "table" then
    for k, x in pairs(data) do if x == JSON.null then data[k] = nil end end
  end
  local code, err = Codec.Encode(v.type, data)
  check("encode error " .. v.name, code == nil and err == "invalid", "got " .. show(code or err))
end

-- every single-character substitution in a payload is caught
do
  local code = vectors.valid[4].code
  local start = code:find("-", 5, true) + 1
  local stop = #code - 5
  local alphabet = Codec.ALPHABET
  local caught = true
  for i = start, stop do
    for j = 1, #alphabet do
      local ch = alphabet:sub(j, j)
      if ch ~= code:sub(i, i) and Codec.Decode(code:sub(1, i - 1) .. ch .. code:sub(i + 1)) then
        caught = false
      end
    end
  end
  check("every single-character substitution is caught", caught)
end

print(("%d passed, %d failed"):format(passed, failed))
os.exit(failed == 0 and 0 or 1)
