-- Minimal JSON decoder for the test suite (not shipped with the addon).
-- Handles objects, arrays, strings (including \u escapes and surrogate pairs),
-- numbers, true/false/null. JSON null decodes to the JSON.null sentinel.

local JSON = { null = setmetatable({}, { __tostring = function() return "null" end }) }

local function utf8char(cp)
  if cp < 0x80 then return string.char(cp) end
  if cp < 0x800 then return string.char(0xC0 + math.floor(cp / 64), 0x80 + cp % 64) end
  if cp < 0x10000 then
    return string.char(0xE0 + math.floor(cp / 4096), 0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
  end
  return string.char(0xF0 + math.floor(cp / 262144), 0x80 + math.floor(cp / 4096) % 64,
    0x80 + math.floor(cp / 64) % 64, 0x80 + cp % 64)
end

function JSON.decode(text)
  local pos = 1

  local function err(msg) error(("JSON error at %d: %s"):format(pos, msg), 0) end
  local function ws() pos = text:find("[^ \t\r\n]", pos) or #text + 1 end

  local value

  local function str()
    pos = pos + 1 -- opening quote
    local out = {}
    while true do
      local c = text:sub(pos, pos)
      if c == "" then err("unterminated string") end
      if c == '"' then pos = pos + 1; break end
      if c == "\\" then
        local e = text:sub(pos + 1, pos + 1)
        local simple = { ['"'] = '"', ["\\"] = "\\", ["/"] = "/", b = "\b", f = "\f", n = "\n", r = "\r", t = "\t" }
        if simple[e] then
          out[#out + 1] = simple[e]; pos = pos + 2
        elseif e == "u" then
          local cp = tonumber(text:sub(pos + 2, pos + 5), 16) or err("bad \\u escape")
          pos = pos + 6
          if cp >= 0xD800 and cp <= 0xDBFF and text:sub(pos, pos + 1) == "\\u" then
            local lo = tonumber(text:sub(pos + 2, pos + 5), 16)
            if lo and lo >= 0xDC00 and lo <= 0xDFFF then
              cp = 0x10000 + (cp - 0xD800) * 1024 + (lo - 0xDC00)
              pos = pos + 6
            end
          end
          out[#out + 1] = utf8char(cp)
        else
          err("bad escape")
        end
      else
        local j = text:find('["\\]', pos) or err("unterminated string")
        out[#out + 1] = text:sub(pos, j - 1)
        pos = j
      end
    end
    return table.concat(out)
  end

  function value()
    ws()
    local c = text:sub(pos, pos)
    if c == "{" then
      pos = pos + 1
      local obj = {}
      ws()
      if text:sub(pos, pos) == "}" then pos = pos + 1; return obj end
      while true do
        ws()
        if text:sub(pos, pos) ~= '"' then err("expected key") end
        local k = str()
        ws()
        if text:sub(pos, pos) ~= ":" then err("expected ':'") end
        pos = pos + 1
        obj[k] = value()
        ws()
        local d = text:sub(pos, pos)
        pos = pos + 1
        if d == "}" then return obj end
        if d ~= "," then err("expected ',' or '}'") end
      end
    elseif c == "[" then
      pos = pos + 1
      local arr = {}
      ws()
      if text:sub(pos, pos) == "]" then pos = pos + 1; return arr end
      while true do
        arr[#arr + 1] = value()
        ws()
        local d = text:sub(pos, pos)
        pos = pos + 1
        if d == "]" then return arr end
        if d ~= "," then err("expected ',' or ']'") end
      end
    elseif c == '"' then
      return str()
    elseif text:sub(pos, pos + 3) == "true" then
      pos = pos + 4; return true
    elseif text:sub(pos, pos + 4) == "false" then
      pos = pos + 5; return false
    elseif text:sub(pos, pos + 3) == "null" then
      pos = pos + 4; return JSON.null
    else
      local num = text:match("^-?%d+%.?%d*[eE]?[-+]?%d*", pos)
      if not num or num == "" then err("unexpected character '" .. c .. "'") end
      pos = pos + #num
      return tonumber(num)
    end
  end

  local v = value()
  ws()
  if pos <= #text then err("trailing data") end
  return v
end

return JSON
