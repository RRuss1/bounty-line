-- Tests for the posting logic in Bounty.lua against a stubbed WoW API.
--   lua addon/tests/logic.lua      (stock Lua 5.1 or LuaJIT)
-- Exits non-zero on failure.

local here = (arg and arg[0] or ""):match("^(.*)[/\\]") or "."
local root = here .. "/../.."
local ns = {}

local function loadAddon(path)
  local f = assert(loadfile(root .. "/addon/BountyLine/" .. path))
  return f("BountyLine", ns)
end

strmatch = string.match
loadAddon("Libs/LibStub/LibStub.lua")
loadAddon("Libs/LibDeflate/LibDeflate.lua")
loadAddon("Codec.lua")
loadAddon("Locales/enUS.lua")

-- ---------------------------------------------------------------- stubbed WoW API

local units
local SECRET = setmetatable({}, { __tostring = function() return "<secret>" end })

local function reset()
  units = {
    player = { guid = "Player-4395-00FFEE11", name = "Slac", surname = "Jaw", faction = "Alliance", player = true,
      class = { "Warrior", "WARRIOR", 1 }, race = { "Human", "Human", 1 }, level = 60 },
    target = { guid = "Player-4395-0A1B2C3D", name = "Grimlok", surname = "Ashveil", faction = "Horde", player = true,
      class = { "Warrior", "WARRIOR", 1 }, race = { "Orc", "Orc", 2 }, level = 42 },
  }
  BountyLineDB = { settings = {} }
end

local function u(unit) return units[unit] end
function UnitExists(unit) return u(unit) ~= nil end
function UnitGUID(unit) return u(unit) and u(unit).guid end
-- Forever: UnitName returns the first name and the surname (where retail has the realm).
function UnitName(unit) if u(unit) then return u(unit).name, u(unit).surname end end
function UnitFactionGroup(unit) return u(unit) and u(unit).faction end
function UnitIsPlayer(unit) return u(unit) and u(unit).player end
function UnitIsUnit(a, b) return u(a) == u(b) end
function UnitClass(unit) return unpack(u(unit).class) end
function UnitRace(unit) return unpack(u(unit).race) end
function UnitLevel(unit) return u(unit).level end
function GetServerTime() return 1795200000 end
function GetGuildInfo() return "Grief" end
function issecretvalue(v) return v == SECRET end
C_Map = { GetBestMapForUnit = function() return 1434 end }

reset()
loadAddon("Bounty.lua")
local Codec = ns.Codec

-- ---------------------------------------------------------------- harness

local passed, failed = 0, 0
local function check(name, ok, detail)
  if ok then
    passed = passed + 1
  else
    failed = failed + 1
    print("FAIL  " .. name .. (detail and ("\n      " .. detail) or ""))
  end
end
local function eq(name, got, want)
  check(name, got == want, ("got %s, want %s"):format(tostring(got), tostring(want)))
end

-- ---------------------------------------------------------------- ParseReward

local REWARDS = {
  { "500", 500 }, { "500g", 500 }, { "500G", 500 }, { " 750 g ", 750 }, { "1,000", 1000 },
  { "1k", 1000 }, { "2.5k", 2500 }, { "2.3k", 2300 }, { "1.25k", 1250 }, { "10k", 10000 },
  { "1", 1 }, { "1.0", 1 }, { "2.5000k", 2500 },
  { "0", nil, "RANGE" }, { "10001", nil, "RANGE" }, { "10.001k", nil, "RANGE" }, { "99999999999", nil, "RANGE" },
  { "", nil, "FORMAT" }, { "abc", nil, "FORMAT" }, { "-5", nil, "FORMAT" }, { "1.5", nil, "FORMAT" },
  { "1.2345k", nil, "FORMAT" }, { "1.", nil, "FORMAT" }, { ".5k", nil, "FORMAT" }, { "5kg", 5000 },
  { "1e3", nil, "FORMAT" }, { "0x10", nil, "FORMAT" },
}
for _, c in ipairs(REWARDS) do
  local gold, why = ns.ParseReward(c[1], 1, 10000)
  eq(("ParseReward(%q)"):format(c[1]), gold, c[2])
  if c[3] then eq(("ParseReward(%q) reason"):format(c[1]), why, c[3]) end
end
check("ParseReward(nil)", ns.ParseReward(nil, 1, 10000) == nil)

-- ---------------------------------------------------------------- SnapshotUnit

local function snapFails(name, mutate, want)
  reset()
  mutate()
  local snap, why = ns.SnapshotUnit("target")
  check("snapshot " .. name, snap == nil and why == want, ("got %s / %s, want %s"):format(tostring(snap), tostring(why), want))
end

snapFails("no target", function() units.target = nil end, "NO_TARGET")
snapFails("NPC", function() units.target.player = false end, "NOT_PLAYER")
snapFails("same faction", function() units.target.faction = "Alliance" end, "SAME_FACTION")
snapFails("neutral target", function() units.target.faction = "Neutral" end, "NEUTRAL")
snapFails("neutral player", function() units.player.faction = "Neutral" end, "NEUTRAL")
snapFails("yourself", function() units.target = units.player end, "SELF")
snapFails("secret GUID", function() units.target.guid = SECRET end, "SECRET")
snapFails("secret faction", function() units.target.faction = SECRET end, "SECRET")
snapFails("secret name", function() units.target.name = SECRET end, "SECRET")

reset()
local snap = ns.SnapshotUnit("target")
check("snapshot ok", snap ~= nil)
eq("snapshot faction", snap.faction, 2)
eq("snapshot class", snap.classID, 1)
eq("snapshot race", snap.raceID, 2)
eq("describe", ns.Describe(snap), "Grimlok Ashveil · Orc Warrior 42 · Horde")

reset()
units.target.surname = nil
eq("no surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")
units.target.surname = ""
eq("empty surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")
units.target.surname = SECRET
eq("secret surname: first name only", ns.SnapshotUnit("target").name, "Grimlok")

reset()
units.target.level = -1
local skull = ns.SnapshotUnit("target")
eq("?? level is carried as 0", skull.level, 0)
eq("?? level described", ns.Describe(skull), "Grimlok Ashveil · Orc Warrior ?? · Horde")

-- ---------------------------------------------------------------- B code

reset()
local code = ns.BuildBountyCode(snap, 500, "camps the flight master")
local decoded = Codec.Decode(code)
check("B code decodes", decoded ~= nil and decoded.type == "B", code)
local f = decoded.fields
for k, want in pairs({
  boardTag = "0000", targetGUID = "Player-4395-0A1B2C3D", targetName = "Grimlok Ashveil", targetClassID = 1,
  targetRaceID = 2, targetLevel = 42, targetFaction = 2, posterFaction = 1, rewardGold = 500,
  posterGUID = "Player-4395-00FFEE11", posterName = "Slac Jaw", mapID = 1434, createdAt = 1795200000,
  note = "camps the flight master", mode = 0, existingBountyId = 0,
}) do
  eq("B field " .. k, f[k], want)
end
check("B nonce in range", f.nonce >= 0 and f.nonce <= 65535)

BountyLineDB.boardTag = "MT8H"
eq("B uses the imported board tag", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.boardTag, "MT8H")
eq("B with no note", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.note, "")
eq("B note truncated to 80 bytes", #Codec.Decode(ns.BuildBountyCode(snap, 1, ("x"):rep(200))).fields.note, 80)

C_Map.GetBestMapForUnit = function() return nil end
eq("B without a map (instances)", Codec.Decode(ns.BuildBountyCode(snap, 1)).fields.mapID, 0)
C_Map.GetBestMapForUnit = function() return 1434 end

-- ---------------------------------------------------------------- L code

reset()
local link = Codec.Decode(ns.BuildLinkCode())
check("L code decodes", link ~= nil and link.type == "L")
eq("L charGUID", link.fields.charGUID, "Player-4395-00FFEE11")
eq("L charName", link.fields.charName, "Slac Jaw")
eq("L faction", link.fields.faction, 1)
eq("L guildName", link.fields.guildName, "Grief")
units.player.faction = "Neutral"
local none, err = ns.BuildLinkCode()
check("L refuses a neutral character", none == nil and err == "NEUTRAL")

-- ---------------------------------------------------------------- limits

reset()
local min, max = ns.RewardLimits()
check("default limits 1g to 10,000g", min == 1 and max == 10000)
BountyLineDB.pack = { rewardMin = 5, rewardMax = 500 }
min, max = ns.RewardLimits()
check("pack limits win", min == 5 and max == 500)
eq("range message", ns.RewardError("RANGE", 1, 10000), "Reward must be between 1g and 10000g.")

print(("%d passed, %d failed"):format(passed, failed))
if failed > 0 then os.exit(1) end
